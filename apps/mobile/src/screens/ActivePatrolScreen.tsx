// FDL: blueprints/workflow/stand-down-patrol.blueprint.yaml

import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Location from "expo-location";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation";
import { api } from "../lib/api";
import { notify } from "../lib/notify";
import { startHeartbeat, stopHeartbeat } from "../lib/heartbeat";
import { useAuthStore } from "../store/auth";
import { colors, spacing } from "../theme";
import type { ActivePatrolResponse, GeoPoint } from "@patrol-log/shared";

type Props = NativeStackScreenProps<RootStackParamList, "ActivePatrol">;

export function ActivePatrolScreen({ navigation, route }: Props) {
  const { patrolId } = route.params;
  const [patrol, setPatrol] = useState<ActivePatrolResponse | null>(null);
  const [odometerEnd, setOdometerEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deviceToken = useAuthStore((s) => s.deviceToken);

  const refresh = useCallback(async () => {
    try {
      const p = await api.activePatrol();
      setPatrol(p && p.patrol_id === patrolId ? p : p);
    } catch (err) {
      console.warn("[active-patrol] failed to refresh", err);
    }
  }, [patrolId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Re-start the heartbeat loop whenever this screen mounts with an active patrol.
  // This matters when the app was killed/backgrounded — the in-memory setInterval
  // from startHeartbeat() dies, so the live-map pin freezes until we re-arm it.
  useEffect(() => {
    if (!deviceToken) return;
    const jti = decodeJti(deviceToken);
    if (!jti) return;
    void startHeartbeat(patrolId, jti);
  }, [patrolId, deviceToken]);

  async function standDownSelf() {
    if (!patrol) return;

    const isVehicle = patrol.patrol_type === "vehicle";
    const endOdo = odometerEnd.trim() === "" ? NaN : Number(odometerEnd);
    if (isVehicle) {
      if (!Number.isFinite(endOdo)) {
        const msg = "Enter the end odometer reading before standing down.";
        setError(msg);
        notify("Stand down", msg);
        return;
      }
      if (patrol.odometer_start != null && endOdo < patrol.odometer_start) {
        const msg = `End odometer must be at least ${patrol.odometer_start.toLocaleString()} km.`;
        setError(msg);
        notify("Stand down", msg);
        return;
      }
    }

    setBusy(true);
    setError(null);
    try {
      const loc = await captureGps();
      await api.standDown(patrol.patrol_id, {
        odometer_end: isVehicle ? endOdo : undefined,
        end_location: loc,
      });
      stopHeartbeat();
      navigation.replace("Home");
    } catch (err: any) {
      const msg = err?.body?.message ?? err?.message ?? "Unable to stand down.";
      setError(msg);
      notify("Stand down failed", msg);
    } finally {
      setBusy(false);
    }
  }

  if (!patrol) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      </SafeAreaView>
    );
  }

  const isVehicle = patrol.patrol_type === "vehicle";

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <Text style={styles.section}>Patrollers</Text>
        <View style={styles.divider} />

        <View style={styles.card}>
          <Text style={styles.cardHead}>{patrol.primary_patroller_call_sign}</Text>
          <Text style={styles.cardLine}>Primary</Text>
          <Text style={styles.cardLine}>Start Time: {formatTime(patrol.start_time)}</Text>

          {isVehicle && (
            <>
              <View style={styles.odoHint}>
                <Text style={styles.odoHintText}>
                  Enter your end odometer reading before you can stand down.
                  {patrol.odometer_start != null
                    ? ` Started at ${patrol.odometer_start.toLocaleString()} km.`
                    : ""}
                </Text>
              </View>
              <Text style={[styles.cardLine, { marginTop: spacing.sm, fontWeight: "700" }]}>
                End odometer (km)
              </Text>
              <TextInput
                style={styles.input}
                value={odometerEnd}
                onChangeText={(v) => { setOdometerEnd(v); setError(null); }}
                placeholder="Type end odometer reading"
                keyboardType="numeric"
              />
            </>
          )}

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <TouchableOpacity style={[styles.standDownPrimary, busy && { opacity: 0.6 }]} onPress={standDownSelf} disabled={busy}>
            <Text style={styles.standDownText}>{busy ? "Standing down…" : "Stand down"}</Text>
          </TouchableOpacity>
        </View>

        {patrol.joined_patrollers.length > 0 && (
          <>
            <Text style={styles.section}>Joined Patrollers</Text>
            <View style={styles.divider} />
            {patrol.joined_patrollers.map((jp) => (
              <View style={styles.card} key={jp.call_sign}>
                <Text style={styles.cardHead}>{jp.call_sign}</Text>
                <Text style={styles.cardLine}>{jp.name}</Text>
                <Text style={styles.cardLine}>Start Time: {formatTime(jp.start_time)}</Text>
                {jp.end_time ? (
                  <Text style={[styles.cardLine, { color: colors.textMuted }]}>Stood down at {formatTime(jp.end_time)}</Text>
                ) : (
                  <View style={[styles.standDownJoined]}>
                    <Text style={styles.standDownText}>(joined patroller stands down from their own device)</Text>
                  </View>
                )}
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

async function captureGps(): Promise<GeoPoint | undefined> {
  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== "granted") return undefined;
    const pos = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
    ]);
    if (!pos) return undefined;
    return {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy_m: pos.coords.accuracy ?? 9999,
      captured_at: new Date().toISOString(),
    };
  } catch {
    return undefined;
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} ${d.toISOString().slice(0, 10)}`;
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
  title: { fontSize: 24, fontWeight: "800", textAlign: "center", marginBottom: spacing.md },
  section: { fontSize: 18, fontWeight: "700", marginTop: spacing.md },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  card: { paddingVertical: spacing.sm, marginBottom: spacing.sm },
  cardHead: { fontSize: 18, fontWeight: "800" },
  cardLine: { fontSize: 14, fontWeight: "600" },
  input: {
    backgroundColor: colors.cardBg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    padding: spacing.md,
    fontSize: 16,
    marginVertical: spacing.sm,
  },
  standDownPrimary: {
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: 28,
    alignItems: "center",
  },
  standDownJoined: {
    backgroundColor: colors.surfaceMuted,
    padding: spacing.md,
    borderRadius: 16,
    alignItems: "center",
    marginTop: spacing.sm,
  },
  standDownText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  errorText: { color: colors.danger, fontWeight: "600", fontSize: 14, marginBottom: spacing.sm },
  odoHint: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: 16,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  odoHintText: { color: colors.text, fontWeight: "600", fontSize: 14, lineHeight: 20 },
});
