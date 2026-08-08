// Messaging center: broadcast / sector / direct channels.
// Two-way: any authenticated patroller can send and reply.
// Admin/sector_lead/call_centre_agent can manage channels.
//
// NOTE: Firebase Cloud Messaging (FCM) push notifications have been removed.
// All notifications are delivered as in-app messages only.

import { Hono } from "hono";
import { and, desc, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
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
import type { AuthenticatedContext } from "../env.js";

type ChannelRow = typeof messageChannels.$inferSelect;

/** Ensure SQLite UTC timestamps without Z are returned as ISO so clients don't show −2h. */
function toIsoUtc(value: string | null | undefined): string | null {
  if (!value) return null;
  const t = value.trim();
  if (!t) return null;
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(t)) return t;
  const withT = t.includes("T") ? t : t.replace(" ", "T");
  return withT.endsWith("Z") ? withT : `${withT}Z`;
}

async function countUnreadForPatroller(
  db: Db,
  channelId: string,
  patrollerId: string,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(messages)
    .where(
      and(
        eq(messages.channelId, channelId),
        or(isNull(messages.senderId), ne(messages.senderId, patrollerId)),
        sql`${messages.id} not in (
          select message_id from message_reads
          where patroller_id = ${patrollerId}
        )`,
      ),
    );
  return Number(row?.count ?? 0);
}

/** For 1:1 DMs, each viewer sees the other member's call sign — not their own. */
async function directChannelDisplayName(
  db: Db,
  channelId: string,
  viewerId: string,
  fallback: string,
): Promise<string> {
  const members = await db
    .select({
      patrollerId: messageChannelMembers.patrollerId,
      callSign: patrollers.callSign,
    })
    .from(messageChannelMembers)
    .innerJoin(patrollers, eq(patrollers.id, messageChannelMembers.patrollerId))
    .where(eq(messageChannelMembers.channelId, channelId));

  const others = members.filter((m) => m.patrollerId !== viewerId);
  if (others.length === 1) return others[0].callSign;
  if (others.length > 1) return others.map((o) => o.callSign).join(" · ");
  return fallback;
}

function isSystemAdmin(auth: AuthenticatedContext): boolean {
  return auth.patroller.access_level === "system_admin";
}

async function enrichChannelForPatroller(
  db: Db,
  ch: ChannelRow,
  patrollerId: string,
  memberCountHint?: number,
) {
  const [lastMsg] = await db
    .select()
    .from(messages)
    .where(eq(messages.channelId, ch.id))
    .orderBy(desc(messages.createdAt))
    .limit(1);

  const memberCount = memberCountHint ?? (await countChannelMembers(db, ch));
  const kind: "chat" | "group" =
    ch.type === "direct" && memberCount === 2 ? "chat" : "group";

  const name =
    kind === "chat"
      ? await directChannelDisplayName(db, ch.id, patrollerId, ch.name)
      : ch.name;

  const unreadCount = lastMsg ? await countUnreadForPatroller(db, ch.id, patrollerId) : 0;

  let lastMessage: string | null = lastMsg?.body ?? null;
  if (lastMsg && kind === "group") {
    const prefix =
      lastMsg.senderId === patrollerId
        ? "You"
        : lastMsg.senderId === null
          ? "System"
          : lastMsg.senderCallSign;
    lastMessage = `${prefix}: ${lastMsg.body}`;
  }

  return {
    id: ch.id,
    type: ch.type,
    kind,
    name,
    sectorId: ch.sectorId,
    memberCount,
    unreadCount,
    lastMessage,
    lastMessageAt: toIsoUtc(lastMsg?.createdAt) ?? null,
  };
}

function sortChannelsByActivity<T extends { lastMessageAt: string | null; name: string }>(
  channels: T[],
): T[] {
  return [...channels].sort((a, b) => {
    if (a.lastMessageAt && b.lastMessageAt) {
      return b.lastMessageAt.localeCompare(a.lastMessageAt);
    }
    if (a.lastMessageAt) return -1;
    if (b.lastMessageAt) return 1;
    return a.name.localeCompare(b.name);
  });
}

async function countChannelMembers(db: Db, ch: ChannelRow): Promise<number> {
  if (ch.type === "direct") {
    const [cnt] = await db
      .select({ count: sql<number>`count(*)` })
      .from(messageChannelMembers)
      .where(eq(messageChannelMembers.channelId, ch.id));
    return Number(cnt?.count ?? 0);
  }
  if (ch.type === "sector" && ch.sectorId) {
    const [cnt] = await db
      .select({ count: sql<number>`count(*)` })
      .from(patrollers)
      .where(
        and(
          eq(patrollers.cpfId, ch.cpfId),
          eq(patrollers.sectorId, ch.sectorId),
          eq(patrollers.status, "active"),
        ),
      );
    return Number(cnt?.count ?? 0);
  }
  const [cnt] = await db
    .select({ count: sql<number>`count(*)` })
    .from(patrollers)
    .where(and(eq(patrollers.cpfId, ch.cpfId), eq(patrollers.status, "active")));
  return Number(cnt?.count ?? 0);
}

// ── Lazy channel creation ────────────────────────────────

async function ensureDefaultChannels(
  db: Db,
  cpfId: string,
  sectorId: string,
  sectorName: string,
): Promise<void> {
  const bc = await db.query.messageChannels.findFirst({
    where: and(eq(messageChannels.cpfId, cpfId), eq(messageChannels.type, "broadcast")),
  });
  if (!bc) {
    await db
      .insert(messageChannels)
      .values({ cpfId, type: "broadcast", name: "All Patrollers" })
      .onConflictDoNothing();
  }

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

/**
 * Access rules (WhatsApp-style):
 * - sector chat: only that sector (system_admin may open any sector channel)
 * - DM (exactly 2 people): ONLY those two — not admin, not system_admin, not sector lead
 * - group: only people in message_channel_members
 * - broadcast: system_admin only
 */
async function isChannelMember(db: Db, channelId: string, patrollerId: string): Promise<boolean> {
  const membership = await db.query.messageChannelMembers.findFirst({
    where: and(
      eq(messageChannelMembers.channelId, channelId),
      eq(messageChannelMembers.patrollerId, patrollerId),
    ),
  });
  return !!membership;
}

async function canAccessChannel(
  db: Db,
  auth: AuthenticatedContext,
  channel: { id: string; cpfId: string; type: string; sectorId: string | null },
): Promise<boolean> {
  if (channel.cpfId !== auth.patroller.cpf_id) return false;

  if (channel.type === "broadcast") {
    return isSystemAdmin(auth);
  }

  if (channel.type === "sector") {
    if (isSystemAdmin(auth)) return true;
    return channel.sectorId === auth.patroller.sector_id;
  }

  // type === "direct" (1:1 chat OR group): membership is the only key.
  // No role bypass — same as WhatsApp private chats.
  return isChannelMember(db, channel.id, auth.patroller.patroller_id);
}

// ── Exported helper for heartbeat out-of-sector alert ────
// Now sends only in-app messages (no FCM push).

export async function sendOutOfSectorNotification(
  db: Db,
  auth: AuthenticatedContext,
  sectorId: string,
  sectorName: string,
  cpfId: string,
): Promise<void> {
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
      createdAt: new Date().toISOString(),
    });
  }
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
      updatedAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: pushTokens.patrollerId,
      set: { expoToken: body.expo_token, platform: body.platform ?? "android", updatedAt: new Date().toISOString() },
    });
  return c.json({ ok: true });
});

export const messagesRoute = new Hono<AppContext>();
messagesRoute.use("*", requireAuth());

messagesRoute.get("/", async (c) => {
  const auth = getAuth(c);
  const db = getDb(c.env);

  const sector = await db.query.sectors.findFirst({ where: eq(sectors.id, auth.patroller.sector_id) });
  await ensureDefaultChannels(db, auth.patroller.cpf_id, auth.patroller.sector_id, sector?.name ?? "Sector");

  const allChannels = await db.query.messageChannels.findMany({
    where: eq(messageChannels.cpfId, auth.patroller.cpf_id),
    orderBy: [desc(messageChannels.createdAt)],
  });

  const accessible: typeof allChannels = [];
  for (const ch of allChannels) {
    if (await canAccessChannel(db, auth, ch)) accessible.push(ch);
  }

  const enriched = await Promise.all(
    accessible.map((ch) => enrichChannelForPatroller(db, ch, auth.patroller.patroller_id)),
  );

  return c.json({ channels: sortChannelsByActivity(enriched) });
});

/** Open or create a 1:1 direct channel with another CPF member. */
messagesRoute.post("/direct", async (c) => {
  const auth = getAuth(c);
  const body = await c.req.json<{ target_patroller_id?: string }>();
  const targetId = body.target_patroller_id?.trim();
  if (!targetId) return c.json({ error: "target_patroller_id required" }, 400);

  const meId = auth.patroller.patroller_id;
  if (targetId === meId) return c.json({ error: "Cannot message yourself" }, 400);

  const db = getDb(c.env);
  const target = await db.query.patrollers.findFirst({
    where: and(eq(patrollers.id, targetId), eq(patrollers.cpfId, auth.patroller.cpf_id)),
  });
  if (!target || target.status !== "active") return c.json({ error: "Member not found" }, 404);
  // DMs stay inside the sector (system_admin may message anyone in the CPF).
  if (!isSystemAdmin(auth) && target.sectorId !== auth.patroller.sector_id) {
    return c.json({ error: "Direct messages are only within your sector" }, 403);
  }

  const directs = await db.query.messageChannels.findMany({
    where: and(eq(messageChannels.cpfId, auth.patroller.cpf_id), eq(messageChannels.type, "direct")),
  });

  for (const ch of directs) {
    const members = await db
      .select({ patrollerId: messageChannelMembers.patrollerId })
      .from(messageChannelMembers)
      .where(eq(messageChannelMembers.channelId, ch.id));
    const ids = new Set(members.map((m) => m.patrollerId));
    if (ids.size === 2 && ids.has(meId) && ids.has(targetId)) {
      return c.json({
        id: ch.id,
        type: ch.type,
        kind: "chat" as const,
        name: target.callSign,
        sectorId: ch.sectorId,
        memberCount: 2,
      });
    }
  }

  const [channel] = await db
    .insert(messageChannels)
    .values({
      cpfId: auth.patroller.cpf_id,
      type: "direct",
      name: [auth.patroller.call_sign, target.callSign].sort().join(" · "),
      sectorId: auth.patroller.sector_id,
    })
    .returning();

  await db.insert(messageChannelMembers).values([
    { channelId: channel.id, patrollerId: meId },
    { channelId: channel.id, patrollerId: targetId },
  ]);

  return c.json({
    id: channel.id,
    type: channel.type,
    kind: "chat" as const,
    name: target.callSign,
    sectorId: channel.sectorId,
    memberCount: 2,
  });
});

/** Create a WhatsApp-style group (named multi-member channel). */
messagesRoute.post("/groups", async (c) => {
  const auth = getAuth(c);
  const body = await c.req.json<{ name?: string; member_ids?: string[] }>();
  const name = body.name?.trim();
  const memberIds = [...new Set((body.member_ids ?? []).filter(Boolean))];
  if (!name) return c.json({ error: "Group name required" }, 400);
  if (memberIds.length < 1) return c.json({ error: "Add at least one member" }, 400);

  const meId = auth.patroller.patroller_id;
  const db = getDb(c.env);

  const targets = await db
    .select({
      id: patrollers.id,
      callSign: patrollers.callSign,
      status: patrollers.status,
      sectorId: patrollers.sectorId,
    })
    .from(patrollers)
    .where(and(eq(patrollers.cpfId, auth.patroller.cpf_id), inArray(patrollers.id, memberIds)));

  const activeSameSector = targets.filter(
    (t) =>
      t.status === "active" &&
      (isSystemAdmin(auth) || t.sectorId === auth.patroller.sector_id),
  );
  const activeIds = activeSameSector.map((t) => t.id);
  if (!activeIds.length) return c.json({ error: "No valid members in your sector" }, 400);

  const allIds = new Set([meId, ...activeIds]);

  const [channel] = await db
    .insert(messageChannels)
    .values({
      cpfId: auth.patroller.cpf_id,
      type: "direct",
      name,
      sectorId: auth.patroller.sector_id,
    })
    .returning();

  await db.insert(messageChannelMembers).values(
    [...allIds].map((pid) => ({ channelId: channel.id, patrollerId: pid })),
  );

  return c.json({
    id: channel.id,
    type: channel.type,
    kind: "group" as const,
    name: channel.name,
    sectorId: channel.sectorId,
    memberCount: allIds.size,
  });
});

messagesRoute.get("/:channelId/members", async (c) => {
  const auth = getAuth(c);
  const channelId = c.req.param("channelId");
  const db = getDb(c.env);
  const channel = await db.query.messageChannels.findFirst({ where: eq(messageChannels.id, channelId) });
  if (!channel) return c.json({ error: "Channel not found" }, 404);
  if (!(await canAccessChannel(db, auth, channel))) return c.json({ error: "Forbidden" }, 403);

  let members: { patrollerId: string; callSign: string; name: string }[] = [];

  if (channel.type === "direct") {
    members = await db
      .select({
        patrollerId: patrollers.id,
        callSign: patrollers.callSign,
        name: patrollers.name,
      })
      .from(messageChannelMembers)
      .innerJoin(patrollers, eq(patrollers.id, messageChannelMembers.patrollerId))
      .where(eq(messageChannelMembers.channelId, channel.id))
      .orderBy(patrollers.callSign);
  } else if (channel.type === "broadcast") {
    members = await db
      .select({
        patrollerId: patrollers.id,
        callSign: patrollers.callSign,
        name: patrollers.name,
      })
      .from(patrollers)
      .where(and(eq(patrollers.cpfId, channel.cpfId), eq(patrollers.status, "active")))
      .orderBy(patrollers.callSign);
  } else if (channel.type === "sector" && channel.sectorId) {
    members = await db
      .select({
        patrollerId: patrollers.id,
        callSign: patrollers.callSign,
        name: patrollers.name,
      })
      .from(patrollers)
      .where(
        and(
          eq(patrollers.cpfId, channel.cpfId),
          eq(patrollers.sectorId, channel.sectorId),
          eq(patrollers.status, "active"),
        ),
      )
      .orderBy(patrollers.callSign);
  }

  return c.json({
    channelId: channel.id,
    kind: channel.type === "direct" && members.length === 2 ? "chat" : "group",
    name: channel.name,
    members,
  });
});

messagesRoute.get("/:channelId", async (c) => {
  const auth = getAuth(c);
  const channelId = c.req.param("channelId");
  const before = c.req.query("before");
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 100);

  const db = getDb(c.env);
  const channel = await db.query.messageChannels.findFirst({ where: eq(messageChannels.id, channelId) });
  if (!channel) return c.json({ error: "Channel not found" }, 404);
  if (!(await canAccessChannel(db, auth, channel))) return c.json({ error: "Forbidden" }, 403);

  const whereClause = before
    ? and(eq(messages.channelId, channelId), lt(messages.createdAt, before))
    : eq(messages.channelId, channelId);

  const rows = await db
    .select()
    .from(messages)
    .where(whereClause)
    .orderBy(desc(messages.createdAt))
    .limit(limit);

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
    createdAt: toIsoUtc(r.createdAt) ?? r.createdAt,
    isRead: readSet.has(r.id),
  }));

  return c.json({ messages: result });
});

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
      createdAt: new Date().toISOString(),
    })
    .returning();

  await db
    .insert(messageReads)
    .values({
      messageId: msg.id,
      patrollerId: auth.patroller.patroller_id,
      readAt: new Date().toISOString(),
    })
    .onConflictDoNothing();

  return c.json({
    id: msg.id,
    channelId: msg.channelId,
    senderId: msg.senderId,
    senderCallSign: msg.senderCallSign,
    body: msg.body,
    priority: msg.priority,
    createdAt: toIsoUtc(msg.createdAt) ?? msg.createdAt,
    isRead: true,
  });
});

messagesRoute.post("/:channelId/read", async (c) => {
  const auth = getAuth(c);
  const channelId = c.req.param("channelId");
  const db = getDb(c.env);

  const channel = await db.query.messageChannels.findFirst({ where: eq(messageChannels.id, channelId) });
  if (!channel) return c.json({ error: "Channel not found" }, 404);
  if (!(await canAccessChannel(db, auth, channel))) return c.json({ error: "Forbidden" }, 403);

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
        readAt: new Date().toISOString(),
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
  requireAccessLevel("system_admin", "admin", "sector_lead", "call_centre_agent"),
);

adminMessagesRoute.get("/channels", async (c) => {
  const auth = getAuth(c);
  const db = getDb(c.env);

  const sector = await db.query.sectors.findFirst({ where: eq(sectors.id, auth.patroller.sector_id) });
  await ensureDefaultChannels(db, auth.patroller.cpf_id, auth.patroller.sector_id, sector?.name ?? "Sector");

  // system_admin: ensure a sector channel exists for every sector
  if (isSystemAdmin(auth)) {
    const allSectors = await db
      .select()
      .from(sectors)
      .where(eq(sectors.cpfId, auth.patroller.cpf_id));
    for (const s of allSectors) {
      await ensureDefaultChannels(db, auth.patroller.cpf_id, s.id, s.code || s.name);
    }
  }

  const rows = await db.query.messageChannels.findMany({
    where: eq(messageChannels.cpfId, auth.patroller.cpf_id),
    orderBy: [messageChannels.type, messageChannels.name],
  });

  const accessible: typeof rows = [];
  for (const ch of rows) {
    if (await canAccessChannel(db, auth, ch)) accessible.push(ch);
  }

  const enriched = await Promise.all(
    accessible.map(async (ch) => {
      const memberCount = await countChannelMembers(db, ch);
      return enrichChannelForPatroller(db, ch, auth.patroller.patroller_id, memberCount);
    }),
  );

  return c.json({ channels: sortChannelsByActivity(enriched) });
});

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

  const sectorId =
    body.type === "sector"
      ? body.sector_id ?? auth.patroller.sector_id
      : body.type === "direct"
        ? auth.patroller.sector_id
        : null;

  if (body.type === "sector" && !sectorId) {
    return c.json({ error: "sector_id required for sector channels" }, 400);
  }
  if (body.type === "sector" && !isSystemAdmin(auth) && sectorId !== auth.patroller.sector_id) {
    return c.json({ error: "You can only create channels for your sector" }, 403);
  }
  if (body.type === "broadcast" && !isSystemAdmin(auth)) {
    return c.json({ error: "Only system admin can create broadcast channels" }, 403);
  }
  if (body.type === "direct") {
    const others = [...new Set((body.target_patroller_ids ?? []).filter(Boolean))];
    if (others.length !== 1) {
      return c.json(
        { error: "Direct chat must be with exactly one other person (use a group for more)" },
        400,
      );
    }
  }

  const db = getDb(c.env);
  const [channel] = await db
    .insert(messageChannels)
    .values({
      cpfId: auth.patroller.cpf_id,
      type: body.type,
      name: body.name.trim(),
      sectorId,
    })
    .returning();

  if (body.type === "direct") {
    const otherId = body.target_patroller_ids![0]!;
    // Exactly two members — creator + one other. Nobody else can join or see this chat.
    await db
      .insert(messageChannelMembers)
      .values([
        { channelId: channel.id, patrollerId: auth.patroller.patroller_id },
        { channelId: channel.id, patrollerId: otherId },
      ])
      .onConflictDoNothing();
  }

  return c.json(channel);
});

adminMessagesRoute.delete("/channels/:channelId", async (c) => {
  const auth = getAuth(c);
  const channelId = c.req.param("channelId");
  const db = getDb(c.env);

  const channel = await db.query.messageChannels.findFirst({
    where: and(eq(messageChannels.id, channelId), eq(messageChannels.cpfId, auth.patroller.cpf_id)),
  });
  if (!channel) return c.json({ error: "Channel not found" }, 404);
  if (!(await canAccessChannel(db, auth, channel))) return c.json({ error: "Forbidden" }, 403);

  // Sector defaults recreate via ensureDefaultChannels; DMs/groups only deletable by members.
  await db.delete(messageChannels).where(eq(messageChannels.id, channelId));
  return c.json({ ok: true, id: channelId });
});
