// WhatsApp-style message thread — aligned with admin messaging UI.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FontAwesome5 } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation";
import { api } from "../lib/api";
import { showLocalNotification } from "../lib/notifications";
import { useAuthStore } from "../store/auth";
import { useMessagingStore } from "../store/messaging";
import { parseSqliteUtc, type Message, type MessageChannelMember } from "@patrol-log/shared";
import { colors, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Channel">;

const POLL_MS = 2_500;
const COMPOSE_H = 44;

function formatTime(iso: string): string {
  const d = parseSqliteUtc(iso) ?? new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function MessageBubble({
  msg,
  myId,
  showSender,
}: {
  msg: Message;
  myId: string;
  showSender: boolean;
}) {
  const isMe = !!msg.senderId && msg.senderId === myId;
  const isSystem = msg.senderId === null;

  if (isSystem) {
    return (
      <View style={styles.systemRow}>
        <View style={styles.systemPill}>
          <Text style={styles.systemText}>{msg.body}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.bubbleRow, { justifyContent: isMe ? "flex-end" : "flex-start" }]}>
      <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem, msg.priority === "urgent" && styles.bubbleUrgent]}>
        {showSender && !isMe && <Text style={styles.sender}>{msg.senderCallSign}</Text>}
        {msg.priority === "urgent" && <Text style={styles.urgent}>URGENT</Text>}
        <Text style={styles.body}>{msg.body}</Text>
        <View style={styles.metaRow}>
          <Text style={styles.time}>{formatTime(msg.createdAt)}</Text>
          {isMe && <FontAwesome5 name="check-double" size={11} color="#53bdeb" style={{ marginLeft: 4 }} />}
        </View>
      </View>
    </View>
  );
}

async function refreshUnreadBadge() {
  try {
    const channels = await api.messageChannels();
    useMessagingStore
      .getState()
      .setUnreadCount(channels.channels.reduce((sum, ch) => sum + ch.unreadCount, 0));
  } catch {
    /* best-effort */
  }
}

export function ChannelScreen({ navigation, route }: Props) {
  const { channelId, kind: kindParam, memberCount: countParam } = route.params;
  const channelName = route.params.channelName || "Chat";
  const profile = useAuthStore((s) => s.profile);
  const myId = profile?.patroller_id ?? "";

  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [urgent, setUrgent] = useState(false);
  const [inputHeight, setInputHeight] = useState(COMPOSE_H);
  const [kind, setKind] = useState<"chat" | "group">(kindParam ?? "chat");
  const [memberCount, setMemberCount] = useState(countParam ?? 0);
  const [infoOpen, setInfoOpen] = useState(false);
  const [members, setMembers] = useState<MessageChannelMember[]>([]);
  const flatListRef = useRef<FlatList<Message>>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const primedRef = useRef(false);

  useEffect(() => {
    void api
      .channelMembers(channelId)
      .then((res) => {
        setMembers(res.members);
        setKind(res.kind);
        setMemberCount(res.members.length);
      })
      .catch(() => {});
  }, [channelId]);

  useLayoutEffect(() => {
    const subtitle =
      kind === "group"
        ? `${memberCount || members.length || ""} participant${(memberCount || members.length) === 1 ? "" : "s"}`.trim()
        : "tap for info";
    navigation.setOptions({
      headerTitle: () => (
        <Pressable onPress={() => setInfoOpen(true)} style={{ alignItems: "center", maxWidth: 220 }}>
          <Text style={{ color: "#fff", fontSize: 17, fontWeight: "700" }} numberOfLines={1}>
            {channelName}
          </Text>
          <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: 12 }} numberOfLines={1}>
            {kind === "group" ? subtitle || "Group" : "Private · only you two"}
          </Text>
        </Pressable>
      ),
    });
  }, [navigation, channelName, kind, memberCount, members.length]);

  const refresh = useCallback(async () => {
    try {
      const res = await api.channelMessages(channelId);
      const next = [...res.messages].reverse();

      if (!primedRef.current) {
        seenIdsRef.current = new Set(next.map((m) => m.id));
        primedRef.current = true;
      } else {
        const incoming = next.filter(
          (m) => !seenIdsRef.current.has(m.id) && m.senderId !== myId,
        );
        for (const m of next) seenIdsRef.current.add(m.id);
        if (incoming.length > 0) {
          const latest = incoming[incoming.length - 1];
          void showLocalNotification(
            `${latest.senderCallSign} · ${channelName}`,
            latest.body,
          );
          void api.markChannelRead(channelId).then(() => refreshUnreadBadge());
        }
      }

      setMessages(next);
    } catch (err) {
      console.warn("[channel] fetch failed", err);
    } finally {
      setLoading(false);
    }
  }, [channelId, channelName, myId]);

  useEffect(() => {
    primedRef.current = false;
    seenIdsRef.current = new Set();
    void refresh();
    void api.markChannelRead(channelId).then(() => refreshUnreadBadge());
    timer.current = setInterval(() => void refresh(), POLL_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [channelId, refresh]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 80);
    }
  }, [messages.length]);

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const msg = await api.sendMessage(channelId, { body, priority: urgent ? "urgent" : "normal" });
      seenIdsRef.current.add(msg.id);
      setMessages((prev) => [...prev, msg]);
      setText("");
      setUrgent(false);
      setInputHeight(COMPOSE_H);
      void refreshUnreadBadge();
    } catch (err) {
      console.warn("[channel] send failed", err);
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.center} edges={["bottom"]}>
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={90}
      >
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyText}>
                Messages stay in your CPF channel. Say hello to get started.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <MessageBubble msg={item} myId={myId} showSender={kind === "group"} />
          )}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
        />

        <Modal visible={infoOpen} transparent animationType="slide" onRequestClose={() => setInfoOpen(false)}>
          <Pressable style={styles.infoBackdrop} onPress={() => setInfoOpen(false)}>
            <Pressable style={styles.infoSheet} onPress={(e) => e.stopPropagation()}>
              <View style={styles.infoHeader}>
                <Text style={styles.infoTitle}>{channelName}</Text>
                <Text style={styles.infoSub}>
                  {kind === "group" ? `Group · ${members.length} participants` : "Private · only you two"}
                </Text>
              </View>
              <FlatList
                data={members}
                keyExtractor={(m) => m.patrollerId}
                style={{ maxHeight: 360 }}
                ListEmptyComponent={
                  <Text style={styles.infoEmpty}>Loading participants…</Text>
                }
                renderItem={({ item }) => (
                  <View style={styles.infoRow}>
                    <View style={styles.infoAvatar}>
                      <Text style={styles.infoAvatarText}>{item.callSign.slice(0, 2)}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.infoName}>{item.name}</Text>
                      <Text style={styles.infoCall}>{item.callSign}</Text>
                    </View>
                    {item.patrollerId === myId && (
                      <Text style={styles.youTag}>You</Text>
                    )}
                  </View>
                )}
              />
              <Pressable style={styles.infoClose} onPress={() => setInfoOpen(false)}>
                <Text style={styles.infoCloseText}>Close</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>

        <View style={styles.compose}>
          <Pressable
            onPress={() => setUrgent((u) => !u)}
            style={[styles.sideBtn, urgent && styles.urgentBtnOn]}
          >
            <View style={styles.sideBtnIcon}>
              <FontAwesome5 name="exclamation" size={14} color={urgent ? "#fff" : colors.textMuted} solid />
            </View>
          </Pressable>
          <TextInput
            style={[styles.input, Platform.OS === "web" ? styles.inputWeb : { height: inputHeight }]}
            value={text}
            onChangeText={(v) => {
              setText(v);
              if (!v.trim()) setInputHeight(COMPOSE_H);
            }}
            placeholder="Type a message"
            placeholderTextColor={colors.textMuted}
            // RN-web multiline (textarea) cannot vertically center glyphs reliably.
            multiline={Platform.OS !== "web"}
            maxLength={1000}
            textAlignVertical="center"
            underlineColorAndroid="transparent"
            onContentSizeChange={
              Platform.OS === "web"
                ? undefined
                : (e) => {
                    if (!text.trim()) {
                      setInputHeight(COMPOSE_H);
                      return;
                    }
                    const next = Math.ceil(e.nativeEvent.contentSize.height) + 24;
                    setInputHeight(Math.min(110, Math.max(COMPOSE_H, next)));
                  }
            }
            onSubmitEditing={Platform.OS === "web" ? () => void send() : undefined}
            blurOnSubmit={false}
            returnKeyType="send"
          />
          <Pressable
            onPress={send}
            disabled={!text.trim() || sending}
            style={[styles.sideBtn, styles.sendBtn, (!text.trim() || sending) && styles.sendBtnDisabled]}
          >
            <View style={styles.sideBtnIcon}>
              {sending ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <FontAwesome5 name="paper-plane" size={14} color="#fff" solid />
              )}
            </View>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.primarySoft },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft },
  list: { padding: spacing.md, flexGrow: 1 },
  emptyWrap: {
    alignSelf: "center",
    marginTop: 40,
    backgroundColor: "#ffeecd",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: 320,
  },
  emptyText: { color: colors.textMuted, fontSize: 13, textAlign: "center", lineHeight: 18 },

  systemRow: { alignItems: "center", marginVertical: 8 },
  systemPill: {
    backgroundColor: "#ffeecd",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    maxWidth: "90%",
  },
  systemText: { fontSize: 12.5, color: colors.textMuted, textAlign: "center" },

  bubbleRow: { width: "100%", marginBottom: 4, flexDirection: "row" },
  bubble: {
    maxWidth: "82%",
    paddingHorizontal: 10,
    paddingTop: 6,
    paddingBottom: 6,
    borderRadius: 8,
  },
  bubbleMe: { backgroundColor: colors.successSoft, borderTopRightRadius: 2 },
  bubbleThem: { backgroundColor: "#fff", borderTopLeftRadius: 2 },
  bubbleUrgent: { borderWidth: 1.5, borderColor: "#e11900" },
  sender: { fontSize: 12.5, fontWeight: "700", color: colors.primary, marginBottom: 2 },
  urgent: { fontSize: 11, fontWeight: "800", color: "#e11900", marginBottom: 2 },
  body: { fontSize: 15, color: colors.text, lineHeight: 20 },
  metaRow: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", marginTop: 3 },
  time: { fontSize: 11, color: colors.textMuted },

  compose: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 8,
    backgroundColor: colors.surfaceMuted,
    borderTopWidth: 1.5,
    borderTopColor: colors.border,
    gap: 8,
  },
  sideBtn: {
    width: COMPOSE_H,
    height: COMPOSE_H,
    minWidth: COMPOSE_H,
    minHeight: COMPOSE_H,
    maxHeight: COMPOSE_H,
    borderRadius: COMPOSE_H / 2,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    flexShrink: 0,
    overflow: "hidden",
  },
  sideBtnIcon: {
    width: COMPOSE_H,
    height: COMPOSE_H,
    alignItems: "center",
    justifyContent: "center",
  },
  urgentBtnOn: { backgroundColor: "#e11900" },
  input: {
    flex: 1,
    alignSelf: "center",
    maxHeight: 110,
    backgroundColor: "#fff",
    borderRadius: COMPOSE_H / 2,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    margin: 0,
    borderWidth: 0,
    fontSize: 15,
    lineHeight: 20,
    color: colors.text,
    includeFontPadding: false,
    textAlignVertical: "center",
  },
  inputWeb: {
    height: COMPOSE_H,
    // Single-line <input> on RN-web centers cleanly with zero vertical padding.
    paddingTop: 0,
    paddingBottom: 0,
    lineHeight: COMPOSE_H,
    outlineStyle: "none",
    outlineWidth: 0,
    boxSizing: "border-box",
  } as object,
  sendBtn: { backgroundColor: colors.primary },
  sendBtnDisabled: { opacity: 0.4 },

  infoBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "flex-end",
  },
  infoSheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 20,
    maxHeight: "75%",
  },
  infoHeader: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e9edef",
  },
  infoTitle: { fontSize: 18, fontWeight: "700", color: colors.text },
  infoSub: { marginTop: 4, fontSize: 13, color: colors.textMuted },
  infoEmpty: { textAlign: "center", color: colors.textMuted, padding: 24 },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  infoAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#dfe5e7",
    alignItems: "center",
    justifyContent: "center",
  },
  infoAvatarText: { fontSize: 13, fontWeight: "700", color: colors.textMuted },
  infoName: { fontSize: 15, fontWeight: "600", color: colors.text },
  infoCall: { fontSize: 12.5, color: colors.textMuted, marginTop: 1 },
  youTag: { fontSize: 12, fontWeight: "600", color: colors.primary },
  infoClose: {
    marginTop: 8,
    marginHorizontal: 20,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  infoCloseText: { fontWeight: "700", color: colors.text },
});
