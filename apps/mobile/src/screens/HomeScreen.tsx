import { useCallback, useEffect, useRef, useState, type ComponentProps } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FontAwesome5 } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation";
import { useAuthStore } from "../store/auth";
import { useMessagingStore } from "../store/messaging";
import { api } from "../lib/api";
import { registerPushToken } from "../lib/notifications";
import { storage } from "../lib/storage";
import type { ActivePatrolResponse, PatrollerStats, StatsPeriod } from "@patrol-log/shared";
import { colors, radii, spacing } from "../theme";

async function readCachedActivePatrol(): Promise<ActivePatrolResponse | null> {
  try {
    const raw = await storage.getActivePatrolCache();
    if (!raw) return null;
    return JSON.parse(raw) as ActivePatrolResponse;
  } catch {
    return null;
  }
}

type Props = NativeStackScreenProps<RootStackParamList, "Home">;
type IconName = ComponentProps<typeof FontAwesome5>["name"];

const STAT_PERIODS: { id: StatsPeriod; label: string }[] = [
  { id: "month", label: "Month" },
  { id: "7d", label: "7d" },
  { id: "30d", label: "30d" },
  { id: "today", label: "Today" },
  { id: "all", label: "All" },
];

export function HomeScreen({ navigation }: Props) {
  const profile = useAuthStore((s) => s.profile);
  const setUnreadCount = useMessagingStore((s) => s.setUnreadCount);
  const unreadCount = useMessagingStore((s) => s.unreadCount);
  const [activePatrol, setActivePatrol] = useState<ActivePatrolResponse | null>(null);
  const [statsPeriod, setStatsPeriod] = useState<StatsPeriod>("month");
  const [stats, setStats] = useState<PatrollerStats | null>(null);
  const pushRegistered = useRef(false);

  async function refreshUnread() {
    try {
      const res = await api.messageChannels();
      setUnreadCount(res.channels.reduce((sum, ch) => sum + ch.unreadCount, 0));
    } catch {}
  }

  const refreshStats = useCallback(async (period: StatsPeriod) => {
    try {
      setStats(await api.myPatrolStats(period));
    } catch {
      setStats(null);
    }
  }, []);

  useEffect(() => {
    if (!pushRegistered.current) {
      pushRegistered.current = true;
      void registerPushToken();
    }
  }, []);

  useEffect(() => {
    void readCachedActivePatrol().then((cached) => {
      if (cached) setActivePatrol((prev) => prev ?? cached);
    });
  }, []);

  useEffect(() => {
    const unsub = navigation.addListener("focus", () => {
      void api
        .activePatrol()
        .then(async (p) => {
          setActivePatrol(p);
          if (p) {
            try {
              await storage.setActivePatrolCache(JSON.stringify(p));
            } catch {}
          } else {
            await storage.clearActivePatrolCache();
          }
        })
        .catch(() => {
          // Keep last known active patrol after overnight/network blips — never treat errors as "not on patrol".
        });
      void refreshUnread();
      void refreshStats(statsPeriod);
    });
    return unsub;
  }, [navigation, refreshStats, statsPeriod]);

  useEffect(() => {
    void refreshStats(statsPeriod);
  }, [statsPeriod, refreshStats]);

  if (!profile) return null;
  const firstName = profile.name.split(" ")[0];

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <Text style={styles.hello}>Hi {firstName}</Text>
          <Text style={styles.meta}>
            {profile.call_sign}
            <Text style={styles.metaSep}>  ·  </Text>
            {profile.sector}
          </Text>
        </View>

        <View style={styles.statsCard}>
          <View style={styles.statsHeader}>
            <Text style={styles.statsTitle}>My patrols</Text>
            <View style={styles.periodRow}>
              {STAT_PERIODS.map((p) => (
                <Pressable
                  key={p.id}
                  onPress={() => setStatsPeriod(p.id)}
                  style={[styles.periodChip, statsPeriod === p.id && styles.periodChipOn]}
                >
                  <Text style={[styles.periodText, statsPeriod === p.id && styles.periodTextOn]}>{p.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
          <View style={styles.statsGrid}>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{stats?.totalKm ?? "—"}</Text>
              <Text style={styles.statLabel}>km</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{stats?.totalHours ?? "—"}</Text>
              <Text style={styles.statLabel}>hours</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{stats?.completedPatrols ?? "—"}</Text>
              <Text style={styles.statLabel}>patrols</Text>
            </View>
          </View>
        </View>

        <View style={[styles.suggestCard, activePatrol && styles.patrolCardLive]}>
          <SuggestRow
            icon={activePatrol ? "broadcast-tower" : "flag"}
            title={activePatrol ? "Active patrol" : "Commence patrol"}
            subtitle={
              activePatrol
                ? activePatrol.my_role === "joined"
                  ? "Passenger — tap to stand down"
                  : "Tap to view or stand down"
                : "Where are you patrolling?"
            }
            live={!!activePatrol}
            onPress={() =>
              activePatrol
                ? navigation.navigate("ActivePatrol", { patrolId: activePatrol.patrol_id })
                : navigation.navigate("CommencePatrol")
            }
          />
          {!activePatrol && (
            <>
              <View style={styles.divider} />
              <SuggestRow
                icon="user-plus"
                title="Join patrol"
                subtitle="Select an active patrol as passenger"
                onPress={() => navigation.navigate("JoinPatrol")}
              />
              <View style={styles.divider} />
              <SuggestRow
                icon="clipboard-list"
                title="Capture patrol"
                subtitle="Log a patrol you already completed"
                onPress={() => navigation.navigate("CapturePatrol")}
              />
            </>
          )}
        </View>

        <Text style={styles.section}>Suggestions</Text>
        <View style={styles.suggestCard}>
          <SuggestRow
            icon="map-marker-alt"
            title="Live map"
            subtitle="See who’s out now"
            onPress={() => navigation.navigate("LivePatrollerMap")}
          />
          <View style={styles.divider} />
          <SuggestRow
            icon="fire"
            title="Hotspots"
            subtitle="Recent incidents nearby"
            onPress={() => navigation.navigate("HotspotsMap")}
          />
          <View style={styles.divider} />
          <SuggestRow
            icon="comment"
            title="Messages"
            subtitle={unreadCount > 0 ? `${unreadCount} unread` : "Sector & broadcast"}
            badge={unreadCount > 0 ? unreadCount : undefined}
            onPress={() => navigation.navigate("Messaging")}
          />
        </View>

        <Text style={styles.section}>Directory</Text>
        <View style={styles.quickRow}>
          <Quick
            icon="home"
            label="Residents"
            onPress={() => navigation.navigate("Residents")}
          />
          <Quick
            icon="user-friends"
            label="Members"
            onPress={() => navigation.navigate("Members")}
          />
          <Quick
            icon="phone-alt"
            label="Emergency"
            onPress={() => navigation.navigate("EmergencyContacts")}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function SuggestRow({
  icon,
  title,
  subtitle,
  onPress,
  badge,
  live,
}: {
  icon: IconName;
  title: string;
  subtitle: string;
  onPress: () => void;
  badge?: number;
  live?: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.suggestRow,
        live && styles.suggestRowLive,
        pressed && (live ? styles.pressed : styles.pressedSoft),
      ]}
      onPress={onPress}
    >
      <View style={[styles.suggestIcon, live && styles.suggestIconLive]}>
        <FontAwesome5 name={icon} size={15} color={live ? colors.danger : colors.text} solid />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.suggestTitle, live && styles.suggestTitleLive]}>{title}</Text>
        <Text style={[styles.suggestSub, live && styles.suggestSubLive]}>{subtitle}</Text>
      </View>
      {badge != null && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge > 99 ? "99+" : badge}</Text>
        </View>
      )}
      <FontAwesome5 name="chevron-right" size={12} color={live ? "rgba(255,255,255,0.75)" : colors.textMuted} />
    </Pressable>
  );
}

function Quick({
  icon,
  label,
  onPress,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={({ pressed }) => [styles.quick, pressed && styles.pressed]} onPress={onPress}>
      <View style={styles.quickIcon}>
        <FontAwesome5 name={icon} size={16} color={colors.text} solid />
      </View>
      <Text style={styles.quickLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xl },

  hero: { marginBottom: spacing.md, marginTop: spacing.sm },
  hello: {
    fontSize: 34,
    fontWeight: "700",
    color: colors.text,
    letterSpacing: -0.8,
  },
  meta: { marginTop: 6, fontSize: 15, color: colors.textMuted, fontWeight: "500" },
  metaSep: { color: "#D0D0D0" },

  statsCard: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: 18,
    marginBottom: spacing.md,
  },
  statsHeader: { marginBottom: 14, gap: 10 },
  statsTitle: { fontSize: 16, fontWeight: "700", color: colors.text },
  periodRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  periodChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: colors.bg,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  periodChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  periodText: { fontSize: 12, fontWeight: "600", color: colors.textMuted },
  periodTextOn: { color: "#fff" },
  statsGrid: { flexDirection: "row", gap: 10 },
  statBox: {
    flex: 1,
    backgroundColor: colors.bg,
    borderRadius: radii.md,
    paddingVertical: 12,
    alignItems: "center",
  },
  statValue: { fontSize: 22, fontWeight: "800", color: colors.text },
  statLabel: { fontSize: 12, color: colors.textMuted, marginTop: 2, fontWeight: "500" },

  section: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.text,
    marginBottom: spacing.md,
    letterSpacing: -0.2,
  },

  suggestCard: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    overflow: "hidden",
    marginBottom: spacing.xl,
  },
  patrolCardLive: {
    backgroundColor: colors.danger,
    borderColor: "#B00510",
  },
  suggestRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  suggestRowLive: {
    backgroundColor: colors.danger,
  },
  suggestIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  suggestIconLive: { backgroundColor: "#fff" },
  suggestTitle: { fontSize: 16, fontWeight: "600", color: colors.text },
  suggestTitleLive: { color: "#fff" },
  suggestSub: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  suggestSubLive: { color: "rgba(255,255,255,0.85)" },
  divider: { height: 1, backgroundColor: colors.border, marginLeft: 72 },

  quickRow: { flexDirection: "row", gap: 12 },
  quick: {
    flex: 1,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingVertical: 18,
    alignItems: "center",
    gap: 10,
  },
  quickIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  quickLabel: { fontSize: 13, fontWeight: "600", color: colors.text },

  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 7,
    backgroundColor: colors.danger,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 4,
  },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "700" },

  pressed: { opacity: 0.88 },
  pressedSoft: { backgroundColor: colors.primarySoft },
});
