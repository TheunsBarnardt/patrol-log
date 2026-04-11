import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation";
import { useAuthStore } from "../store/auth";
import { useMessagingStore } from "../store/messaging";
import { api } from "../lib/api";
import { registerPushToken } from "../lib/notifications";
import type { ActivePatrolResponse } from "@patrol-log/shared";
import { colors, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Home">;

export function HomeScreen({ navigation }: Props) {
  const profile = useAuthStore((s) => s.profile);
  const setUnreadCount = useMessagingStore((s) => s.setUnreadCount);
  const unreadCount = useMessagingStore((s) => s.unreadCount);
  const [activePatrol, setActivePatrol] = useState<ActivePatrolResponse | null>(null);
  const pushRegistered = useRef(false);

  async function refreshUnread() {
    try {
      const res = await api.messageChannels();
      const total = res.channels.reduce((sum, ch) => sum + ch.unreadCount, 0);
      setUnreadCount(total);
    } catch {
      // Messaging not yet set up — ignore
    }
  }

  // Register push token once after login
  useEffect(() => {
    if (!pushRegistered.current) {
      pushRegistered.current = true;
      void registerPushToken();
    }
  }, []);

  // Refresh patrol status and unread count on focus
  useEffect(() => {
    const unsub = navigation.addListener("focus", () => {
      void api.activePatrol().then(setActivePatrol).catch(() => setActivePatrol(null));
      void refreshUnread();
    });
    return unsub;
  }, [navigation]);

  if (!profile) return null;

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Greeting */}
        <View style={styles.greeting}>
          <Text style={styles.greetName}>Hi, {profile.name.split(" ")[0]} 👋</Text>
          <Text style={styles.greetSub}>{profile.sector} · {profile.call_sign}</Text>
        </View>

        {/* Patrol action */}
        <View style={styles.group}>
          {!activePatrol ? (
            <ActionButton
              title="Commence Patrol"
              subtitle="Start a new patrol session"
              color={colors.warning}
              icon="🚔"
              onPress={() => navigation.navigate("CommencePatrol")}
            />
          ) : (
            <ActionButton
              title="Active Patrol"
              subtitle="View / stand down"
              color={colors.danger}
              icon="🔴"
              onPress={() => navigation.navigate("ActivePatrol", { patrolId: activePatrol.patrol_id })}
            />
          )}
        </View>

        {/* Maps */}
        <View style={styles.group}>
          <Text style={styles.groupLabel}>Maps</Text>
          <View style={styles.row}>
            <HalfButton title="Live Map" icon="📍" color={colors.primary} onPress={() => navigation.navigate("LivePatrollerMap")} />
            <HalfButton title="Hotspots" icon="🔥" color="#F97316" onPress={() => navigation.navigate("HotspotsMap")} />
          </View>
        </View>

        {/* Messaging shortcut */}
        <View style={styles.group}>
          <ActionButton
            title="Messages"
            subtitle={unreadCount > 0 ? `${unreadCount} unread message${unreadCount !== 1 ? "s" : ""}` : "Broadcast & sector channels"}
            color={colors.info}
            icon="💬"
            onPress={() => navigation.navigate("Messaging")}
          />
        </View>

        {/* Directories */}
        <View style={styles.group}>
          <Text style={styles.groupLabel}>Directory</Text>
          <DirButton title="Residents" icon="🏠" onPress={() => navigation.navigate("Residents")} />
          <DirButton title="Members" icon="👮" onPress={() => navigation.navigate("Members")} />
          <DirButton title="Emergency Contacts" icon="🚨" onPress={() => navigation.navigate("EmergencyContacts")} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function ActionButton({ title, subtitle, color, icon, onPress }: { title: string; subtitle: string; color: string; icon: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.actionBtn, { backgroundColor: color }]} onPress={onPress} activeOpacity={0.85}>
      <Text style={styles.actionIcon}>{icon}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.actionTitle}>{title}</Text>
        <Text style={styles.actionSub}>{subtitle}</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );
}

function HalfButton({ title, icon, color, onPress }: { title: string; icon: string; color: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.halfBtn, { backgroundColor: color }]} onPress={onPress} activeOpacity={0.85}>
      <Text style={styles.halfIcon}>{icon}</Text>
      <Text style={styles.halfTitle}>{title}</Text>
    </TouchableOpacity>
  );
}

function DirButton({ title, icon, onPress }: { title: string; icon: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.dirBtn} onPress={onPress} activeOpacity={0.8}>
      <Text style={styles.dirIcon}>{icon}</Text>
      <Text style={styles.dirTitle}>{title}</Text>
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, gap: spacing.md },
  greeting: { marginTop: spacing.sm },
  greetName: { fontSize: 22, fontWeight: "800" },
  greetSub: { fontSize: 14, color: colors.textMuted, marginTop: 2 },

  group: { gap: spacing.sm },
  groupLabel: { fontSize: 12, fontWeight: "700", color: colors.textMuted, textTransform: "uppercase", letterSpacing: 1 },

  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    borderRadius: 12,
    gap: spacing.sm,
  },
  actionIcon: { fontSize: 28 },
  actionTitle: { fontSize: 17, fontWeight: "800", color: "#fff" },
  actionSub: { fontSize: 12, color: "rgba(255,255,255,0.8)", marginTop: 2 },

  row: { flexDirection: "row", gap: spacing.sm },
  halfBtn: {
    flex: 1,
    padding: spacing.md,
    borderRadius: 12,
    alignItems: "center",
    gap: spacing.xs,
  },
  halfIcon: { fontSize: 28 },
  halfTitle: { fontSize: 14, fontWeight: "700", color: "#fff" },

  dirBtn: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    backgroundColor: colors.cardBg,
    borderRadius: 10,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dirIcon: { fontSize: 20 },
  dirTitle: { flex: 1, fontSize: 15, fontWeight: "600" },
  chevron: { fontSize: 20, color: colors.textMuted, fontWeight: "300" },
});
