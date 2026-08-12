// FDL: blueprints/workflow/stand-down-patrol.blueprint.yaml

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FontAwesome5 } from "@expo/vector-icons";
import * as Location from "expo-location";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation";
import { api } from "../lib/api";
import { notify } from "../lib/notify";
import { startHeartbeat, stopHeartbeat } from "../lib/heartbeat";
import { storage } from "../lib/storage";
import { useAuthStore } from "../store/auth";
import { colors, spacing } from "../theme";
import {
  parseSqliteUtc,
  patrolTypeRequiresVehicle,
  type ActivePatrolResponse,
  type GeoPoint,
  type MemberRecord,
} from "@patrol-log/shared";

async function cacheActivePatrol(p: ActivePatrolResponse) {
  try {
    await storage.setActivePatrolCache(JSON.stringify(p));
  } catch {}
}

async function readCachedPatrol(id: string): Promise<ActivePatrolResponse | null> {
  try {
    const raw = await storage.getActivePatrolCache();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ActivePatrolResponse;
    return parsed?.patrol_id === id ? parsed : null;
  } catch {
    return null;
  }
}

type Props = NativeStackScreenProps<RootStackParamList, "ActivePatrol">;

export function ActivePatrolScreen({ navigation, route }: Props) {
  const { patrolId } = route.params;
  const [patrol, setPatrol] = useState<ActivePatrolResponse | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [odometerEnd, setOdometerEnd] = useState("");
  const [distanceKm, setDistanceKm] = useState("");
  const [busy, setBusy] = useState(false);
  const [standingDownCallSign, setStandingDownCallSign] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [memberQuery, setMemberQuery] = useState("");
  const [memberResults, setMemberResults] = useState<MemberRecord[]>([]);
  const [addingMember, setAddingMember] = useState(false);
  const [guestDraft, setGuestDraft] = useState("");
  const [guestNote, setGuestNote] = useState("");
  const [addingGuest, setAddingGuest] = useState(false);
  const [removingGuestId, setRemovingGuestId] = useState<string | null>(null);
  const [searchFocused, setSearchFocused] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const patrolRef = useRef<ActivePatrolResponse | null>(null);
  const deviceToken = useAuthStore((s) => s.deviceToken);
  const profile = useAuthStore((s) => s.profile);
  patrolRef.current = patrol;

  const refresh = useCallback(async () => {
    try {
      const p = await api.activePatrol();
      if (p == null) {
        // Prefer in-memory / disk cache over wiping UI after midnight blips.
        if (patrolRef.current?.patrol_id === patrolId) {
          setLoadFailed(false);
          return;
        }
        const cached = await readCachedPatrol(patrolId);
        if (cached) {
          setPatrol(cached);
          setLoadFailed(false);
          return;
        }
        setPatrol(null);
        setLoadFailed(true);
        return;
      }
      if (p.patrol_id !== patrolId) {
        // On a different patrol — still show what the server says.
        setPatrol(p);
        void cacheActivePatrol(p);
        setLoadFailed(false);
        return;
      }
      setPatrol(p);
      void cacheActivePatrol(p);
      setLoadFailed(false);
    } catch (err) {
      console.warn("[active-patrol] failed to refresh", err);
      // Keep last good patrol so stand-down stays available overnight.
      if (patrolRef.current?.patrol_id === patrolId) {
        setLoadFailed(false);
        return;
      }
      const cached = await readCachedPatrol(patrolId);
      if (cached) {
        setPatrol(cached);
        setLoadFailed(false);
        return;
      }
      setLoadFailed(true);
    }
  }, [patrolId]);

  useEffect(() => {
    void (async () => {
      const cached = await readCachedPatrol(patrolId);
      if (cached && !patrolRef.current) setPatrol(cached);
      await refresh();
    })();
  }, [refresh, patrolId]);

  useEffect(() => {
    if (!deviceToken) return;
    const jti = decodeJti(deviceToken);
    if (!jti) return;
    void startHeartbeat(patrolId, jti);
  }, [patrolId, deviceToken]);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!memberQuery || memberQuery.length < 2) {
      setMemberResults([]);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      try {
        const r = await api.members(memberQuery);
        const joinedSigns = new Set((patrol?.joined_patrollers ?? []).map((j) => j.call_sign));
        setMemberResults(
          r.results.filter(
            (m) =>
              m.call_sign !== profile?.call_sign &&
              m.call_sign !== patrol?.primary_patroller_call_sign &&
              !joinedSigns.has(m.call_sign),
          ),
        );
      } catch {
        setMemberResults([]);
      }
    }, 300);
  }, [memberQuery, patrol, profile]);

  async function addPassenger(m: MemberRecord) {
    if (!patrol) return;
    setAddingMember(true);
    setError(null);
    try {
      const updated = await api.addPatrolMembers(patrol.patrol_id, { call_signs: [m.call_sign] });
      setPatrol(updated);
      setMemberQuery("");
      setMemberResults([]);
      notify("Passenger added", `${m.call_sign} joined this patrol.`);
    } catch (err: any) {
      const msg = err?.body?.message ?? err?.message ?? "Unable to add passenger.";
      setError(msg);
      notify("Could not add", msg);
    } finally {
      setAddingMember(false);
    }
  }

  async function standDownPassenger(callSign: string) {
    if (!patrol) return;
    setStandingDownCallSign(callSign);
    setError(null);
    try {
      const updated = await api.standDownMember(patrol.patrol_id, { call_sign: callSign });
      setPatrol(updated);
      notify("Passenger stood down", `${callSign} has been stood down.`);
    } catch (err: any) {
      const msg = err?.body?.message ?? err?.message ?? "Unable to stand down passenger.";
      setError(msg);
      notify("Stand down failed", msg);
    } finally {
      setStandingDownCallSign(null);
    }
  }

  async function addGuest() {
    if (!patrol) return;
    const displayName = guestDraft.trim();
    if (!displayName) return;
    setAddingGuest(true);
    setError(null);
    try {
      const note = guestNote.trim() || undefined;
      const updated = await api.addPatrolGuest(patrol.patrol_id, {
        display_name: displayName,
        note,
      });
      setPatrol(updated);
      setGuestDraft("");
      setGuestNote("");
      notify("Guest added", displayName);
    } catch (err: any) {
      const msg = err?.body?.message ?? err?.message ?? "Unable to add guest.";
      setError(msg);
      notify("Could not add guest", msg);
    } finally {
      setAddingGuest(false);
    }
  }

  async function removeGuest(guestId: string, displayName: string) {
    if (!patrol) return;
    setRemovingGuestId(guestId);
    setError(null);
    try {
      const updated = await api.removePatrolGuest(patrol.patrol_id, guestId);
      setPatrol(updated);
      notify("Guest removed", displayName);
    } catch (err: any) {
      const msg = err?.body?.message ?? err?.message ?? "Unable to remove guest.";
      setError(msg);
      notify("Could not remove guest", msg);
    } finally {
      setRemovingGuestId(null);
    }
  }

  async function standDownSelf() {
    const id = patrol?.patrol_id ?? patrolId;
    if (!id) return;

    const isPrimary = patrol?.my_role === "primary";
    const isVehicle = patrol ? patrolTypeRequiresVehicle(patrol.patrol_type) : false;
    const useOdometer = !!isPrimary && isVehicle && patrol?.odometer_start != null;
    const useDistance = !!isPrimary && isVehicle && patrol?.odometer_start == null;
    /** Offline / failed load: optional km if they were the driver. */
    const offlineDistance =
      !patrol && distanceKm.trim() !== "" ? Number(distanceKm) : NaN;

    const endOdo = odometerEnd.trim() === "" ? NaN : Number(odometerEnd);
    const dist = distanceKm.trim() === "" ? NaN : Number(distanceKm);

    if (useOdometer) {
      if (!Number.isFinite(endOdo)) {
        const msg = "Enter the end odometer reading before standing down.";
        setError(msg);
        notify("Stand down", msg);
        return;
      }
      if (patrol?.odometer_start != null && endOdo < patrol.odometer_start) {
        const msg = `End odometer must be at least ${patrol.odometer_start.toLocaleString()} km.`;
        setError(msg);
        notify("Stand down", msg);
        return;
      }
    }

    if (useDistance) {
      if (!Number.isFinite(dist) || dist < 0) {
        const msg = "Enter kilometres travelled before standing down.";
        setError(msg);
        notify("Stand down", msg);
        return;
      }
    }

    if (!patrol && distanceKm.trim() !== "" && (!Number.isFinite(offlineDistance) || offlineDistance < 0)) {
      const msg = "Enter a valid kilometres travelled, or leave blank if you were a passenger.";
      setError(msg);
      notify("Stand down", msg);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const loc = await captureGps();
      await api.standDown(id, {
        odometer_end: useOdometer ? endOdo : undefined,
        distance_km: useDistance
          ? Math.round(dist)
          : Number.isFinite(offlineDistance)
            ? Math.round(offlineDistance)
            : undefined,
        end_location: loc,
      });
      stopHeartbeat();
      await storage.clearActivePatrolCache();
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
        {loadFailed ? (
          <View style={{ padding: spacing.lg, gap: spacing.md }}>
            <Text style={styles.cardHead}>Couldn’t load patrol</Text>
            <Text style={styles.odoHintText}>
              Connection may be offline after midnight. You can still try standing down with this patrol id, or retry when you’re back online.
            </Text>
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            <Text style={[styles.cardLine, { fontWeight: "700" }]}>Km travelled (if you were the driver)</Text>
            <TextInput
              style={styles.input}
              value={distanceKm}
              onChangeText={setDistanceKm}
              placeholder="Leave blank if passenger"
              keyboardType="numeric"
            />
            <TouchableOpacity
              style={[styles.standDownPrimary, busy && { opacity: 0.6 }]}
              onPress={() => void standDownSelf()}
              disabled={busy}
            >
              <Text style={styles.standDownText}>{busy ? "Standing down…" : "Stand down anyway"}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.standDownPrimary} onPress={() => { setLoadFailed(false); void refresh(); }}>
              <Text style={styles.standDownText}>Retry load</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.standDownPrimary, { backgroundColor: colors.surfaceMuted }]}
              onPress={() => navigation.replace("Home")}
            >
              <Text style={[styles.standDownText, { color: colors.text }]}>Back to home</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
        )}
      </SafeAreaView>
    );
  }

  const isPrimary = patrol.my_role === "primary";
  const isVehicle = patrolTypeRequiresVehicle(patrol.patrol_type);
  const useOdometer = isPrimary && isVehicle && patrol.odometer_start != null;
  const useDistance = isPrimary && isVehicle && patrol.odometer_start == null;
  const activeJoined = patrol.joined_patrollers.filter((jp) => !jp.end_time);
  const guests = patrol.guests ?? [];

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled">
        <Text style={styles.section}>Patrollers</Text>
        <View style={styles.divider} />

        <View style={styles.card}>
          <Text style={styles.cardHead}>{patrol.primary_patroller_call_sign}</Text>
          <Text style={styles.cardLine}>Primary{isPrimary ? " (you)" : ""}</Text>
          <Text style={styles.cardLine}>Start Time: {formatTime(patrol.start_time)}</Text>

          {useOdometer && (
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

          {useDistance && (
            <>
              <View style={styles.odoHint}>
                <Text style={styles.odoHintText}>
                  No start odometer was recorded. Enter kilometres travelled on this patrol.
                </Text>
              </View>
              <Text style={[styles.cardLine, { marginTop: spacing.sm, fontWeight: "700" }]}>
                Km travelled
              </Text>
              <TextInput
                style={styles.input}
                value={distanceKm}
                onChangeText={(v) => { setDistanceKm(v); setError(null); }}
                placeholder="e.g. 12"
                keyboardType="numeric"
              />
            </>
          )}

          {!isPrimary && (
            <View style={styles.odoHint}>
              <Text style={styles.odoHintText}>
                You are a passenger on this patrol. Stand down when you leave — no kilometres needed.
              </Text>
            </View>
          )}

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <TouchableOpacity style={[styles.standDownPrimary, busy && { opacity: 0.6 }]} onPress={standDownSelf} disabled={busy}>
            <Text style={styles.standDownText}>{busy ? "Standing down…" : "Stand down"}</Text>
          </TouchableOpacity>
        </View>

        {isPrimary && (
          <>
            <Text style={styles.section}>Add passenger</Text>
            <View style={styles.divider} />
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
                  <Pressable
                    key={m.member_id}
                    style={[styles.resultRow, addingMember && { opacity: 0.5 }]}
                    onPress={() => void addPassenger(m)}
                    disabled={addingMember}
                  >
                    <Text style={styles.resultCs}>{m.call_sign}</Text>
                    <Text style={styles.resultName}>{m.name}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </>
        )}

        {activeJoined.length > 0 && (
          <>
            <Text style={styles.section}>Joined Patrollers</Text>
            <View style={styles.divider} />
            {activeJoined.map((jp) => (
              <View style={styles.card} key={jp.call_sign}>
                <Text style={styles.cardHead}>{jp.call_sign}</Text>
                <Text style={styles.cardLine}>{jp.name}</Text>
                <Text style={styles.cardLine}>Start Time: {formatTime(jp.start_time)}</Text>
                {isPrimary && jp.call_sign !== profile?.call_sign ? (
                  <TouchableOpacity
                    style={[styles.standDownMember, standingDownCallSign === jp.call_sign && { opacity: 0.6 }]}
                    onPress={() => void standDownPassenger(jp.call_sign)}
                    disabled={!!standingDownCallSign}
                  >
                    <Text style={styles.standDownText}>
                      {standingDownCallSign === jp.call_sign ? "Standing down…" : "Stand down passenger"}
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <View style={styles.standDownJoined}>
                    <Text style={styles.joinedHint}>
                      {jp.call_sign === profile?.call_sign
                        ? "Stand down with the button above"
                        : "(stands down from their own device)"}
                    </Text>
                  </View>
                )}
              </View>
            ))}
          </>
        )}

        {patrol.joined_patrollers.some((jp) => jp.end_time) && (
          <>
            <Text style={[styles.section, { color: colors.textMuted }]}>Stood down</Text>
            <View style={styles.divider} />
            {patrol.joined_patrollers
              .filter((jp) => jp.end_time)
              .map((jp) => (
                <View style={styles.card} key={`${jp.call_sign}-done`}>
                  <Text style={[styles.cardHead, { color: colors.textMuted }]}>{jp.call_sign}</Text>
                  <Text style={[styles.cardLine, { color: colors.textMuted }]}>
                    Stood down at {formatTime(jp.end_time!)}
                  </Text>
                </View>
              ))}
          </>
        )}

        {isPrimary && (
          <>
            <Text style={styles.section}>Add guest</Text>
            <View style={styles.divider} />
            <TextInput
              style={styles.input}
              value={guestDraft}
              onChangeText={setGuestDraft}
              placeholder="Guest name"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="words"
            />
            <TextInput
              style={[styles.input, { marginTop: 0 }]}
              value={guestNote}
              onChangeText={setGuestNote}
              placeholder="Note (optional, e.g. neighbour)"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="sentences"
            />
            <TouchableOpacity
              style={[styles.standDownMember, (!guestDraft.trim() || addingGuest) && { opacity: 0.5 }]}
              onPress={() => void addGuest()}
              disabled={!guestDraft.trim() || addingGuest}
            >
              <Text style={styles.standDownText}>{addingGuest ? "Adding…" : "Add guest"}</Text>
            </TouchableOpacity>
          </>
        )}

        {guests.length > 0 && (
          <>
            <Text style={styles.section}>Guests</Text>
            <View style={styles.divider} />
            {guests.map((g) => (
              <View style={styles.card} key={g.id}>
                <Text style={styles.cardHead}>{g.display_name}</Text>
                {g.note ? <Text style={styles.cardLine}>{g.note}</Text> : null}
                <Text style={styles.cardLine}>Added: {formatTime(g.created_at)}</Text>
                {isPrimary && (
                  <TouchableOpacity
                    style={[styles.removeGuestBtn, removingGuestId === g.id && { opacity: 0.6 }]}
                    onPress={() => void removeGuest(g.id, g.display_name)}
                    disabled={!!removingGuestId}
                  >
                    <Text style={styles.removeGuestText}>
                      {removingGuestId === g.id ? "Removing…" : "Remove guest"}
                    </Text>
                  </TouchableOpacity>
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
  const d = parseSqliteUtc(iso) ?? new Date(iso);
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
  section: { fontSize: 18, fontWeight: "700", marginTop: spacing.md },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  card: { paddingVertical: spacing.sm, marginBottom: spacing.sm },
  cardHead: { fontSize: 18, fontWeight: "800" },
  cardLine: { fontSize: 14, fontWeight: "600" },
  input: {
    backgroundColor: colors.cardBg,
    borderWidth: 1.5,
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
    marginTop: spacing.sm,
  },
  standDownJoined: {
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: spacing.md,
    borderRadius: 16,
    alignItems: "center",
    marginTop: spacing.sm,
  },
  standDownMember: {
    backgroundColor: colors.primary,
    paddingVertical: 12,
    borderRadius: 20,
    alignItems: "center",
    marginTop: spacing.sm,
  },
  standDownText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  joinedHint: { color: colors.textMuted, fontWeight: "600", fontSize: 13, textAlign: "center" },
  errorText: { color: colors.danger, fontWeight: "600", fontSize: 14, marginBottom: spacing.sm },
  odoHint: {
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 16,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  odoHintText: { color: colors.text, fontWeight: "600", fontSize: 14, lineHeight: 20 },
  searchField: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  searchInput: { flex: 1, fontSize: 16, color: colors.text, padding: 0 },
  results: {
    marginTop: spacing.sm,
    backgroundColor: colors.cardBg,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.border,
    overflow: "hidden",
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  resultCs: { fontWeight: "800", fontSize: 14, color: colors.primary, minWidth: 56 },
  resultName: { flex: 1, fontSize: 14, color: colors.text },
  removeGuestBtn: {
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingVertical: 12,
    borderRadius: 20,
    alignItems: "center",
    marginTop: spacing.sm,
  },
  removeGuestText: { color: colors.danger, fontWeight: "700", fontSize: 15 },
});
