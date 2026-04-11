// Channel inbox — lists all channels the patroller can see.
// Polls every 15s for new messages / unread counts.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation";
import { api } from "../lib/api";
import type { MessageChannel } from "@patrol-log/shared";
import { colors, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Messaging">;

function channelIcon(type: string): string {
  if (type === "broadcast") return "📢";
  if (type === "sector") return "📍";
  return "💬";
}

function formatTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}

export function MessagingScreen({ navigation }: Props) {
  const [channels, setChannels] = useState<MessageChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await api.messageChannels();
      setChannels(res.channels);
    } catch (err) {
      console.warn("[messaging] failed to fetch channels", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    timer.current = setInterval(() => void refresh(), 15_000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [refresh]);

  // Refresh on focus
  useEffect(() => {
    const unsub = navigation.addListener("focus", () => void refresh());
    return unsub;
  }, [navigation, refresh]);

  if (loading) {
    return (
      <SafeAreaView style={styles.center} edges={["bottom"]}>
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      {channels.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>💬</Text>
          <Text style={styles.emptyText}>No channels available yet.</Text>
        </View>
      ) : (
        <FlatList
          data={channels}
          keyExtractor={(ch) => ch.id}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          renderItem={({ item: ch }) => (
            <TouchableOpacity
              style={styles.channelRow}
              activeOpacity={0.75}
              onPress={() => navigation.navigate("Channel", { channelId: ch.id, channelName: ch.name })}
            >
              <Text style={styles.channelIcon}>{channelIcon(ch.type)}</Text>
              <View style={styles.channelBody}>
                <View style={styles.channelHeader}>
                  <Text style={styles.channelName} numberOfLines={1}>{ch.name}</Text>
                  {ch.lastMessageAt && (
                    <Text style={styles.timeLabel}>{formatTime(ch.lastMessageAt)}</Text>
                  )}
                </View>
                {ch.lastMessage && (
                  <Text style={styles.preview} numberOfLines={1}>{ch.lastMessage}</Text>
                )}
              </View>
              {ch.unreadCount > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{ch.unreadCount > 99 ? "99+" : ch.unreadCount}</Text>
                </View>
              )}
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyIcon: { fontSize: 48, marginBottom: spacing.sm },
  emptyText: { color: colors.textMuted, fontSize: 14 },

  separator: { height: 1, backgroundColor: colors.border, marginLeft: 64 },

  channelRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    gap: spacing.sm,
  },
  channelIcon: { fontSize: 28, width: 36, textAlign: "center" },
  channelBody: { flex: 1 },
  channelHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  channelName: { fontSize: 15, fontWeight: "700", color: colors.text, flex: 1, marginRight: spacing.sm },
  timeLabel: { fontSize: 12, color: colors.textMuted },
  preview: { fontSize: 13, color: colors.textMuted, marginTop: 2 },

  badge: {
    backgroundColor: colors.danger,
    borderRadius: 12,
    minWidth: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
  },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "700" },
});
