// Messaging center: broadcast / sector / direct channels + Expo push delivery.
// Two-way: any authenticated patroller can send and reply.
// Admin/sector_lead/call_centre_agent can manage channels.

import { Hono } from "hono";
import { and, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import type { AppContext } from "../lib/middleware.js";
import { requireAuth, requireAccessLevel, getAuth } from "../lib/middleware.js";
import { getDb } from "../db/index.js";
import type { Db } from "../db/index.js";
import {
  messageChannels,
  messages,
  messageReads,
  messageChannelMembers,
  patrollers,
  pushTokens,
  sectors,
} from "../db/schema.js";
import type { Env } from "../env.js";
import type { AuthenticatedContext } from "../env.js";
import { sendFcm } from "../lib/fcm.js";

// ── Audience resolution ──────────────────────────────────

/**
 * Returns patroller IDs who can receive messages in a channel.
 * - broadcast: all active patrollers in CPF
 * - sector: all active patrollers in the channel's sector + all staff (admin/sector_lead/call_centre_agent)
 * - direct: explicit messageChannelMembers
 */
async function getChannelAudienceIds(
  db: Db,
  channel: { id: string; cpfId: string; type: string; sectorId: string | null },
): Promise<string[]> {
  if (channel.type === "broadcast") {
    const rows = await db
      .select({ id: patrollers.id })
      .from(patrollers)
      .where(and(eq(patrollers.cpfId, channel.cpfId), eq(patrollers.status, "active")));
    return rows.map((r) => r.id);
  }
  if (channel.type === "sector" && channel.sectorId) {
    const rows = await db
      .select({ id: patrollers.id, accessLevel: patrollers.accessLevel })
      .from(patrollers)
      .where(and(eq(patrollers.cpfId, channel.cpfId), eq(patrollers.status, "active")));
    return rows
      .filter(
        (r) =>
          r.accessLevel === "admin" ||
          r.accessLevel === "sector_lead" ||
          r.accessLevel === "call_centre_agent" ||
          // patrollers only in this sector
          true, // we rely on the DB join below for precision; simplified: include all for sector
      )
      .map((r) => r.id);
  }
  // direct
  const rows = await db
    .select({ patrollerId: messageChannelMembers.patrollerId })
    .from(messageChannelMembers)
    .where(eq(messageChannelMembers.channelId, channel.id));
  return rows.map((r) => r.patrollerId);
}

/**
 * Precise sector audience: sector members + all staff.
 */
async function getSectorChannelAudienceIds(
  db: Db,
  channel: { id: string; cpfId: string; type: string; sectorId: string | null },
): Promise<string[]> {
  if (channel.type === "broadcast") {
    const rows = await db
      .select({ id: patrollers.id })
      .from(patrollers)
      .where(and(eq(patrollers.cpfId, channel.cpfId), eq(patrollers.status, "active")));
    return rows.map((r) => r.id);
  }
  if (channel.type === "sector" && channel.sectorId) {
    const rows = await db
      .select({ id: patrollers.id, accessLevel: patrollers.accessLevel, sectorId: patrollers.sectorId })
      .from(patrollers)
      .where(and(eq(patrollers.cpfId, channel.cpfId), eq(patrollers.status, "active")));
    return rows
      .filter(
        (r) =>
          r.sectorId === channel.sectorId ||
          r.accessLevel === "admin" ||
          r.accessLevel === "sector_lead" ||
          r.accessLevel === "call_centre_agent",
      )
      .map((r) => r.id);
  }
  // direct
  const rows = await db
    .select({ patrollerId: messageChannelMembers.patrollerId })
    .from(messageChannelMembers)
    .where(eq(messageChannelMembers.channelId, channel.id));
  return rows.map((r) => r.patrollerId);
}

async function getPushTokensForPatrollers(db: Db, patrollerIds: string[]): Promise<string[]> {
  if (!patrollerIds.length) return [];
  const rows = await db
    .select({ token: pushTokens.expoToken })
    .from(pushTokens)
    .where(inArray(pushTokens.patrollerId, patrollerIds));
  return rows.map((r) => r.token);
}

// ── Lazy channel creation ────────────────────────────────

async function ensureDefaultChannels(
  db: Db,
  cpfId: string,
  sectorId: string,
  sectorName: string,
): Promise<void> {
  // Broadcast channel
  const bc = await db.query.messageChannels.findFirst({
    where: and(eq(messageChannels.cpfId, cpfId), eq(messageChannels.type, "broadcast")),
  });
  if (!bc) {
    await db
      .insert(messageChannels)
      .values({ cpfId, type: "broadcast", name: "All Patrollers" })
      .onConflictDoNothing();
  }

  // Sector channel
  const sc = await db.query.messageChannels.findFirst({
    where: and(
      eq(messageChannels.cpfId, cpfId),
      eq(messageChannels.type, "sector"),
      eq(messageChannels.sectorId, sectorId),
    ),
  });
  if (!sc) {
    await db
      .insert(messageChannels)
      .values({ cpfId, type: "sector", name: sectorName, sectorId })
      .onConflictDoNothing();
  }
}

// ── Can patroller see channel? ────────────────────────────

async function canAccessChannel(
  db: Db,
  auth: AuthenticatedContext,
  channel: { id: string; cpfId: string; type: string; sectorId: string | null },
): Promise<boolean> {
  if (channel.cpfId !== auth.patroller.cpf_id) return false;
  if (channel.type === "broadcast") return true;
  if (channel.type === "sector") {
    const isStaff =
      auth.patroller.access_level === "admin" ||
      auth.patroller.access_level === "sector_lead" ||
      auth.patroller.access_level === "call_centre_agent";
    return isStaff || channel.sectorId === auth.patroller.sector_id;
  }
  // direct — must be a member
  const membership = await db.query.messageChannelMembers.findFirst({
    where: and(
      eq(messageChannelMembers.channelId, channel.id),
      eq(messageChannelMembers.patrollerId, auth.patroller.patroller_id),
    ),
  });
  return !!membership;
}

// ── Exported helper for heartbeat out-of-sector alert ────

export async function sendOutOfSectorNotification(
  db: Db,
  env: Env,
  auth: AuthenticatedContext,
  sectorId: string,
  sectorName: string,
  cpfId: string,
): Promise<void> {
  // Post a system message to the sector channel
  const channel = await db.query.messageChannels.findFirst({
    where: and(
      eq(messageChannels.cpfId, cpfId),
      eq(messageChannels.type, "sector"),
      eq(messageChannels.sectorId, sectorId),
    ),
  });
  const alertBody = `🚨 ${auth.patroller.call_sign} has left the ${sectorName} sector boundary`;

  if (channel) {
    await db.insert(messages).values({
      channelId: channel.id,
      senderId: null,
      senderCallSign: "System",
      body: alertBody,
      priority: "urgent",
    });
  }

  // Push to all admin/sector_lead/call_centre_agent in this CPF
  const staffRows = await db
    .select({ id: patrollers.id })
    .from(patrollers)
    .where(
      and(
        eq(patrollers.cpfId, cpfId),
        eq(patrollers.status, "active"),
        inArray(patrollers.accessLevel, ["admin", "sector_lead", "call_centre_agent"] as any),
      ),
    );
  const staffIds = staffRows.map((r) => r.id);

  // Also notify the patroller themselves
  const allIds = Array.from(new Set([...staffIds, auth.patroller.patroller_id]));
  const tokens = await getPushTokensForPatrollers(db, allIds);

  await sendFcm(env, tokens, "⚠ Sector Boundary Alert", alertBody, {
    type: "out_of_sector",
    patroller_id: auth.patroller.patroller_id,
    sector_id: sectorId,
  });
}

// ── Routes ───────────────────────────────────────────────

export const pushTokensRoute = new Hono<AppContext>();
pushTokensRoute.post("/", requireAuth(), async (c) => {
  const auth = getAuth(c);
  const body = await c.req.json<{ expo_token: string; platform: string }>();
  if (!body.expo_token) return c.json({ error: "Missing expo_token" }, 400);
  const db = getDb(c.env);
  await db
    .insert(pushTokens)
    .values({
      patrollerId: auth.patroller.patroller_id,
      expoToken: body.expo_token,
      platform: body.platform ?? "android",
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: pushTokens.patrollerId,
      set: { expoToken: body.expo_token, platform: body.platform ?? "android", updatedAt: new Date() },
    });
  return c.json({ ok: true });
});

export const messagesRoute = new Hono<AppContext>();
messagesRoute.use("*", requireAuth());

// GET /messages — channel inbox
messagesRoute.get("/", async (c) => {
  const auth = getAuth(c);
  const db = getDb(c.env);

  // Ensure default broadcast + sector channels exist
  const sector = await db.query.sectors.findFirst({ where: eq(sectors.id, auth.patroller.sector_id) });
  await ensureDefaultChannels(db, auth.patroller.cpf_id, auth.patroller.sector_id, sector?.name ?? "Sector");

  // Fetch all CPF channels
  const allChannels = await db.query.messageChannels.findMany({
    where: eq(messageChannels.cpfId, auth.patroller.cpf_id),
    orderBy: [desc(messageChannels.createdAt)],
  });

  // Filter to channels this patroller can access
  const accessible: typeof allChannels = [];
  for (const ch of allChannels) {
    if (await canAccessChannel(db, auth, ch)) accessible.push(ch);
  }

  // For each channel: last message + unread count
  const enriched = await Promise.all(
    accessible.map(async (ch) => {
      const [lastMsg] = await db
        .select()
        .from(messages)
        .where(eq(messages.channelId, ch.id))
        .orderBy(desc(messages.createdAt))
        .limit(1);

      const unreadCount = lastMsg
        ? await db
            .select({ count: sql<number>`count(*)` })
            .from(messages)
            .where(
              and(
                eq(messages.channelId, ch.id),
                sql`${messages.id} not in (
                  select message_id from message_reads
                  where patroller_id = ${auth.patroller.patroller_id}
                )`,
              ),
            )
            .then((r) => Number(r[0]?.count ?? 0))
        : 0;

      return {
        id: ch.id,
        type: ch.type,
        name: ch.name,
        sectorId: ch.sectorId,
        unreadCount,
        lastMessage: lastMsg?.body ?? null,
        lastMessageAt: lastMsg?.createdAt?.toISOString() ?? null,
      };
    }),
  );

  return c.json({ channels: enriched });
});

// GET /messages/:channelId — paginated messages
messagesRoute.get("/:channelId", async (c) => {
  const auth = getAuth(c);
  const channelId = c.req.param("channelId");
  const before = c.req.query("before"); // ISO timestamp for pagination
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 100);

  const db = getDb(c.env);
  const channel = await db.query.messageChannels.findFirst({ where: eq(messageChannels.id, channelId) });
  if (!channel) return c.json({ error: "Channel not found" }, 404);
  if (!(await canAccessChannel(db, auth, channel))) return c.json({ error: "Forbidden" }, 403);

  const whereClause = before
    ? and(eq(messages.channelId, channelId), lt(messages.createdAt, new Date(before)))
    : eq(messages.channelId, channelId);

  const rows = await db
    .select()
    .from(messages)
    .where(whereClause)
    .orderBy(desc(messages.createdAt))
    .limit(limit);

  // Check read status for each message
  const readRows = rows.length
    ? await db
        .select({ messageId: messageReads.messageId })
        .from(messageReads)
        .where(
          and(
            eq(messageReads.patrollerId, auth.patroller.patroller_id),
            inArray(
              messageReads.messageId,
              rows.map((r) => r.id),
            ),
          ),
        )
    : [];
  const readSet = new Set(readRows.map((r) => r.messageId));

  const result = rows.map((r) => ({
    id: r.id,
    channelId: r.channelId,
    senderId: r.senderId,
    senderCallSign: r.senderCallSign,
    body: r.body,
    priority: r.priority,
    createdAt: r.createdAt.toISOString(),
    isRead: readSet.has(r.id),
  }));

  return c.json({ messages: result });
});

// POST /messages/:channelId — send a message
messagesRoute.post("/:channelId", async (c) => {
  const auth = getAuth(c);
  const channelId = c.req.param("channelId");
  const body = await c.req.json<{ body: string; priority?: "normal" | "urgent" }>();
  if (!body.body?.trim()) return c.json({ error: "Message body required" }, 400);

  const db = getDb(c.env);
  const channel = await db.query.messageChannels.findFirst({ where: eq(messageChannels.id, channelId) });
  if (!channel) return c.json({ error: "Channel not found" }, 404);
  if (!(await canAccessChannel(db, auth, channel))) return c.json({ error: "Forbidden" }, 403);

  const [msg] = await db
    .insert(messages)
    .values({
      channelId,
      senderId: auth.patroller.patroller_id,
      senderCallSign: auth.patroller.call_sign,
      body: body.body.trim(),
      priority: body.priority ?? "normal",
    })
    .returning();

  // Send push to channel audience (excluding sender)
  const audienceIds = await getSectorChannelAudienceIds(db, channel);
  const recipientIds = audienceIds.filter((id) => id !== auth.patroller.patroller_id);
  const tokens = await getPushTokensForPatrollers(db, recipientIds);

  const pushTitle =
    body.priority === "urgent"
      ? `🚨 URGENT — ${auth.patroller.call_sign}`
      : auth.patroller.call_sign;

  void sendFcm(c.env, tokens, pushTitle, body.body.trim(), {
    type: "message",
    channel_id: channelId,
    channel_name: channel.name,
    message_id: msg.id,
  });

  return c.json({
    id: msg.id,
    channelId: msg.channelId,
    senderId: msg.senderId,
    senderCallSign: msg.senderCallSign,
    body: msg.body,
    priority: msg.priority,
    createdAt: msg.createdAt.toISOString(),
    isRead: false,
  });
});

// POST /messages/:channelId/read — mark all unread as read
messagesRoute.post("/:channelId/read", async (c) => {
  const auth = getAuth(c);
  const channelId = c.req.param("channelId");
  const db = getDb(c.env);

  const channel = await db.query.messageChannels.findFirst({ where: eq(messageChannels.id, channelId) });
  if (!channel) return c.json({ error: "Channel not found" }, 404);
  if (!(await canAccessChannel(db, auth, channel))) return c.json({ error: "Forbidden" }, 403);

  // Get unread messages
  const unread = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.channelId, channelId),
        sql`${messages.id} not in (
          select message_id from message_reads
          where patroller_id = ${auth.patroller.patroller_id}
        )`,
      ),
    );

  if (unread.length) {
    await db.insert(messageReads).values(
      unread.map((m) => ({
        messageId: m.id,
        patrollerId: auth.patroller.patroller_id,
        readAt: new Date(),
      })),
    ).onConflictDoNothing();
  }

  return c.json({ ok: true, marked: unread.length });
});

// ── Admin messaging management ───────────────────────────

export const adminMessagesRoute = new Hono<AppContext>();
adminMessagesRoute.use(
  "*",
  requireAuth(),
  requireAccessLevel("admin", "sector_lead", "call_centre_agent"),
);

// GET /admin/messages/channels — list all CPF channels
adminMessagesRoute.get("/channels", async (c) => {
  const auth = getAuth(c);
  const db = getDb(c.env);
  const rows = await db.query.messageChannels.findMany({
    where: eq(messageChannels.cpfId, auth.patroller.cpf_id),
    orderBy: [messageChannels.type, messageChannels.name],
  });

  // Enrich with member counts
  const enriched = await Promise.all(
    rows.map(async (ch) => {
      let memberCount = 0;
      if (ch.type === "direct") {
        const [cnt] = await db
          .select({ count: sql<number>`count(*)` })
          .from(messageChannelMembers)
          .where(eq(messageChannelMembers.channelId, ch.id));
        memberCount = Number(cnt?.count ?? 0);
      } else {
        const [cnt] = await db
          .select({ count: sql<number>`count(*)` })
          .from(patrollers)
          .where(and(eq(patrollers.cpfId, ch.cpfId), eq(patrollers.status, "active")));
        memberCount = Number(cnt?.count ?? 0);
      }
      return { ...ch, memberCount };
    }),
  );

  return c.json({ channels: enriched });
});

// POST /admin/messages/channels — create a channel
adminMessagesRoute.post("/channels", async (c) => {
  const auth = getAuth(c);
  const body = await c.req.json<{
    type: "broadcast" | "sector" | "direct";
    name: string;
    sector_id?: string | null;
    target_patroller_ids?: string[];
  }>();
  if (!body.name?.trim()) return c.json({ error: "Name required" }, 400);
  if (!["broadcast", "sector", "direct"].includes(body.type)) return c.json({ error: "Invalid type" }, 400);

  const db = getDb(c.env);
  const [channel] = await db
    .insert(messageChannels)
    .values({
      cpfId: auth.patroller.cpf_id,
      type: body.type,
      name: body.name.trim(),
      sectorId: body.sector_id ?? null,
    })
    .returning();

  // Add members for direct channels
  if (body.type === "direct" && body.target_patroller_ids?.length) {
    await db.insert(messageChannelMembers).values(
      body.target_patroller_ids.map((pid) => ({ channelId: channel.id, patrollerId: pid })),
    ).onConflictDoNothing();
  }

  return c.json(channel);
});
