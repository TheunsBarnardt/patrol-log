// Message thread for a single channel.
// Two-way: patrollers can reply. Polls every 10s.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation";
import { api } from "../lib/api";
import { useAuthStore } from "../store/auth";
import type { Message } from "@patrol-log/shared";
import { colors, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Channel">;

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function MessageBubble({ msg, myCallSign }: { msg: Message; myCallSign: string }) {
  const isMe = msg.senderCallSign === myCallSign;
  const isSystem = msg.senderId === null && msg.senderCallSign === "System";

  if (isSystem) {
    return (
      <View style={styles.systemRow}>
        <Text style={styles.systemText}>{msg.body}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.bubbleRow, isMe ? styles.bubbleRight : styles.bubbleLeft]}>
      {!isMe && <Text style={styles.senderLabel}>{msg.senderCallSign}</Text>}
      <View
        style={[
          styles.bubble,
          isMe ? styles.bubbleMe : styles.bubbleThem,
          msg.priority === "urgent" && styles.bubbleUrgent,
        ]}
      >
        {msg.priority === "urgent" && (
          <Text style={styles.urgentLabel}>🚨 URGENT  </Text>
        )}
        <Text style={[styles.bubbleText, isMe && styles.bubbleTextMe]}>{msg.body}</Text>
        <Text style={[styles.timeText, isMe && styles.timeTextMe]}>{formatTime(msg.createdAt)}</Text>
      </View>
    </View>
  );
}

export function ChannelScreen({ route }: Props) {
  const { channelId } = route.params;
  const profile = useAuthStore((s) => s.profile);
  const myCallSign = profile?.call_sign ?? "";

  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [urgent, setUrgent] = useState(false);
  const flatListRef = useRef<FlatList<Message>>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await api.channelMessages(channelId);
      // API returns newest first; reverse for display
      setMessages([...res.messages].reverse());
    } catch (err) {
      console.warn("[channel] fetch failed", err);
    } finally {
      setLoading(false);
    }
  }, [channelId]);

  useEffect(() => {
    void refresh();
    void api.markChannelRead(channelId).catch(() => {});
    timer.current = setInterval(() => void refresh(), 10_000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [channelId, refresh]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length]);

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const msg = await api.sendMessage(channelId, { body, priority: urgent ? "urgent" : "normal" });
      setMessages((prev) => [...prev, msg]);
      setText("");
      setUrgent(false);
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
        {/* Messages */}
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.messageList}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyText}>No messages yet. Say something!</Text>
            </View>
          }
          renderItem={({ item }) => <MessageBubble msg={item} myCallSign={myCallSign} />}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
        />

        {/* Compose bar */}
        <View style={styles.compose}>
          <TouchableOpacity
            onPress={() => setUrgent((u) => !u)}
            style={[styles.urgentToggle, urgent && styles.urgentToggleActive]}
          >
            <Text>🚨</Text>
          </TouchableOpacity>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder="Type a message…"
            multiline
            maxLength={1000}
            returnKeyType="default"
          />
          <TouchableOpacity
            onPress={send}
            disabled={!text.trim() || sending}
            style={[styles.sendBtn, (!text.trim() || sending) && styles.sendBtnDisabled]}
          >
            {sending ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.sendText}>Send</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F3F4F6" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyText: { color: colors.textMuted, fontSize: 14 },

  messageList: { padding: spacing.md, gap: spacing.sm, flexGrow: 1 },

  systemRow: { alignItems: "center", marginVertical: spacing.xs },
  systemText: { fontSize: 12, color: colors.textMuted, fontStyle: "italic", textAlign: "center" },

  bubbleRow: { marginBottom: spacing.sm },
  bubbleLeft: { alignItems: "flex-start" },
  bubbleRight: { alignItems: "flex-end" },
  senderLabel: { fontSize: 11, color: colors.textMuted, marginBottom: 2, marginLeft: 4 },

  bubble: {
    maxWidth: "80%",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
  },
  bubbleMe: {
    backgroundColor: colors.primary,
    borderBottomRightRadius: 4,
  },
  bubbleThem: {
    backgroundColor: colors.bg,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  bubbleUrgent: { borderWidth: 2, borderColor: colors.danger },
  urgentLabel: { color: colors.danger, fontSize: 11, fontWeight: "700" },
  bubbleText: { fontSize: 15, color: colors.text, lineHeight: 20 },
  bubbleTextMe: { color: "#fff" },
  timeText: { fontSize: 10, color: colors.textMuted, marginTop: 3, textAlign: "right" },
  timeTextMe: { color: "rgba(255,255,255,0.7)" },

  compose: {
    flexDirection: "row",
    alignItems: "flex-end",
    padding: spacing.sm,
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  urgentToggle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  urgentToggleActive: {
    backgroundColor: "#FEF2F2",
    borderColor: colors.danger,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    maxHeight: 100,
    fontSize: 15,
    backgroundColor: colors.bg,
  },
  sendBtn: {
    backgroundColor: colors.primary,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginBottom: 2,
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendText: { color: "#fff", fontWeight: "700", fontSize: 14 },
});
