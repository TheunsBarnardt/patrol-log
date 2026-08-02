import { useEffect, useRef, useState, type ComponentProps } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FontAwesome5 } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation";
import { useAuthStore } from "../store/auth";
import { useMessagingStore } from "../store/messaging";
import { api } from "../lib/api";
import { registerPushToken } from "../lib/notifications";
import type { ActivePatrolResponse } from "@patrol-log/shared";
import { colors, radii, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Home">;
type IconName = ComponentProps<typeof FontAwesome5>["name"];

export function HomeScreen({ navigation }: Props) {
  const profile = useAuthStore((s) => s.profile);
  const setUnreadCount = useMessagingStore((s) => s.setUnreadCount);
  const unreadCount = useMessagingStore((s) => s.unreadCount);
  const [activePatrol, setActivePatrol] = useState<ActivePatrolResponse | null>(null);
  const pushRegistered = useRef(false);

  async function refreshUnread() {
    try {
      const res = await api.messageChannels();
      setUnreadCount(res.channels.reduce((sum, ch) => sum + ch.unreadCount, 0));
    } catch {}
  }

  useEffect(() => {
    if (!pushRegistered.current) {
      pushRegistered.current = true;
      void registerPushToken();
    }
  }, []);

  useEffect(() => {
    const unsub = navigation.addListener("focus", () => {
      void api.activePatrol().then(setActivePatrol).catch(() => setActivePatrol(null));
      void refreshUnread();
    });
    return unsub;
  }, [navigation]);

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

        <Pressable
          style={({ pressed }) => [
            styles.cta,
            activePatrol ? styles.ctaLive : null,
            pressed && styles.pressed,
          ]}
          onPress={() =>
            activePatrol
              ? navigation.navigate("ActivePatrol", { patrolId: activePatrol.patrol_id })
              : navigation.navigate("CommencePatrol")
          }
        >
          <View style={{ flex: 1 }}>
            <Text style={[styles.ctaTitle, activePatrol && styles.ctaTitleLive]}>
              {activePatrol ? "Active patrol" : "Commence patrol"}
            </Text>
            <Text style={[styles.ctaSub, activePatrol && styles.ctaSubLive]}>
              {activePatrol ? "Tap to view or stand down" : "Where are you patrolling?"}
            </Text>
          </View>
          <View style={[styles.ctaIcon, activePatrol && styles.ctaIconLive]}>
            <FontAwesome5 name="arrow-right" size={16} color={activePatrol ? colors.danger : colors.primary} solid />
          </View>
        </Pressable>

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
}: {
  icon: IconName;
  title: string;
  subtitle: string;
  onPress: () => void;
  badge?: number;
}) {
  return (
    <Pressable style={({ pressed }) => [styles.suggestRow, pressed && styles.pressedSoft]} onPress={onPress}>
      <View style={styles.suggestIcon}>
        <FontAwesome5 name={icon} size={15} color={colors.text} solid />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.suggestTitle}>{title}</Text>
        <Text style={styles.suggestSub}>{subtitle}</Text>
      </View>
      {badge != null && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge > 99 ? "99+" : badge}</Text>
        </View>
      )}
      <FontAwesome5 name="chevron-right" size={12} color="#B3B3B3" />
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

  hero: { marginBottom: spacing.lg, marginTop: spacing.sm },
  hello: {
    fontSize: 34,
    fontWeight: "700",
    color: colors.text,
    letterSpacing: -0.8,
  },
  meta: { marginTop: 6, fontSize: 15, color: colors.textMuted, fontWeight: "500" },
  metaSep: { color: "#D0D0D0" },

  cta: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.xl,
    paddingVertical: 22,
    paddingHorizontal: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.xl,
  },
  ctaLive: { backgroundColor: colors.danger },
  ctaTitle: { fontSize: 22, fontWeight: "700", color: colors.text, letterSpacing: -0.3 },
  ctaTitleLive: { color: "#fff" },
  ctaSub: { fontSize: 14, color: colors.textMuted, marginTop: 4, fontWeight: "500" },
  ctaSubLive: { color: "rgba(255,255,255,0.85)" },
  ctaIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaIconLive: { backgroundColor: "#fff" },

  section: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.text,
    marginBottom: spacing.md,
    letterSpacing: -0.2,
  },

  suggestCard: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.xl,
    overflow: "hidden",
    marginBottom: spacing.xl,
  },
  suggestRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  suggestIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  suggestTitle: { fontSize: 16, fontWeight: "600", color: colors.text },
  suggestSub: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  divider: { height: 1, backgroundColor: "#EBEBEB", marginLeft: 72 },

  quickRow: { flexDirection: "row", gap: 12 },
  quick: {
    flex: 1,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.xl,
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
  pressedSoft: { backgroundColor: "#EFEFEF" },
});
