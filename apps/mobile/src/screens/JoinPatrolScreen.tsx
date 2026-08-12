import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FontAwesome5 } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation";
import { api } from "../lib/api";
import { notify } from "../lib/notify";
import { startHeartbeat } from "../lib/heartbeat";
import { useAuthStore } from "../store/auth";
import { colors, radii, spacing } from "../theme";
import { parseSqliteUtc, type JoinablePatrolSummary, type PatrolType } from "@patrol-log/shared";

type Props = NativeStackScreenProps<RootStackParamList, "JoinPatrol">;

const TYPE_LABELS: Record<PatrolType, string> = {
  foot: "Foot",
  vehicle: "Vehicle",
  static: "Static",
  sector_monitoring: "Monitoring",
  ops: "OPS",
  responding: "Responding",
};

export function JoinPatrolScreen({ navigation }: Props) {
  const [rows, setRows] = useState<JoinablePatrolSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const deviceToken = useAuthStore((s) => s.deviceToken);

  const refresh = useCallback(async () => {
    try {
      const res = await api.joinablePatrols();
      setRows(res.results);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleJoin(patrol: JoinablePatrolSummary) {
    setJoiningId(patrol.patrol_id);
    try {
      const joined = await api.joinPatrol(patrol.patrol_id);
      if (deviceToken) {
        const jti = decodeJti(deviceToken);
        if (jti) await startHeartbeat(joined.patrol_id, jti);
      }
      notify("Joined patrol", `You're on ${patrol.primary_patroller_call_sign}'s patrol as a passenger.`);
      navigation.replace("ActivePatrol", { patrolId: joined.patrol_id });
    } catch (err: any) {
      const msg = err?.body?.message ?? err?.message ?? "Unable to join patrol.";
      notify("Could not join", msg);
    } finally {
      setJoiningId(null);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => { setLoading(true); void refresh(); }} />}
      >
        <Text style={styles.headline}>Join a patrol</Text>
        <Text style={styles.sub}>
          Pick an active patrol in your sector. You’ll join as a passenger — stand down from your own device when you leave (no km needed).
        </Text>

        {loading && rows.length === 0 ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
        ) : rows.length === 0 ? (
          <View style={styles.empty}>
            <FontAwesome5 name="car" size={22} color={colors.textMuted} solid />
            <Text style={styles.emptyTitle}>No active patrols</Text>
            <Text style={styles.emptySub}>When someone in your sector is out, they’ll show up here.</Text>
          </View>
        ) : (
          rows.map((p) => {
            const busy = joiningId === p.patrol_id;
            return (
              <Pressable
                key={p.patrol_id}
                style={({ pressed }) => [styles.card, pressed && !busy && styles.pressed, busy && { opacity: 0.6 }]}
                onPress={() => void handleJoin(p)}
                disabled={!!joiningId}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.callSign}>{p.primary_patroller_call_sign}</Text>
                  <Text style={styles.name}>{p.primary_patroller_name}</Text>
                  <Text style={styles.meta}>
                    {TYPE_LABELS[p.patrol_type] ?? p.patrol_type}
                    {p.vehicle_registration ? ` · ${p.vehicle_registration}` : ""}
                    {p.joined_count > 0 ? ` · ${p.joined_count} passenger${p.joined_count === 1 ? "" : "s"}` : ""}
                  </Text>
                  <Text style={styles.time}>Started {formatStart(p.start_time)}</Text>
                </View>
                <View style={styles.joinBtn}>
                  <Text style={styles.joinText}>{busy ? "Joining…" : "Join"}</Text>
                </View>
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function formatStart(iso: string): string {
  const d = parseSqliteUtc(iso) ?? new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function decodeJti(jwt: string): string | null {
  try {
    const [, payload] = jwt.split(".");
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof json.jti === "string" ? json.jti : null;
  } catch {
    return null;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xl },
  headline: { fontSize: 28, fontWeight: "800", color: colors.text, letterSpacing: -0.5 },
  sub: { marginTop: 8, marginBottom: spacing.lg, fontSize: 14, lineHeight: 20, color: colors.textMuted, fontWeight: "500" },
  empty: {
    marginTop: spacing.xl,
    alignItems: "center",
    gap: 10,
    padding: spacing.xl,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.xl,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  emptyTitle: { fontSize: 17, fontWeight: "700", color: colors.text },
  emptySub: { fontSize: 14, color: colors.textMuted, textAlign: "center", fontWeight: "500" },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.xl,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: 18,
    marginBottom: spacing.md,
  },
  callSign: { fontSize: 18, fontWeight: "800", color: colors.text },
  name: { fontSize: 14, fontWeight: "600", color: colors.text, marginTop: 2 },
  meta: { fontSize: 13, color: colors.textMuted, marginTop: 6, fontWeight: "500" },
  time: { fontSize: 12, color: colors.textMuted, marginTop: 4, fontWeight: "500" },
  joinBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
  },
  joinText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  pressed: { opacity: 0.9 },
});
