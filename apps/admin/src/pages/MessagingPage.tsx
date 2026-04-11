// Messaging center — WhatsApp-like two-column layout.
// Accessible to: admin, sector_lead, call_centre_agent (and patrollers via mobile).

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminFetch, authStore } from "../lib/api";
import { Btn, Field, Modal, inputCls, selectCls } from "../components/Modal";
import type { Message, MessageChannel } from "@patrol-log/shared";

// ── Admin fetch wrappers ─────────────────────────────────

function fetchChannels() {
  return adminFetch<{ channels: MessageChannel[] }>("/admin/messages/channels");
}
function fetchMessages(channelId: string, before?: string) {
  const qs = before ? `?before=${encodeURIComponent(before)}` : "";
  return adminFetch<{ messages: Message[] }>(`/messages/${channelId}${qs}`);
}
function sendMessage(channelId: string, body: string, priority: "normal" | "urgent") {
  return adminFetch<Message>(`/messages/${channelId}`, {
    method: "POST",
    body: JSON.stringify({ body, priority }),
  });
}
function markRead(channelId: string) {
  return adminFetch(`/messages/${channelId}/read`, { method: "POST" });
}

// ── Helpers ──────────────────────────────────────────────

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}

function channelTypeLabel(type: string): string {
  if (type === "broadcast") return "📢";
  if (type === "sector") return "📍";
  return "💬";
}

// ── Channel list ─────────────────────────────────────────

function ChannelList({
  channels,
  activeId,
  onSelect,
  onNewChannel,
}: {
  channels: MessageChannel[];
  activeId: string | null;
  onSelect: (ch: MessageChannel) => void;
  onNewChannel: () => void;
}) {
  return (
    <aside className="w-72 bg-white border-r border-gray-200 flex flex-col flex-shrink-0">
      <div className="p-4 border-b border-gray-200 flex items-center justify-between">
        <h2 className="font-bold text-gray-900">Messaging</h2>
        <Btn onClick={onNewChannel}>+ Channel</Btn>
      </div>
      <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
        {channels.length === 0 && (
          <p className="p-4 text-sm text-gray-400">No channels yet.</p>
        )}
        {channels.map((ch) => (
          <button
            key={ch.id}
            className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition ${activeId === ch.id ? "bg-blue-50" : ""}`}
            onClick={() => onSelect(ch)}
          >
            <div className="flex items-center gap-2">
              <span className="text-base">{channelTypeLabel(ch.type)}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm text-gray-900 truncate">{ch.name}</span>
                  {ch.lastMessageAt && (
                    <span className="text-xs text-gray-400 ml-1 flex-shrink-0">{formatTime(ch.lastMessageAt)}</span>
                  )}
                </div>
                {ch.lastMessage && (
                  <p className="text-xs text-gray-500 truncate mt-0.5">{ch.lastMessage}</p>
                )}
              </div>
              {ch.unreadCount > 0 && (
                <span className="bg-red-500 text-white text-xs font-bold rounded-full px-1.5 py-0.5 min-w-[20px] text-center flex-shrink-0">
                  {ch.unreadCount > 99 ? "99+" : ch.unreadCount}
                </span>
              )}
            </div>
          </button>
        ))}
      </div>
    </aside>
  );
}

// ── Message bubble ───────────────────────────────────────

function MessageBubble({ msg, myCallSign }: { msg: Message; myCallSign: string }) {
  const isMe = msg.senderCallSign === myCallSign;
  const isSystem = msg.senderId === null && msg.senderCallSign === "System";

  if (isSystem) {
    return (
      <div className="flex justify-center my-2">
        <div className="bg-gray-100 text-gray-500 text-xs rounded-full px-3 py-1 italic">
          {msg.body}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex mb-3 ${isMe ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-xs lg:max-w-md ${isMe ? "order-1" : ""}`}>
        {!isMe && (
          <p className="text-xs text-gray-500 mb-1 ml-1">{msg.senderCallSign}</p>
        )}
        <div
          className={`px-3 py-2 rounded-2xl text-sm leading-relaxed ${
            isMe
              ? "bg-brand-primary text-white rounded-br-md"
              : "bg-white border border-gray-200 text-gray-900 rounded-bl-md shadow-sm"
          } ${msg.priority === "urgent" ? "ring-2 ring-red-500" : ""}`}
        >
          {msg.priority === "urgent" && (
            <span className="text-xs font-bold mr-1">🚨 URGENT</span>
          )}
          {msg.body}
          <div className={`text-xs mt-1 ${isMe ? "text-white/70" : "text-gray-400"}`}>
            {formatTime(msg.createdAt)}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Thread panel ─────────────────────────────────────────

function ThreadPanel({ channel }: { channel: MessageChannel }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [priority, setPriority] = useState<"normal" | "urgent">("normal");
  const bottomRef = useRef<HTMLDivElement>(null);
  const profile = authStore.getProfile();
  const myCallSign = profile?.call_sign ?? "";

  const { data, isLoading } = useQuery({
    queryKey: ["messages", channel.id],
    queryFn: () => fetchMessages(channel.id),
    refetchInterval: 10_000,
  });

  const messages = [...(data?.messages ?? [])].reverse(); // newest at bottom

  // Mark as read when channel opens
  useEffect(() => {
    void markRead(channel.id);
    qc.invalidateQueries({ queryKey: ["admin.messages.channels"] });
  }, [channel.id, qc]);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const send = useMutation({
    mutationFn: () => sendMessage(channel.id, text.trim(), priority),
    onSuccess: () => {
      setText("");
      setPriority("normal");
      qc.invalidateQueries({ queryKey: ["messages", channel.id] });
      qc.invalidateQueries({ queryKey: ["admin.messages.channels"] });
    },
  });

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (text.trim()) send.mutate();
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="px-6 py-3 border-b border-gray-200 bg-white flex items-center gap-2">
        <span className="text-lg">{channelTypeLabel(channel.type)}</span>
        <div>
          <h3 className="font-semibold text-gray-900">{channel.name}</h3>
          <p className="text-xs text-gray-500 capitalize">{channel.type} channel</p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 bg-gray-50">
        {isLoading ? (
          <p className="text-sm text-gray-400 text-center">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="text-sm text-gray-400 text-center mt-8">No messages yet. Say something!</p>
        ) : (
          messages.map((m) => (
            <MessageBubble key={m.id} msg={m} myCallSign={myCallSign} />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Compose */}
      <div className="px-4 py-3 border-t border-gray-200 bg-white">
        <div className="flex gap-2 items-end">
          <div className="flex-1 space-y-1">
            <textarea
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-primary"
              rows={2}
              placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={priority === "urgent"}
                  onChange={(e) => setPriority(e.target.checked ? "urgent" : "normal")}
                  className="rounded"
                />
                🚨 Mark as urgent
              </label>
            </div>
          </div>
          <Btn
            disabled={!text.trim() || send.isPending}
            onClick={() => send.mutate()}
          >
            {send.isPending ? "…" : "Send"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

// ── New channel modal ────────────────────────────────────

interface SectorOption { id: string; name: string }

function NewChannelModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [type, setType] = useState<"broadcast" | "sector" | "direct">("broadcast");
  const [name, setName] = useState("");
  const [sectorId, setSectorId] = useState("");

  const { data: sectorsData } = useQuery({
    queryKey: ["admin.sectors"],
    queryFn: () => adminFetch<{ results: SectorOption[] }>("/admin/sectors"),
  });
  const sectors = sectorsData?.results ?? [];

  const create = useMutation({
    mutationFn: () =>
      adminFetch("/admin/messages/channels", {
        method: "POST",
        body: JSON.stringify({
          type,
          name: name.trim(),
          sector_id: type === "sector" ? sectorId || null : null,
        }),
      }),
    onSuccess: () => {
      onCreated();
      onClose();
      setName("");
      setType("broadcast");
      setSectorId("");
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New channel"
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn disabled={create.isPending || !name.trim()} onClick={() => create.mutate()}>
            {create.isPending ? "Creating…" : "Create"}
          </Btn>
        </>
      }
    >
      <Field label="Type">
        <select className={selectCls} value={type} onChange={(e) => setType(e.target.value as any)}>
          <option value="broadcast">📢 Broadcast — all CPF patrollers</option>
          <option value="sector">📍 Sector — sector members + staff</option>
          <option value="direct">💬 Direct — specific members</option>
        </select>
      </Field>
      <Field label="Channel name" required>
        <input
          className={inputCls}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={type === "broadcast" ? "e.g. General" : type === "sector" ? "e.g. Alpha Sector" : "e.g. Night Shift"}
          autoFocus
        />
      </Field>
      {type === "sector" && (
        <Field label="Sector">
          <select className={selectCls} value={sectorId} onChange={(e) => setSectorId(e.target.value)}>
            <option value="">— Select sector —</option>
            {sectors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
      )}
    </Modal>
  );
}

// ── Page ─────────────────────────────────────────────────

export function MessagingPage() {
  const qc = useQueryClient();
  const [activeChannel, setActiveChannel] = useState<MessageChannel | null>(null);
  const [newChannelOpen, setNewChannelOpen] = useState(false);

  const { data } = useQuery({
    queryKey: ["admin.messages.channels"],
    queryFn: fetchChannels,
    refetchInterval: 15_000,
  });
  const channels: MessageChannel[] = data?.channels ?? [];

  // Auto-select first channel
  useEffect(() => {
    if (!activeChannel && channels.length > 0) {
      setActiveChannel(channels[0]);
    }
  }, [channels, activeChannel]);

  function handleSelectChannel(ch: MessageChannel) {
    setActiveChannel(ch);
  }

  return (
    <div className="flex h-full -m-6 overflow-hidden">
      <ChannelList
        channels={channels}
        activeId={activeChannel?.id ?? null}
        onSelect={handleSelectChannel}
        onNewChannel={() => setNewChannelOpen(true)}
      />

      {activeChannel ? (
        <ThreadPanel key={activeChannel.id} channel={activeChannel} />
      ) : (
        <div className="flex-1 flex items-center justify-center bg-gray-50">
          <div className="text-center text-gray-400">
            <div className="text-5xl mb-3">💬</div>
            <p className="text-sm">Select a channel to start messaging</p>
          </div>
        </div>
      )}

      <NewChannelModal
        open={newChannelOpen}
        onClose={() => setNewChannelOpen(false)}
        onCreated={() => qc.invalidateQueries({ queryKey: ["admin.messages.channels"] })}
      />
    </div>
  );
}
