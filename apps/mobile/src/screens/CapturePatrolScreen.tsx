// Capture patrol after the fact — emergency / no time to commence in-app.

import { useEffect, useState, type ComponentProps } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
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
import { notify } from "../lib/notify";
import { colors, radii, spacing } from "../theme";
import {
  patrolTypeRequiresVehicle,
  type PatrolType,
  type VehicleRecord,
} from "@patrol-log/shared";

type Props = NativeStackScreenProps<RootStackParamList, "CapturePatrol">;
type IconName = ComponentProps<typeof FontAwesome5>["name"];

const PATROL_TYPES: { type: PatrolType; label: string; icon: IconName }[] = [
  { type: "foot", label: "Foot", icon: "walking" },
  { type: "vehicle", label: "Vehicle", icon: "car" },
  { type: "static", label: "Static", icon: "map-marker-alt" },
  { type: "sector_monitoring", label: "Monitoring", icon: "eye" },
  { type: "ops", label: "OPS", icon: "broadcast-tower" },
  { type: "responding", label: "Responding", icon: "bolt" },
];

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToIso(value: string): string | null {
  if (!value?.trim()) return null;
  // datetime-local has no timezone — treat as local wall clock.
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function CapturePatrolScreen({ navigation }: Props) {
  const now = new Date();
  const hourAgo = new Date(now.getTime() - 60 * 60_000);

  const [patrolType, setPatrolType] = useState<PatrolType | null>(null);
  const [startLocal, setStartLocal] = useState(toLocalInputValue(hourAgo));
  const [endLocal, setEndLocal] = useState(toLocalInputValue(now));
  const [distanceKm, setDistanceKm] = useState("");
  const [vehicles, setVehicles] = useState<VehicleRecord[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const needsVehicle = patrolType ? patrolTypeRequiresVehicle(patrolType) : false;

  useEffect(() => {
    api.vehicles().then((r) => setVehicles(r.results)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!needsVehicle) setSelectedVehicle(null);
  }, [needsVehicle]);

  async function submit() {
    setFormError(null);
    if (!patrolType) {
      setFormError("Select a patrol type.");
      return;
    }
    const startIso = localInputToIso(startLocal);
    const endIso = localInputToIso(endLocal);
    if (!startIso || !endIso) {
      setFormError("Enter valid start and end times.");
      return;
    }
    if (needsVehicle && !selectedVehicle) {
      setFormError("Choose a vehicle.");
      return;
    }
    let km: number | undefined;
    if (needsVehicle || distanceKm.trim()) {
      km = Number(distanceKm);
      if (!Number.isFinite(km) || km < 0) {
        setFormError("Enter kilometres travelled (0 or more).");
        return;
      }
    }

    setBusy(true);
    try {
      const res = await api.capturePatrol({
        patrol_type: patrolType,
        start_time: startIso,
        end_time: endIso,
        distance_km: km,
        patrol_vehicle: selectedVehicle?.id,
        reason: "emergency",
      });
      notify(
        "Patrol captured",
        `${res.distance_km} km logged · ${PATROL_TYPES.find((t) => t.type === res.patrol_type)?.label ?? res.patrol_type}`,
      );
      navigation.replace("Home");
    } catch (err: any) {
      const msg = err?.body?.message ?? err?.message ?? "Could not capture patrol.";
      setFormError(msg);
      notify("Capture failed", msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.hint}>
          <Text style={styles.hintText}>
            Use this when you couldn’t commence in-app (hurry or emergency). Log type, times, and kilometres after the patrol is done.
          </Text>
        </View>

        <Text style={styles.label}>Patrol type</Text>
        <View style={styles.typeGrid}>
          {PATROL_TYPES.map((t) => {
            const on = patrolType === t.type;
            return (
              <Pressable
                key={t.type}
                style={[styles.typeChip, on && styles.typeChipOn]}
                onPress={() => setPatrolType(t.type)}
              >
                <FontAwesome5 name={t.icon} size={14} color={on ? "#fff" : colors.primary} solid />
                <Text style={[styles.typeChipText, on && styles.typeChipTextOn]}>{t.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.label}>Start time</Text>
        {Platform.OS === "web" ? (
          <input
            type="datetime-local"
            value={startLocal}
            onChange={(e: any) => setStartLocal(e.target.value)}
            style={webInputStyle}
          />
        ) : (
          <TextInput
            style={styles.input}
            value={startLocal}
            onChangeText={setStartLocal}
            placeholder="YYYY-MM-DDTHH:mm"
            autoCapitalize="none"
          />
        )}

        <Text style={styles.label}>End time</Text>
        {Platform.OS === "web" ? (
          <input
            type="datetime-local"
            value={endLocal}
            onChange={(e: any) => setEndLocal(e.target.value)}
            style={webInputStyle}
          />
        ) : (
          <TextInput
            style={styles.input}
            value={endLocal}
            onChangeText={setEndLocal}
            placeholder="YYYY-MM-DDTHH:mm"
            autoCapitalize="none"
          />
        )}

        {needsVehicle && (
          <>
            <Text style={styles.label}>Vehicle</Text>
            {vehicles.length === 0 ? (
              <Text style={styles.muted}>No vehicles on file — add one under Commence patrol first.</Text>
            ) : (
              <View style={styles.vehicleList}>
                {vehicles.map((v) => {
                  const on = selectedVehicle?.id === v.id;
                  return (
                    <Pressable
                      key={v.id}
                      style={[styles.vehicleRow, on && styles.vehicleRowOn]}
                      onPress={() => setSelectedVehicle(v)}
                    >
                      <Text style={[styles.vehicleReg, on && { color: "#fff" }]}>{v.registration}</Text>
                      <Text style={[styles.vehicleDesc, on && { color: "rgba(255,255,255,0.85)" }]}>
                        {v.description || "Vehicle"}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </>
        )}

        <Text style={styles.label}>
          Kilometres travelled{needsVehicle ? "" : " (optional)"}
        </Text>
        <TextInput
          style={styles.input}
          value={distanceKm}
          onChangeText={setDistanceKm}
          placeholder={needsVehicle ? "e.g. 12" : "0"}
          keyboardType="numeric"
        />

        {formError ? <Text style={styles.error}>{formError}</Text> : null}

        <Pressable
          style={({ pressed }) => [styles.submit, busy && { opacity: 0.6 }, pressed && !busy && { opacity: 0.88 }]}
          onPress={() => void submit()}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitText}>Save captured patrol</Text>
          )}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const webInputStyle: Record<string, string | number> = {
  width: "100%",
  boxSizing: "border-box",
  backgroundColor: colors.surfaceMuted,
  borderWidth: 1.5,
  borderStyle: "solid",
  borderColor: colors.border,
  borderRadius: 8,
  padding: 14,
  fontSize: 16,
  fontWeight: "600",
  color: colors.text,
  marginBottom: 12,
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  hint: {
    backgroundColor: colors.primarySoft,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  hintText: { fontSize: 13, color: colors.text, lineHeight: 18, fontWeight: "500" },
  label: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.textMuted,
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
  },
  muted: { fontSize: 13, color: colors.textMuted, marginBottom: spacing.md },
  typeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: spacing.sm },
  typeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  typeChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  typeChipText: { fontSize: 13, fontWeight: "700", color: colors.text },
  typeChipTextOn: { color: "#fff" },
  input: {
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 8,
    padding: spacing.md,
    fontSize: 16,
    fontWeight: "600",
    color: colors.text,
    marginBottom: spacing.sm,
  },
  vehicleList: { gap: 8, marginBottom: spacing.sm },
  vehicleRow: {
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 10,
    padding: spacing.md,
  },
  vehicleRowOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  vehicleReg: { fontSize: 16, fontWeight: "800", color: colors.text },
  vehicleDesc: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  error: { color: colors.danger, fontWeight: "600", marginVertical: spacing.sm },
  submit: {
    marginTop: spacing.lg,
    backgroundColor: colors.primary,
    borderRadius: 28,
    paddingVertical: 16,
    alignItems: "center",
  },
  submitText: { color: "#fff", fontWeight: "800", fontSize: 16 },
});
