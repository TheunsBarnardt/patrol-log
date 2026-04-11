// FDL: blueprints/workflow/stand-down-patrol.blueprint.yaml

import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Location from "expo-location";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation";
import { api } from "../lib/api";
import { stopHeartbeat } from "../lib/heartbeat";
import { colors, spacing } from "../theme";
import type { ActivePatrolResponse, GeoPoint } from "@patrol-log/shared";

type Props = NativeStackScreenProps<RootStackParamList, "ActivePatrol">;

export function ActivePatrolScreen({ navigation, route }: Props) {
  const { patrolId } = route.params;
  const [patrol, setPatrol] = useState<ActivePatrolResponse | null>(null);
  const [odometerEnd, setOdometerEnd] = useState("");
  const [busy, setBusy] = useState(false);

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

  async function standDownSelf() {
    if (!patrol) return;
    setBusy(true);
    try {
      const loc = await captureGps();
      await api.standDown(patrol.patrol_id, {
        odometer_end: odometerEnd ? Number(odometerEnd) : undefined,
        end_location: loc,
      });
      stopHeartbeat();
      navigation.replace("Home");
    } catch (err: any) {
      Alert.alert("Stand down failed", err?.body?.message ?? "Unable to stand down.");
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
              <Text style={[styles.cardLine, { marginTop: spacing.sm, fontWeight: "700" }]}>KM's Traveled</Text>
              <TextInput
                style={styles.input}
                value={odometerEnd}
                onChangeText={setOdometerEnd}
                placeholder="End odometer reading"
                keyboardType="numeric"
              />
            </>
          )}

          <TouchableOpacity style={[styles.standDownPrimary, busy && { opacity: 0.6 }]} onPress={standDownSelf} disabled={busy}>
            <Text style={styles.standDownText}>Stand down</Text>
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
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy_m: pos.coords.accuracy ?? 9999, captured_at: new Date().toISOString() };
  } catch {
    return undefined;
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} ${d.toISOString().slice(0, 10)}`;
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
    backgroundColor: colors.danger,
    padding: spacing.md,
    borderRadius: 10,
    alignItems: "center",
  },
  standDownJoined: {
    backgroundColor: colors.info,
    padding: spacing.md,
    borderRadius: 10,
    alignItems: "center",
    marginTop: spacing.sm,
  },
  standDownText: { color: "#fff", fontWeight: "700", fontSize: 16 },
});
