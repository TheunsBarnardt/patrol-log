// FDL: blueprints/workflow/commence-patrol.blueprint.yaml

import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Location from "expo-location";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation";
import { api } from "../lib/api";
import { startHeartbeat } from "../lib/heartbeat";
import { useAuthStore } from "../store/auth";
import { colors, spacing } from "../theme";
import type { GeoPoint, MemberRecord, PatrolType, VehicleRecord } from "@patrol-log/shared";

type Props = NativeStackScreenProps<RootStackParamList, "CommencePatrol">;

const PATROL_TYPES: { type: PatrolType; label: string; icon: string }[] = [
  { type: "foot", label: "Foot", icon: "🚶" },
  { type: "vehicle", label: "Vehicle", icon: "🚔" },
  { type: "static", label: "Static", icon: "🏠" },
];

export function CommencePatrolScreen({ navigation }: Props) {
  // Joined members
  const [memberQuery, setMemberQuery] = useState("");
  const [memberResults, setMemberResults] = useState<MemberRecord[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<MemberRecord[]>([]);
  const [searchFocused, setSearchFocused] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Patrol type + vehicle
  const [patrolType, setPatrolType] = useState<PatrolType | null>(null);
  const [vehicles, setVehicles] = useState<VehicleRecord[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleRecord | null>(null);
  const [vehiclePickerOpen, setVehiclePickerOpen] = useState(false);
  const [odometerStart, setOdometerStart] = useState("");
  const [busy, setBusy] = useState(false);

  const profile = useAuthStore((s) => s.profile);
  const deviceToken = useAuthStore((s) => s.deviceToken);

  // Fetch vehicles once (for vehicle patrol type)
  useEffect(() => {
    api.vehicles().then((r) => setVehicles(r.results)).catch(() => {});
  }, []);

  // Debounced member search
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!memberQuery || memberQuery.length < 2) {
      setMemberResults([]);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      try {
        const r = await api.members(memberQuery);
        // Exclude yourself and already-selected members
        setMemberResults(
          r.results.filter(
            (m) => m.call_sign !== profile?.call_sign && !selectedMembers.some((s) => s.member_id === m.member_id),
          ),
        );
      } catch {}
    }, 300);
  }, [memberQuery, selectedMembers, profile]);

  function addMember(m: MemberRecord) {
    setSelectedMembers((prev) => [...prev, m]);
    setMemberQuery("");
    setMemberResults([]);
  }

  function removeMember(id: string) {
    setSelectedMembers((prev) => prev.filter((m) => m.member_id !== id));
  }

  async function handleStart() {
    if (!patrolType) {
      Alert.alert("Missing", "Select a patrol type.");
      return;
    }
    if (patrolType === "vehicle" && (!selectedVehicle || !odometerStart)) {
      Alert.alert("Missing", "Select a vehicle and enter the odometer reading.");
      return;
    }

    setBusy(true);
    try {
      const startLocation = await captureGps();
      const res = await api.commencePatrol({
        joined_patroller_call_signs: selectedMembers.map((m) => m.call_sign),
        patrol_type: patrolType,
        patrol_vehicle: patrolType === "vehicle" ? selectedVehicle!.id : undefined,
        odometer_start: odometerStart ? Number(odometerStart) : undefined,
        start_location: startLocation,
      });

      if (deviceToken) {
        const jti = decodeJti(deviceToken);
        if (jti) await startHeartbeat(res.patrol_id, jti);
      }
      navigation.replace("ActivePatrol", { patrolId: res.patrol_id });
    } catch (err: any) {
      Alert.alert("Could not start patrol", err?.body?.message ?? "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const availableVehicles = vehicles.filter((v) => v.status === "available");

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

        {/* Patrol type */}
        <Text style={styles.label}>Type of patrol</Text>
        <View style={styles.typeRow}>
          {PATROL_TYPES.map(({ type, label, icon }) => (
            <TouchableOpacity
              key={type}
              style={[styles.typeBtn, patrolType === type && styles.typeBtnActive]}
              onPress={() => { setPatrolType(type); setSelectedVehicle(null); }}
            >
              <Text style={styles.typeIcon}>{icon}</Text>
              <Text style={[styles.typeLabel, patrolType === type && styles.typeLabelActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Vehicle selection (only for vehicle patrol) */}
        {patrolType === "vehicle" && (
          <>
            <Text style={styles.label}>Patrol vehicle</Text>
            <TouchableOpacity
              style={styles.dropdown}
              onPress={() => setVehiclePickerOpen(true)}
            >
              <Text style={selectedVehicle ? styles.dropdownValue : styles.dropdownPlaceholder}>
                {selectedVehicle
                  ? `${selectedVehicle.registration}${selectedVehicle.description ? ` · ${selectedVehicle.description}` : ""}`
                  : availableVehicles.length === 0 ? "No vehicles available" : "Select vehicle…"}
              </Text>
              <Text style={styles.dropdownChevron}>⌄</Text>
            </TouchableOpacity>

            <Text style={styles.label}>Odometer start (km)</Text>
            <TextInput
              style={styles.input}
              value={odometerStart}
              onChangeText={setOdometerStart}
              keyboardType="numeric"
              placeholder="Current reading"
              placeholderTextColor={colors.textMuted}
            />
          </>
        )}

        {/* Joining members search */}
        <Text style={styles.label}>Patrollers joining you</Text>
        <TextInput
          style={styles.input}
          value={memberQuery}
          onChangeText={setMemberQuery}
          placeholder="Search by name or call sign…"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
        />

        {/* Search results dropdown */}
        {searchFocused && memberResults.length > 0 && (
          <View style={styles.searchResults}>
            {memberResults.slice(0, 6).map((m) => (
              <TouchableOpacity key={m.member_id} style={styles.searchItem} onPress={() => addMember(m)}>
                <Text style={styles.searchCallSign}>{m.call_sign}</Text>
                <Text style={styles.searchName}>{m.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Selected member badges */}
        {selectedMembers.length > 0 && (
          <View style={styles.badgeRow}>
            {selectedMembers.map((m) => (
              <View key={m.member_id} style={styles.badge}>
                <Text style={styles.badgeText}>{m.call_sign}</Text>
                <TouchableOpacity onPress={() => removeMember(m.member_id)} hitSlop={8}>
                  <Text style={styles.badgeRemove}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        <View style={{ height: spacing.xl }} />

        {/* Start button */}
        <TouchableOpacity
          style={[styles.startBtn, busy && { opacity: 0.6 }]}
          onPress={handleStart}
          disabled={busy || !patrolType}
          activeOpacity={0.85}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.startBtnText}>Start Patrol</Text>
          )}
        </TouchableOpacity>
      </ScrollView>

      {/* Vehicle picker modal */}
      <Modal visible={vehiclePickerOpen} transparent animationType="slide" onRequestClose={() => setVehiclePickerOpen(false)}>
        <TouchableOpacity style={styles.pickerBackdrop} activeOpacity={1} onPress={() => setVehiclePickerOpen(false)} />
        <View style={styles.pickerSheet}>
          <Text style={styles.pickerTitle}>Select vehicle</Text>
          {availableVehicles.length === 0 ? (
            <Text style={{ color: colors.textMuted, textAlign: "center", padding: spacing.md }}>
              No available vehicles in your CPF. Add them in the admin portal.
            </Text>
          ) : (
            <FlatList
              data={availableVehicles}
              keyExtractor={(v) => v.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.pickerItem, selectedVehicle?.id === item.id && styles.pickerItemSelected]}
                  onPress={() => { setSelectedVehicle(item); setVehiclePickerOpen(false); }}
                >
                  <Text style={styles.pickerReg}>{item.registration}</Text>
                  {item.description && <Text style={styles.pickerDesc}>{item.description}</Text>}
                  <Text style={styles.pickerOdo}>{item.lastOdometer.toLocaleString()} km</Text>
                </TouchableOpacity>
              )}
            />
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

async function captureGps(): Promise<GeoPoint | undefined> {
  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== "granted") return undefined;
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy_m: pos.coords.accuracy ?? 9999, captured_at: new Date().toISOString() };
  } catch {
    return undefined;
  }
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
  content: { padding: spacing.md, gap: spacing.xs },
  label: { fontSize: 13, fontWeight: "700", color: colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5, marginTop: spacing.md, marginBottom: spacing.xs },

  // Patrol type
  typeRow: { flexDirection: "row", gap: spacing.sm },
  typeBtn: {
    flex: 1,
    padding: spacing.md,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.cardBg,
    alignItems: "center",
    gap: spacing.xs,
  },
  typeBtnActive: { borderColor: colors.warning, backgroundColor: "#FFF8EC" },
  typeIcon: { fontSize: 24 },
  typeLabel: { fontSize: 13, fontWeight: "700", color: colors.textMuted },
  typeLabelActive: { color: colors.warning },

  // Input
  input: {
    backgroundColor: colors.cardBg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: spacing.md,
    fontSize: 15,
  },

  // Dropdown
  dropdown: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.cardBg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: spacing.md,
  },
  dropdownValue: { flex: 1, fontSize: 15, fontWeight: "600" },
  dropdownPlaceholder: { flex: 1, fontSize: 15, color: colors.textMuted },
  dropdownChevron: { fontSize: 18, color: colors.textMuted },

  // Search results
  searchResults: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    marginTop: 2,
    overflow: "hidden",
  },
  searchItem: {
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  searchCallSign: { fontSize: 14, fontWeight: "800", color: colors.primary, minWidth: 50 },
  searchName: { fontSize: 14, color: colors.text },

  // Badges
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: 20,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    gap: spacing.sm,
  },
  badgeText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  badgeRemove: { color: "rgba(255,255,255,0.8)", fontWeight: "700", fontSize: 12 },

  // Start button
  startBtn: {
    backgroundColor: colors.warning,
    borderRadius: 12,
    padding: spacing.md + 2,
    alignItems: "center",
  },
  startBtnText: { color: "#fff", fontWeight: "800", fontSize: 17 },

  // Vehicle picker modal
  pickerBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.4)" },
  pickerSheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: spacing.lg,
    maxHeight: "60%",
  },
  pickerTitle: { fontSize: 17, fontWeight: "800", marginBottom: spacing.md },
  pickerItem: {
    padding: spacing.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cardBg,
    marginBottom: spacing.sm,
  },
  pickerItemSelected: { borderColor: colors.primary, backgroundColor: "#E8FAF5" },
  pickerReg: { fontSize: 16, fontWeight: "800" },
  pickerDesc: { fontSize: 13, color: colors.textMuted },
  pickerOdo: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
});
