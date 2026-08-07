// WhatsApp-style chats inbox: 1:1 chats + groups.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
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
import { useMessagingStore } from "../store/messaging";
import { parseSqliteUtc, type MessageChannel } from "@patrol-log/shared";
import { colors, radii, spacing } from "../theme";

const POLL_MS = 5_000;

type Props = NativeStackScreenProps<RootStackParamList, "Messaging">;
type Filter = "all" | "chats" | "groups";

function formatTime(iso: string | null): string {
  if (!iso) return "";
  const d = parseSqliteUtc(iso) ?? new Date(iso);
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

export function MessagingScreen({ navigation }: Props) {
  const [channels, setChannels] = useState<MessageChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [menuOpen, setMenuOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevUnreadRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await api.messageChannels();
      setChannels(res.channels);
      const unread = res.channels.reduce((sum, ch) => sum + ch.unreadCount, 0);
      useMessagingStore.getState().setUnreadCount(unread);
      if (
        navigation.isFocused() &&
        prevUnreadRef.current !== null &&
        unread > prevUnreadRef.current
      ) {
        const hottest = [...res.channels].sort((a, b) => b.unreadCount - a.unreadCount)[0];
        if (hottest?.lastMessage) {
          void showLocalNotification(hottest.name, hottest.lastMessage);
        }
      }
      prevUnreadRef.current = unread;
    } catch (err) {
      console.warn("[messaging] failed to fetch channels", err);
    } finally {
      setLoading(false);
    }
  }, [navigation]);

  useEffect(() => {
    void refresh();
    timer.current = setInterval(() => void refresh(), POLL_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [refresh]);

  useEffect(() => {
    const unsub = navigation.addListener("focus", () => void refresh());
    return unsub;
  }, [navigation, refresh]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={() => setMenuOpen(true)}
          hitSlop={12}
          style={{ paddingHorizontal: 10, paddingVertical: 6 }}
        >
          <FontAwesome5 name="plus" size={16} color="#fff" />
        </Pressable>
      ),
    });
  }, [navigation]);

  const filtered = useMemo(() => {
    return channels.filter((ch) => {
      if (filter === "chats" && ch.kind !== "chat") return false;
      if (filter === "groups" && ch.kind !== "group") return false;
      const term = q.trim().toLowerCase();
      if (!term) return true;
      return ch.name.toLowerCase().includes(term) || (ch.lastMessage?.toLowerCase().includes(term) ?? false);
    });
  }, [channels, filter, q]);

  if (loading) {
    return (
      <SafeAreaView style={styles.center} edges={["bottom"]}>
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <View style={styles.searchWrap}>
        <FontAwesome5 name="search" size={14} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={q}
          onChangeText={setQ}
          placeholder="Search or start a new chat"
          placeholderTextColor={colors.textMuted}
        />
      </View>

      <View style={styles.filters}>
        {([
          ["all", "All"],
          ["chats", "Chats"],
          ["groups", "Groups"],
        ] as const).map(([id, label]) => (
          <Pressable
            key={id}
            onPress={() => setFilter(id)}
            style={[styles.chip, filter === id && styles.chipOn]}
          >
            <Text style={[styles.chipText, filter === id && styles.chipTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {filtered.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>
            {filter === "groups" ? "No groups yet" : filter === "chats" ? "No chats yet" : "No conversations"}
          </Text>
          <Text style={styles.emptyText}>
            Tap + to message a member or create a group.
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(ch) => ch.id}
          renderItem={({ item: ch }) => {
            const isGroup = ch.kind === "group";
            return (
              <Pressable
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                onPress={() =>
                  navigation.navigate("Channel", {
                    channelId: ch.id,
                    channelName: ch.name,
                    kind: ch.kind,
                    memberCount: ch.memberCount,
                  })
                }
              >
                <View style={[styles.avatar, isGroup && styles.avatarGroup]}>
                  {isGroup ? (
                    <FontAwesome5 name="users" size={18} color={colors.textMuted} solid />
                  ) : (
                    <Text style={styles.avatarText}>{initials(ch.name) || "CH"}</Text>
                  )}
                </View>
                <View style={styles.body}>
                  <View style={styles.topLine}>
                    <Text style={styles.name} numberOfLines={1}>{ch.name}</Text>
                    <Text style={[styles.time, ch.unreadCount > 0 && styles.timeUnread]}>
                      {formatTime(ch.lastMessageAt)}
                    </Text>
                  </View>
                  <View style={styles.bottomLine}>
                    <Text style={styles.preview} numberOfLines={1}>
                      {ch.lastMessage || (isGroup ? "Group" : "Chat")}
                    </Text>
                    {ch.unreadCount > 0 && (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>{ch.unreadCount > 99 ? "99+" : ch.unreadCount}</Text>
                      </View>
                    )}
                  </View>
                </View>
              </Pressable>
            );
          }}
        />
      )}

      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setMenuOpen(false)}>
          <View style={styles.menuCard}>
            <Pressable
              style={styles.menuItem}
              onPress={() => {
                setMenuOpen(false);
                navigation.navigate("Members");
              }}
            >
              <FontAwesome5 name="comment" size={16} color={colors.primary} solid />
              <Text style={styles.menuText}>New chat</Text>
            </Pressable>
            <Pressable
              style={styles.menuItem}
              onPress={() => {
                setMenuOpen(false);
                navigation.navigate("NewGroup");
              }}
            >
              <FontAwesome5 name="users" size={16} color={colors.primary} solid />
              <Text style={styles.menuText}>New group</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg },
  emptyTitle: { fontSize: 18, fontWeight: "600", color: "#41525d" },
  emptyText: { marginTop: 6, fontSize: 14, color: colors.textMuted, textAlign: "center" },

  searchWrap: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.xl,
    paddingHorizontal: 14,
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 0,
    fontSize: 15,
    lineHeight: 20,
    color: colors.text,
    ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null),
  },
  filters: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: colors.surfaceMuted,
  },
  chipOn: { backgroundColor: "#dff3ea" },
  chipText: { fontSize: 13, fontWeight: "600", color: colors.textMuted },
  chipTextOn: { color: colors.primary },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  pressed: { backgroundColor: "#f5f6f6" },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#dfe5e7",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarGroup: { backgroundColor: "#cfe9de" },
  avatarText: { fontSize: 16, fontWeight: "700", color: colors.textMuted },
  body: {
    flex: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e9edef",
    paddingBottom: 12,
  },
  topLine: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8 },
  name: { flex: 1, fontSize: 16, fontWeight: "600", color: colors.text },
  time: { fontSize: 12, color: colors.textMuted },
  timeUnread: { color: colors.success, fontWeight: "600" },
  bottomLine: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 3 },
  preview: { flex: 1, fontSize: 14, color: colors.textMuted },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    backgroundColor: colors.success,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "700" },

  menuBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.25)",
    justifyContent: "flex-start",
    alignItems: "flex-end",
    paddingTop: 56,
    paddingRight: 12,
  },
  menuCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    minWidth: 200,
    paddingVertical: 6,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 4,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  menuText: { fontSize: 15, fontWeight: "600", color: colors.text },
});
