// WhatsApp-style messaging — shadcn Message / Bubble composition.

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminFetch, api, authStore } from "../lib/api";
import { Btn, Field, Modal, inputCls } from "../components/Modal";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { Message as ChatMessage, MessageChannel } from "@patrol-log/shared";

function IconSearch({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}
function IconPlus({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function IconChat({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
    </svg>
  );
}
function IconUsers({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M16 11a4 4 0 1 0-4-4 4 4 0 0 0 4 4ZM8 12a3.5 3.5 0 1 0-3.5-3.5A3.5 3.5 0 0 0 8 12Zm8 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4ZM8 14c-.29 0-.62.02-1 .05C4.84 14.34 2 15.27 2 17.5V20h6v-2c0-.77.2-2.18 2.09-3.4A12.3 12.3 0 0 0 8 14Z" />
    </svg>
  );
}
function IconSend({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z" />
    </svg>
  );
}
function IconChecks({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 11" fill="currentColor">
      <path d="M11.071.653a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1-1.06 1.06L11.6 2.244 8.78 5.066a.75.75 0 1 1-1.06-1.06L11.07.653zM7.071.653a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 1 1-1.06 1.06L7.6 2.244 4.78 5.066a.75.75 0 0 1-1.06-1.06L7.07.653zM.72 5.066a.75.75 0 0 1 1.06 0L5 8.286l1.22-1.22a.75.75 0 1 1 1.06 1.06l-1.75 1.75a.75.75 0 0 1-1.06 0L.72 6.126a.75.75 0 0 1 0-1.06z" />
    </svg>
  );
}
function IconTrash({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
    </svg>
  );
}

function fetchChannels() {
  return adminFetch<{ channels: MessageChannel[] }>("/admin/messages/channels");
}
function fetchMessages(channelId: string) {
  return adminFetch<{ messages: ChatMessage[] }>(`/messages/${channelId}`);
}
function sendMessage(channelId: string, body: string, priority: "normal" | "urgent") {
  return adminFetch<ChatMessage>(`/messages/${channelId}`, {
    method: "POST",
    body: JSON.stringify({ body, priority }),
  });
}
function markRead(channelId: string) {
  return adminFetch(`/messages/${channelId}/read`, { method: "POST" });
}
function deleteChannel(channelId: string) {
  return adminFetch<{ ok: boolean; id: string }>(`/admin/messages/channels/${channelId}`, {
    method: "DELETE",
  });
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function ChannelList({
  channels,
  activeId,
  onSelect,
  onNewChat,
  onNewGroup,
  query,
  onQuery,
}: {
  channels: MessageChannel[];
  activeId: string | null;
  onSelect: (ch: MessageChannel) => void;
  onNewChat: () => void;
  onNewGroup: () => void;
  query: string;
  onQuery: (v: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return channels;
    return channels.filter(
      (ch) => ch.name.toLowerCase().includes(q) || (ch.lastMessage?.toLowerCase().includes(q) ?? false),
    );
  }, [channels, query]);

  return (
    <aside className="flex w-[360px] shrink-0 flex-col border-r border-[#e9edef] bg-white">
      <div className="relative flex h-[60px] shrink-0 items-center justify-between bg-[#008069] px-4 text-white">
        <h2 className="text-[17px] font-semibold leading-none">Chats</h2>
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/10"
          aria-label="New chat or group"
        >
          <IconPlus className="h-5 w-5" />
        </button>
        {menuOpen && (
          <>
            <button type="button" className="fixed inset-0 z-20 cursor-default" onClick={() => setMenuOpen(false)} aria-label="Close menu" />
            <div className="absolute right-3 top-full z-30 mt-1 min-w-[180px] overflow-hidden rounded-xl bg-white py-1 text-[#111b21] shadow-lg ring-1 ring-black/5">
              <button
                type="button"
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-[#f0f2f5]"
                onClick={() => {
                  setMenuOpen(false);
                  onNewChat();
                }}
              >
                <IconChat className="h-4 w-4 text-[#008069]" />
                New chat
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-[#f0f2f5]"
                onClick={() => {
                  setMenuOpen(false);
                  onNewGroup();
                }}
              >
                <IconUsers className="h-4 w-4 text-[#008069]" />
                New group
              </button>
            </div>
          </>
        )}
      </div>

      <div className="bg-[#f0f2f5] px-3 py-2">
        <div className="flex items-center gap-3 rounded-lg bg-white px-3 py-2">
          <IconSearch className="h-4 w-4 text-[#54656f]" />
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search or start a chat"
            className="w-full bg-transparent text-sm text-[#111b21] outline-none placeholder:text-[#667781]"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 && (
          <p className="p-6 text-center text-sm text-[#667781]">No chats yet</p>
        )}
        {filtered.map((ch) => {
          const active = activeId === ch.id;
          return (
            <button
              key={ch.id}
              type="button"
              onClick={() => onSelect(ch)}
              className={cn(
                "flex w-full items-center gap-3 border-b border-[#f0f2f5] px-3 py-3 text-left hover:bg-[#f5f6f6]",
                active && "bg-[#f0f2f5]",
              )}
            >
              <Avatar className={cn("h-12 w-12", ch.kind === "group" ? "bg-[#cfe9de]" : "bg-[#dfe5e7]")}>
                <AvatarFallback>
                  {ch.kind === "group" ? "GR" : initials(ch.name) || ch.type.slice(0, 1).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[16px] font-medium text-[#111b21]">{ch.name}</span>
                  <span
                    className={cn(
                      "shrink-0 text-[12px]",
                      ch.unreadCount > 0 ? "font-medium text-[#25d366]" : "text-[#667781]",
                    )}
                  >
                    {formatTime(ch.lastMessageAt)}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-2">
                  <p className="min-w-0 flex-1 truncate text-[13.5px] text-[#667781]">
                    {ch.lastMessage || (ch.kind === "group" ? "Group" : "Chat")}
                  </p>
                  {ch.unreadCount > 0 && (
                    <span className="min-w-[20px] rounded-full bg-[#25d366] px-1.5 py-0.5 text-center text-[11px] font-semibold text-white">
                      {ch.unreadCount > 99 ? "99+" : ch.unreadCount}
                    </span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

const POLL_THREAD_MS = 2_500;
const POLL_CHANNELS_MS = 5_000;

function ChatMessageRow({
  msg,
  myId,
  myCallSign,
  showSender,
}: {
  msg: ChatMessage;
  myId: string;
  myCallSign: string;
  showSender: boolean;
}) {
  const isMe = (!!msg.senderId && msg.senderId === myId) || (!myId && msg.senderCallSign === myCallSign);
  const isSystem = msg.senderId === null;

  if (isSystem) {
    return (
      <div className="my-2 flex justify-center">
        <div className="rounded-lg bg-[#ffeecd] px-3 py-1.5 text-center text-[12.5px] text-[#54656f]">
          {msg.body}
        </div>
      </div>
    );
  }

  // Match mobile bubble card: call sign inside bubble for groups, no side avatar.
  return (
    <div className={cn("mb-1 flex w-full", isMe ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[82%] rounded-lg px-2.5 py-1.5 text-[15px] leading-5 shadow-sm",
          isMe ? "rounded-tr-sm bg-[#d9fdd3] text-[#111b21]" : "rounded-tl-sm bg-white text-[#111b21]",
          msg.priority === "urgent" && "ring-2 ring-[#e11900]",
        )}
      >
        {showSender && !isMe && (
          <div className="mb-0.5 text-[12.5px] font-bold text-[#008069]">{msg.senderCallSign}</div>
        )}
        {msg.priority === "urgent" && (
          <div className="mb-0.5 text-[11px] font-extrabold uppercase tracking-wide text-[#e11900]">Urgent</div>
        )}
        <div className="whitespace-pre-wrap break-words">{msg.body}</div>
        <div className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-[#667781]">
          <span>{formatTime(msg.createdAt)}</span>
          {isMe && <IconChecks className="h-3.5 w-3.5 text-[#53bdeb]" />}
        </div>
      </div>
    </div>
  );
}

function IconUrgent({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2a1 1 0 0 1 1 1v11a1 1 0 1 1-2 0V3a1 1 0 0 1 1-1Zm0 16a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z" />
    </svg>
  );
}

function ThreadPanel({
  channel,
  onDeleted,
}: {
  channel: MessageChannel;
  onDeleted: () => void;
}) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [priority, setPriority] = useState<"normal" | "urgent">("normal");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const primedRef = useRef(false);
  const profile = authStore.getProfile();
  const myCallSign = profile?.call_sign ?? "";
  const myId = profile?.patroller_id ?? "";
  const kindLabel = channel.kind === "group" ? "group" : "chat";

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["messages", channel.id],
    queryFn: () => fetchMessages(channel.id),
    refetchInterval: POLL_THREAD_MS,
    refetchIntervalInBackground: true,
    retry: 1,
  });

  const messages = [...(data?.messages ?? [])].reverse();

  useEffect(() => {
    primedRef.current = false;
    seenIdsRef.current = new Set();
    void markRead(channel.id).then(() => {
      qc.invalidateQueries({ queryKey: ["admin.messages.channels"] });
    });
  }, [channel.id, qc]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  useEffect(() => {
    const ids = messages.map((m) => m.id);
    if (!primedRef.current) {
      seenIdsRef.current = new Set(ids);
      primedRef.current = true;
      return;
    }
    const incoming = messages.filter(
      (m) => !seenIdsRef.current.has(m.id) && m.senderId !== myId && m.senderCallSign !== myCallSign,
    );
    for (const m of messages) seenIdsRef.current.add(m.id);
    if (incoming.length === 0) return;

    const latest = incoming[incoming.length - 1];
    const title = `${latest.senderCallSign} · ${channel.name}`;
    if (typeof Notification !== "undefined") {
      if (Notification.permission === "granted") {
        new Notification(title, { body: latest.body, tag: `msg-${latest.id}` });
      } else if (Notification.permission === "default") {
        void Notification.requestPermission().then((perm) => {
          if (perm === "granted") new Notification(title, { body: latest.body, tag: `msg-${latest.id}` });
        });
      }
    }
    void markRead(channel.id);
    qc.invalidateQueries({ queryKey: ["admin.messages.channels"] });
  }, [messages, channel.id, channel.name, myId, myCallSign, qc]);

  const send = useMutation({
    mutationFn: () => sendMessage(channel.id, text.trim(), priority),
    onSuccess: () => {
      setText("");
      setPriority("normal");
      qc.invalidateQueries({ queryKey: ["messages", channel.id] });
      qc.invalidateQueries({ queryKey: ["admin.messages.channels"] });
    },
  });

  const remove = useMutation({
    mutationFn: () => deleteChannel(channel.id),
    onSuccess: () => {
      setConfirmDelete(false);
      qc.removeQueries({ queryKey: ["messages", channel.id] });
      void qc.invalidateQueries({ queryKey: ["admin.messages.channels"] });
      onDeleted();
    },
  });

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (text.trim()) send.mutate();
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#efeae2]">
      <div className="flex h-[60px] shrink-0 items-center gap-3 bg-[#008069] px-4 text-white">
        <Avatar className="h-10 w-10 shrink-0 bg-white/20 text-white">
          <AvatarFallback className="bg-transparent text-white">
            {channel.kind === "group" ? "GR" : initials(channel.name)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1 leading-tight">
          <h3 className="truncate text-[16px] font-medium leading-5">{channel.name}</h3>
          <p className="truncate text-[12.5px] leading-4 text-white/80">
            {channel.kind === "group"
              ? `Group · ${channel.memberCount || "—"} participants`
              : "Direct message"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          disabled={remove.isPending}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/90 hover:bg-white/15 disabled:opacity-50"
          aria-label="Delete conversation"
          title="Delete chat or group"
        >
          <IconTrash className="h-5 w-5" />
        </button>
      </div>

      <Modal
        open={confirmDelete}
        onClose={() => !remove.isPending && setConfirmDelete(false)}
        title={`Delete ${kindLabel}?`}
        size="sm"
        footer={
          <>
            <Btn variant="ghost" onClick={() => setConfirmDelete(false)} disabled={remove.isPending}>
              Cancel
            </Btn>
            <Btn variant="danger" onClick={() => remove.mutate()} disabled={remove.isPending}>
              {remove.isPending ? "Deleting…" : "Delete"}
            </Btn>
          </>
        }
      >
        <p className="text-sm text-gray-600">
          <span className="font-medium text-gray-900">{channel.name}</span> and all of its messages
          will be permanently removed. This can’t be undone.
        </p>
        {remove.isError && (
          <p className="mt-3 text-sm text-red-600">
            {remove.error instanceof Error ? remove.error.message : "Delete failed."}
          </p>
        )}
      </Modal>

      <div
        className="flex-1 overflow-y-auto px-4 py-3"
        style={{
          backgroundImage:
            "linear-gradient(rgba(239,234,226,0.92), rgba(239,234,226,0.92)), url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23d5cec4' fill-opacity='0.35'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")",
        }}
      >
        {isLoading ? (
          <p className="py-10 text-center text-sm text-[#667781]">Loading messages…</p>
        ) : isError ? (
          <div className="mx-auto mt-10 max-w-sm rounded-lg bg-[#ffeecd] px-4 py-3 text-center text-[13px] text-[#54656f] shadow-sm">
            <p>Couldn’t load messages{error instanceof Error ? `: ${error.message}` : "."}</p>
            <button
              type="button"
              className="mt-2 text-[#008069] underline"
              onClick={() => void refetch()}
            >
              Retry
            </button>
          </div>
        ) : messages.length === 0 ? (
          <div className="mx-auto mt-10 max-w-sm rounded-lg bg-[#ffeecd] px-4 py-3 text-center text-[13px] text-[#54656f] shadow-sm">
            Messages stay in your CPF channel. Say hello to get started.
          </div>
        ) : (
          messages.map((m) => (
            <ChatMessageRow
              key={m.id}
              msg={m}
              myId={myId}
              myCallSign={myCallSign}
              showSender={channel.kind === "group"}
            />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <div className="bg-[#f0f2f5] px-3 py-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPriority((p) => (p === "urgent" ? "normal" : "urgent"))}
            className={cn(
              "flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full",
              priority === "urgent" ? "bg-[#e11900] text-white" : "bg-white text-[#54656f] shadow-sm",
            )}
            aria-label="Toggle urgent"
            title="Urgent"
          >
            <IconUrgent className="h-4 w-4" />
          </button>
          <div className="flex min-h-[42px] flex-1 items-center rounded-[21px] bg-white px-4 shadow-sm">
            <textarea
              className="max-h-28 w-full resize-none bg-transparent py-2.5 text-[15px] leading-5 text-[#111b21] outline-none placeholder:text-[#667781]"
              rows={1}
              placeholder="Type a message"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          </div>
          <button
            type="button"
            disabled={!text.trim() || send.isPending}
            onClick={() => send.mutate()}
            className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full bg-[#008069] text-white disabled:opacity-40"
            aria-label="Send"
          >
            <IconSend className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}

interface MemberOption {
  id: string;
  callSign: string;
  name: string;
  status: string;
}

function useActiveMembers(enabled: boolean) {
  const myId = authStore.getProfile()?.patroller_id as string | undefined;
  const { data } = useQuery({
    queryKey: ["admin.members"],
    queryFn: () => adminFetch<{ results: MemberOption[] }>("/admin/members"),
    enabled,
  });
  return (data?.results ?? []).filter((m) => m.status === "active" && m.id !== myId);
}

function NewChatModal({
  open,
  onClose,
  onOpened,
}: {
  open: boolean;
  onClose: () => void;
  onOpened: (channel: MessageChannel) => void;
}) {
  const [filter, setFilter] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const members = useActiveMembers(open);
  const filtered = members.filter((m) => {
    const term = filter.trim().toLowerCase();
    if (!term) return true;
    return m.callSign.toLowerCase().includes(term) || m.name.toLowerCase().includes(term);
  });

  async function openChat(member: MemberOption) {
    if (pendingId) return;
    setPendingId(member.id);
    try {
      const ch = await api.openDirectChannel(member.id);
      onOpened({
        id: ch.id,
        type: "direct",
        kind: "chat",
        name: ch.name || member.callSign,
        sectorId: ch.sectorId,
        memberCount: ch.memberCount ?? 2,
        unreadCount: 0,
        lastMessage: null,
        lastMessageAt: null,
      });
      onClose();
      setFilter("");
    } catch (err) {
      console.warn("[admin messaging] open chat failed", err);
      window.alert(err instanceof Error ? err.message : "Could not open chat");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New chat" footer={<Btn variant="ghost" onClick={onClose}>Cancel</Btn>}>
      <Field label="Search contacts">
        <input
          className={inputCls}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search call sign or name"
          autoFocus
        />
      </Field>
      <div className="mt-2 max-h-72 overflow-y-auto rounded-md border border-[#d1d7db]">
        {filtered.length === 0 ? (
          <p className="px-3 py-4 text-center text-sm text-[#667781]">No members found</p>
        ) : (
          filtered.map((m) => (
            <button
              key={m.id}
              type="button"
              disabled={!!pendingId}
              onClick={() => void openChat(m)}
              className="flex w-full items-center gap-3 border-b border-[#e9edef] px-3 py-2.5 text-left last:border-b-0 hover:bg-[#f0f2f5] disabled:opacity-50"
            >
              <Avatar className="h-10 w-10 bg-[#dfe5e7]">
                <AvatarFallback>{m.callSign.slice(0, 2)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-[#111b21]">{m.name}</div>
                <div className="text-xs text-[#667781]">{m.callSign}</div>
              </div>
              {pendingId === m.id && <span className="text-xs text-[#008069]">Opening…</span>}
            </button>
          ))
        )}
      </div>
    </Modal>
  );
}

function NewGroupModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (channel: MessageChannel) => void;
}) {
  const [step, setStep] = useState<"members" | "name">("members");
  const [name, setName] = useState("");
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [memberFilter, setMemberFilter] = useState("");
  const members = useActiveMembers(open);
  const filteredMembers = members.filter((m) => {
    const term = memberFilter.trim().toLowerCase();
    if (!term) return true;
    return m.callSign.toLowerCase().includes(term) || m.name.toLowerCase().includes(term);
  });

  function reset() {
    setStep("members");
    setName("");
    setMemberIds([]);
    setMemberFilter("");
  }

  function toggleMember(id: string) {
    setMemberIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const create = useMutation({
    mutationFn: () => api.createGroup({ name: name.trim(), member_ids: memberIds }),
    onSuccess: (ch) => {
      onCreated({
        id: ch.id,
        type: "direct",
        kind: "group",
        name: ch.name,
        sectorId: ch.sectorId,
        memberCount: ch.memberCount,
        unreadCount: 0,
        lastMessage: null,
        lastMessageAt: null,
      });
      onClose();
      reset();
    },
  });

  return (
    <Modal
      open={open}
      onClose={() => {
        onClose();
        reset();
      }}
      title={step === "members" ? "Add group participants" : "New group"}
      footer={
        step === "members" ? (
          <>
            <Btn
              variant="ghost"
              onClick={() => {
                onClose();
                reset();
              }}
            >
              Cancel
            </Btn>
            <Btn disabled={memberIds.length < 1} onClick={() => setStep("name")}>
              Next
            </Btn>
          </>
        ) : (
          <>
            <Btn variant="ghost" onClick={() => setStep("members")}>
              Back
            </Btn>
            <Btn
              disabled={create.isPending || !name.trim()}
              onClick={() => create.mutate()}
            >
              {create.isPending ? "Creating…" : "Create"}
            </Btn>
          </>
        )
      }
    >
      {step === "members" ? (
        <Field label={`Participants${memberIds.length ? ` (${memberIds.length})` : ""}`} required>
          <input
            className={cn(inputCls, "mb-2")}
            value={memberFilter}
            onChange={(e) => setMemberFilter(e.target.value)}
            placeholder="Search call sign or name"
            autoFocus
          />
          <div className="max-h-64 overflow-y-auto rounded-md border border-[#d1d7db]">
            {filteredMembers.length === 0 ? (
              <p className="px-3 py-2 text-sm text-[#667781]">No members found</p>
            ) : (
              filteredMembers.map((m) => {
                const checked = memberIds.includes(m.id);
                return (
                  <label
                    key={m.id}
                    className="flex cursor-pointer items-center gap-2 border-b border-[#e9edef] px-3 py-2 text-sm last:border-b-0 hover:bg-[#f0f2f5]"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleMember(m.id)}
                      className="rounded border-gray-300"
                    />
                    <span className="font-medium text-[#111b21]">{m.callSign}</span>
                    <span className="truncate text-[#667781]">{m.name}</span>
                  </label>
                );
              })
            )}
          </div>
        </Field>
      ) : (
        <Field label="Group subject" required>
          <input
            className={inputCls}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Night Shift"
            autoFocus
            maxLength={60}
          />
          <p className="mt-2 text-[11px] text-[#667781]">
            {memberIds.length} participant{memberIds.length === 1 ? "" : "s"} selected. You are added automatically.
          </p>
        </Field>
      )}
    </Modal>
  );
}

export function MessagingPage() {
  const qc = useQueryClient();
  const [activeChannel, setActiveChannel] = useState<MessageChannel | null>(null);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [query, setQuery] = useState("");

  const { data } = useQuery({
    queryKey: ["admin.messages.channels"],
    queryFn: fetchChannels,
    refetchInterval: POLL_CHANNELS_MS,
    refetchIntervalInBackground: true,
  });
  const channels: MessageChannel[] = data?.channels ?? [];
  const totalUnread = channels.reduce((sum, ch) => sum + (ch.unreadCount ?? 0), 0);

  useEffect(() => {
    if (!activeChannel && channels.length > 0) setActiveChannel(channels[0]);
  }, [channels, activeChannel]);

  useEffect(() => {
    const base = "Patrol Log Admin";
    document.title = totalUnread > 0 ? `(${totalUnread}) Messaging · ${base}` : base;
    return () => {
      document.title = base;
    };
  }, [totalUnread]);

  function selectCreated(ch: MessageChannel) {
    void qc.invalidateQueries({ queryKey: ["admin.messages.channels"] });
    setActiveChannel(ch);
  }

  return (
    <div className="flex h-full -m-6 overflow-hidden bg-white">
      <ChannelList
        channels={channels}
        activeId={activeChannel?.id ?? null}
        onSelect={setActiveChannel}
        onNewChat={() => setNewChatOpen(true)}
        onNewGroup={() => setNewGroupOpen(true)}
        query={query}
        onQuery={setQuery}
      />

      {activeChannel ? (
        <ThreadPanel
          key={activeChannel.id}
          channel={activeChannel}
          onDeleted={() => setActiveChannel(null)}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center bg-[#f0f2f5]">
          <div className="max-w-md text-center text-[#667781]">
            <p className="text-2xl font-light text-[#41525d]">Patrol Log messaging</p>
            <p className="mt-2 text-sm">Select a chat, or use + for a new chat or group.</p>
          </div>
        </div>
      )}

      <NewChatModal
        open={newChatOpen}
        onClose={() => setNewChatOpen(false)}
        onOpened={selectCreated}
      />
      <NewGroupModal
        open={newGroupOpen}
        onClose={() => setNewGroupOpen(false)}
        onCreated={selectCreated}
      />
    </div>
  );
}
