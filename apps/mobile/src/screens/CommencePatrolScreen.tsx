// FDL: blueprints/workflow/commence-patrol.blueprint.yaml

import { useEffect, useRef, useState, type ComponentProps } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FontAwesome5 } from "@expo/vector-icons";
import * as Location from "expo-location";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation";
import { api } from "../lib/api";
import { notify } from "../lib/notify";
import { startHeartbeat } from "../lib/heartbeat";
import { cacheGet, cacheSet } from "../lib/offlineCache";
import { useConnectivityStore } from "../lib/connectivity";
import { useAuthStore } from "../store/auth";
import { colors, radii, spacing } from "../theme";
import {
  patrolTypeRequiresVehicle,
  type GeoPoint,
  type MemberRecord,
  type PatrolType,
  type VehicleRecord,
} from "@patrol-log/shared";

type Props = NativeStackScreenProps<RootStackParamList, "CommencePatrol">;
type IconName = ComponentProps<typeof FontAwesome5>["name"];

const PATROL_TYPES: { type: PatrolType; label: string; icon: IconName }[] = [
  { type: "foot", label: "Foot", icon: "walking" },
  { type: "vehicle", label: "Vehicle", icon: "car" },
  { type: "static", label: "Static", icon: "map-marker-alt" },
  { type: "sector_monitoring", label: "Monitoring", icon: "eye" },
  { type: "ops", label: "OPS", icon: "broadcast-tower" },
  { type: "responding", label: "Responding", icon: "bolt" },
];

export function CommencePatrolScreen({ navigation }: Props) {
  const [memberQuery, setMemberQuery] = useState("");
  const [memberResults, setMemberResults] = useState<MemberRecord[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<MemberRecord[]>([]);
  const [guestNames, setGuestNames] = useState<string[]>([]);
  const [guestDraft, setGuestDraft] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [patrolType, setPatrolType] = useState<PatrolType | null>(null);
  const [vehicles, setVehicles] = useState<VehicleRecord[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleRecord | null>(null);
  const [vehiclePickerOpen, setVehiclePickerOpen] = useState(false);
  const [addOwnOpen, setAddOwnOpen] = useState(false);
  const [editingVehicleId, setEditingVehicleId] = useState<string | null>(null);
  const [ownReg, setOwnReg] = useState("");
  const [ownDesc, setOwnDesc] = useState("");
  const [ownOdo, setOwnOdo] = useState("");
  const [addingOwn, setAddingOwn] = useState(false);
  const [odometerStart, setOdometerStart] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const profile = useAuthStore((s) => s.profile);
  const deviceToken = useAuthStore((s) => s.deviceToken);

  useEffect(() => {
    api
      .vehicles()
      .then(async (r) => {
        setVehicles(r.results);
        await cacheSet("vehicles", r.results);
      })
      .catch(async () => {
        const cached = await cacheGet<VehicleRecord[]>("vehicles");
        if (cached?.data) setVehicles(cached.data);
      });
  }, []);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!memberQuery || memberQuery.length < 2) {
      setMemberResults([]);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      try {
        const r = await api.members(memberQuery);
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

  function addGuestName() {
    const name = guestDraft.trim();
    if (!name) return;
    if (guestNames.some((g) => g.toLowerCase() === name.toLowerCase())) {
      setGuestDraft("");
      return;
    }
    setGuestNames((prev) => [...prev, name]);
    setGuestDraft("");
  }

  function removeGuestName(name: string) {
    setGuestNames((prev) => prev.filter((g) => g !== name));
  }

  function openAddVehicle() {
    setEditingVehicleId(null);
    setOwnReg("");
    setOwnDesc("");
    setOwnOdo("");
    setVehiclePickerOpen(false);
    setAddOwnOpen(true);
  }

  function openEditVehicle(v: VehicleRecord) {
    setEditingVehicleId(v.id);
    setOwnReg(v.registration);
    setOwnDesc(v.description ?? "");
    setOwnOdo(String(v.lastOdometer ?? 0));
    setVehiclePickerOpen(false);
    setAddOwnOpen(true);
  }

  async function handleSaveOwnVehicle() {
    const registration = ownReg.trim().toUpperCase();
    if (registration.length < 2) {
      notify("Missing", "Enter the vehicle registration.");
      return;
    }
    setAddingOwn(true);
    try {
      const saved = editingVehicleId
        ? await api.updateOwnVehicle(editingVehicleId, {
            registration,
            description: ownDesc.trim() || "Own vehicle",
            last_odometer: ownOdo ? Number(ownOdo) : 0,
          })
        : await api.createOwnVehicle({
            registration,
            description: ownDesc.trim() || "Own vehicle",
            last_odometer: ownOdo ? Number(ownOdo) : 0,
          });
      setVehicles((prev) => {
        const without = prev.filter((v) => v.id !== saved.id);
        return [...without, saved].sort((a, b) => a.registration.localeCompare(b.registration));
      });
      setSelectedVehicle(saved);
      if (ownOdo) setOdometerStart(ownOdo);
      setAddOwnOpen(false);
      setVehiclePickerOpen(false);
      setEditingVehicleId(null);
      setOwnReg("");
      setOwnDesc("");
      setOwnOdo("");
      setFormError(null);
      notify(editingVehicleId ? "Vehicle updated" : "Vehicle saved", saved.registration);
    } catch (err: any) {
      notify(editingVehicleId ? "Could not update vehicle" : "Could not add vehicle", err?.body?.message ?? "Something went wrong.");
    } finally {
      setAddingOwn(false);
    }
  }

  async function handleStart() {
    if (!patrolType) {
      setFormError("Choose a patrol type.");
      return;
    }
    if (!useConnectivityStore.getState().online) {
      setFormError("Needs connection — commence requires internet. Use Capture patrol if already finished.");
      notify("Needs connection", "Commence requires an internet connection.");
      return;
    }
    const needsVehicle = patrolTypeRequiresVehicle(patrolType);
    if (needsVehicle && !selectedVehicle) {
      setFormError("Choose or add your vehicle.");
      return;
    }

    setBusy(true);
    setFormError(null);
    try {
      const startLocation = await captureGps();
      const res = await api.commencePatrol({
        joined_patroller_call_signs: selectedMembers.map((m) => m.call_sign),
        guest_names: guestNames.length > 0 ? guestNames : undefined,
        patrol_type: patrolType,
        patrol_vehicle: needsVehicle ? selectedVehicle!.id : undefined,
        odometer_start: odometerStart ? Number(odometerStart) : undefined,
        start_location: startLocation,
      });

      if (deviceToken) {
        const jti = decodeJti(deviceToken);
        if (jti) await startHeartbeat(res.patrol_id, jti);
      }
      navigation.replace("ActivePatrol", { patrolId: res.patrol_id });
    } catch (err: any) {
      const code = err?.body?.error ?? err?.code;
      if (code === "COMMENCE_ALREADY_ON_PATROL") {
        try {
          const active = await api.activePatrol();
          if (active?.patrol_id) {
            notify("Already on patrol", "Opening your active patrol.");
            navigation.replace("ActivePatrol", { patrolId: active.patrol_id });
            return;
          }
        } catch {}
      }
      const msg = err?.body?.message ?? "Something went wrong.";
      setFormError(msg);
      notify("Could not start patrol", msg);
    } finally {
      setBusy(false);
    }
  }

  const availableVehicles = vehicles.filter((v) => v.status === "available");
  const needsVehicle = !!patrolType && patrolTypeRequiresVehicle(patrolType);
  const canStart = !!patrolType && !(needsVehicle && !selectedVehicle);

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.headline}>How are you{"\n"}patrolling?</Text>

        <View style={styles.typeGrid}>
          {PATROL_TYPES.map(({ type, label, icon }) => {
            const active = patrolType === type;
            return (
              <Pressable
                key={type}
                style={({ pressed }) => [
                  styles.typeCard,
                  active && styles.typeCardActive,
                  pressed && styles.pressedSoft,
                ]}
                onPress={() => {
                  setPatrolType(type);
                  setSelectedVehicle(null);
                  setFormError(null);
                }}
              >
                <View style={[styles.typeIcon, active && styles.typeIconActive]}>
                  <FontAwesome5 name={icon} size={16} color={active ? "#fff" : colors.text} solid />
                </View>
                <Text style={[styles.typeLabel, active && styles.typeLabelActive]} numberOfLines={1}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {needsVehicle && (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Vehicle</Text>
            <Pressable style={styles.fieldBtn} onPress={() => setVehiclePickerOpen(true)}>
              <Text style={selectedVehicle ? styles.fieldValue : styles.fieldPlaceholder}>
                {selectedVehicle
                  ? selectedVehicle.registration
                  : availableVehicles.length === 0
                    ? "Add your vehicle"
                    : "Choose vehicle"}
              </Text>
              <FontAwesome5 name="chevron-right" size={12} color={colors.textMuted} />
            </Pressable>
            {!!selectedVehicle?.description && (
              <Text style={styles.fieldHint}>{selectedVehicle.description}</Text>
            )}

            <Text style={[styles.blockTitle, { marginTop: spacing.lg }]}>Odometer start (optional)</Text>
            <TextInput
              style={styles.fieldInput}
              value={odometerStart}
              onChangeText={(v) => { setOdometerStart(v); setFormError(null); }}
              keyboardType="numeric"
              placeholder={
                selectedVehicle
                  ? `Last ${selectedVehicle.lastOdometer.toLocaleString()} km`
                  : "Enter reading"
              }
              placeholderTextColor={colors.textMuted}
            />
            <Text style={styles.fieldHint}>
              Optional. Fill in for tax/odometer tracking — otherwise you’ll enter km travelled when you stand down.
            </Text>
          </View>
        )}

        <View style={styles.block}>
          <Text style={styles.blockTitle}>Who’s joining?</Text>
          <View style={styles.searchField}>
            <FontAwesome5 name="search" size={14} color={colors.textMuted} />
            <TextInput
              style={styles.searchInput}
              value={memberQuery}
              onChangeText={setMemberQuery}
              placeholder="Search name or call sign"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
            />
          </View>

          {searchFocused && memberResults.length > 0 && (
            <View style={styles.results}>
              {memberResults.slice(0, 6).map((m) => (
                <Pressable key={m.member_id} style={styles.resultRow} onPress={() => addMember(m)}>
                  <Text style={styles.resultCs}>{m.call_sign}</Text>
                  <Text style={styles.resultName}>{m.name}</Text>
                </Pressable>
              ))}
            </View>
          )}

          {selectedMembers.length > 0 && (
            <View style={styles.chipRow}>
              {selectedMembers.map((m) => (
                <Pressable key={m.member_id} style={styles.chip} onPress={() => removeMember(m.member_id)}>
                  <Text style={styles.chipText}>{m.call_sign}</Text>
                  <FontAwesome5 name="times" size={11} color={colors.text} />
                </Pressable>
              ))}
            </View>
          )}
        </View>

        <View style={styles.block}>
          <Text style={styles.blockTitle}>Guests (non-members)</Text>
          <Text style={styles.fieldHint}>People without an account — logged by name only.</Text>
          <View style={styles.searchField}>
            <FontAwesome5 name="user" size={14} color={colors.textMuted} />
            <TextInput
              style={styles.searchInput}
              value={guestDraft}
              onChangeText={setGuestDraft}
              placeholder="Guest name"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="words"
              onSubmitEditing={addGuestName}
              returnKeyType="done"
            />
            <Pressable onPress={addGuestName} hitSlop={8} disabled={!guestDraft.trim()}>
              <Text style={{ color: guestDraft.trim() ? colors.primary : colors.textMuted, fontWeight: "700" }}>
                Add
              </Text>
            </Pressable>
          </View>
          {guestNames.length > 0 && (
            <View style={styles.chipRow}>
              {guestNames.map((name) => (
                <Pressable key={name} style={styles.chip} onPress={() => removeGuestName(name)}>
                  <Text style={styles.chipText}>{name}</Text>
                  <FontAwesome5 name="times" size={11} color={colors.text} />
                </Pressable>
              ))}
            </View>
          )}
        </View>

        {formError ? <Text style={styles.errorText}>{formError}</Text> : null}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          style={({ pressed }) => [
            styles.startBtn,
            (!canStart || busy) && styles.startBtnDisabled,
            pressed && canStart && !busy && { opacity: 0.9 },
          ]}
          onPress={handleStart}
          disabled={busy || !canStart}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.startBtnText}>Confirm and start</Text>
          )}
        </Pressable>
      </View>

      <Modal visible={vehiclePickerOpen} transparent animationType="slide" onRequestClose={() => setVehiclePickerOpen(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setVehiclePickerOpen(false)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Choose a vehicle</Text>
          <Pressable style={styles.addRow} onPress={openAddVehicle}>
            <View style={styles.addIcon}>
              <FontAwesome5 name="plus" size={14} color="#fff" solid />
            </View>
            <Text style={styles.addText}>Add own vehicle</Text>
          </Pressable>
          {availableVehicles.length === 0 ? (
            <Text style={styles.empty}>No vehicles yet. Add yours to continue.</Text>
          ) : (
            <FlatList
              data={availableVehicles}
              keyExtractor={(v) => v.id}
              renderItem={({ item }) => {
                const selected = selectedVehicle?.id === item.id;
                return (
                  <View style={[styles.vehicleRow, selected && styles.vehicleRowSelected]}>
                    <Pressable
                      style={{ flex: 1 }}
                      onPress={() => {
                        setSelectedVehicle(item);
                        setVehiclePickerOpen(false);
                        setFormError(null);
                        if (!odometerStart) setOdometerStart(String(item.lastOdometer));
                      }}
                    >
                      <Text style={styles.vehicleReg}>{item.registration}</Text>
                      <Text style={styles.vehicleMeta}>
                        {[item.description, `${item.lastOdometer.toLocaleString()} km`].filter(Boolean).join(" · ")}
                      </Text>
                    </Pressable>
                    <Pressable
                      hitSlop={10}
                      onPress={() => openEditVehicle(item)}
                      style={{ padding: 8 }}
                    >
                      <FontAwesome5 name="edit" size={14} color={colors.textMuted} solid />
                    </Pressable>
                    {selected && <FontAwesome5 name="check" size={14} color={colors.text} solid />}
                  </View>
                );
              }}
            />
          )}
        </View>
      </Modal>

      <Modal visible={addOwnOpen} transparent animationType="slide" onRequestClose={() => setAddOwnOpen(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setAddOwnOpen(false)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>{editingVehicleId ? "Edit vehicle" : "Add own vehicle"}</Text>
          <Text style={styles.sheetLabel}>Registration</Text>
          <TextInput
            style={styles.fieldInput}
            value={ownReg}
            onChangeText={setOwnReg}
            autoCapitalize="characters"
            placeholder="ABC123GP"
            placeholderTextColor={colors.textMuted}
          />
          <Text style={styles.sheetLabel}>Description</Text>
          <TextInput
            style={styles.fieldInput}
            value={ownDesc}
            onChangeText={setOwnDesc}
            placeholder="Optional"
            placeholderTextColor={colors.textMuted}
          />
          <Text style={styles.sheetLabel}>Odometer</Text>
          <TextInput
            style={styles.fieldInput}
            value={ownOdo}
            onChangeText={setOwnOdo}
            keyboardType="numeric"
            placeholder="0"
            placeholderTextColor={colors.textMuted}
          />
          <Pressable
            style={[styles.startBtn, { marginTop: spacing.lg }, addingOwn && styles.startBtnDisabled]}
            onPress={handleSaveOwnVehicle}
            disabled={addingOwn}
          >
            {addingOwn ? <ActivityIndicator color="#fff" /> : <Text style={styles.startBtnText}>Save</Text>}
          </Pressable>
        </View>
      </Modal>
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
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 140 },

  headline: {
    fontSize: 34,
    fontWeight: "700",
    color: colors.text,
    letterSpacing: -0.9,
    lineHeight: 40,
    marginBottom: spacing.xl,
  },

  typeGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: spacing.xl,
  },
  typeCard: {
    width: "48%",
    flexGrow: 1,
    minWidth: "46%",
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.xl,
    paddingVertical: 16,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  typeCardActive: {
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  typeIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  typeIconActive: { backgroundColor: colors.primary },
  typeLabel: { flex: 1, fontSize: 15, fontWeight: "600", color: colors.text },
  typeLabelActive: { fontWeight: "700" },
  pressedSoft: { opacity: 0.85 },

  block: { marginBottom: spacing.xl },
  blockTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.text,
    marginBottom: spacing.md,
    letterSpacing: -0.2,
  },
  fieldBtn: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.xl,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: 20,
    paddingVertical: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  fieldValue: { fontSize: 17, fontWeight: "600", color: colors.text },
  fieldPlaceholder: { fontSize: 17, fontWeight: "500", color: colors.textMuted },
  fieldInput: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.xl,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: 20,
    paddingVertical: 18,
    fontSize: 17,
    fontWeight: "500",
    color: colors.text,
  },
  fieldHint: { marginTop: 8, fontSize: 13, color: colors.textMuted, fontWeight: "500" },

  searchField: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.xl,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: 18,
    paddingVertical: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  searchInput: { flex: 1, paddingVertical: 14, fontSize: 16, color: colors.text },
  results: {
    marginTop: spacing.sm,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.xl,
    borderWidth: 1.5,
    borderColor: colors.border,
    overflow: "hidden",
  },
  resultRow: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  resultCs: { fontSize: 15, fontWeight: "700", color: colors.text, minWidth: 56 },
  resultName: { fontSize: 15, color: colors.textMuted, fontWeight: "500" },

  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: spacing.md },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  chipText: { fontSize: 14, fontWeight: "700", color: colors.text },

  errorText: { color: colors.danger, fontWeight: "600", fontSize: 14, marginBottom: spacing.md },

  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    padding: spacing.lg,
    backgroundColor: colors.bg,
  },
  startBtn: {
    backgroundColor: colors.primary,
    borderRadius: 28,
    paddingVertical: 17,
    alignItems: "center",
  },
  startBtnDisabled: { backgroundColor: colors.border },
  startBtnText: { color: "#fff", fontWeight: "700", fontSize: 17 },

  sheetBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.bg,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: spacing.lg,
    maxHeight: "75%",
  },
  sheetHandle: {
    alignSelf: "center",
    width: 48,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.border,
    marginBottom: spacing.md,
  },
  sheetTitle: { fontSize: 22, fontWeight: "700", color: colors.text, marginBottom: spacing.lg, letterSpacing: -0.3 },
  sheetLabel: { fontSize: 13, fontWeight: "600", color: colors.textMuted, marginBottom: 8, marginTop: spacing.md },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.xl,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: 16,
    marginBottom: spacing.md,
  },
  addIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  addText: { fontSize: 16, fontWeight: "600", color: colors.text },
  empty: { color: colors.textMuted, textAlign: "center", padding: spacing.lg, lineHeight: 20 },
  vehicleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  vehicleRowSelected: {},
  vehicleReg: { fontSize: 17, fontWeight: "700", color: colors.text },
  vehicleMeta: { fontSize: 13, color: colors.textMuted, marginTop: 3, fontWeight: "500" },
});
