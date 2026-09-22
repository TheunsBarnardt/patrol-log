// Short occurrence-book capture for patrollers (OB-BOOK-SPEC-001 v1.3 §15).

import { useEffect, useMemo, useState } from "react";
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
import * as Location from "expo-location";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation";
import { api } from "../lib/api";
import { isNetworkError, useConnectivityStore } from "../lib/connectivity";
import { cacheGet, cacheSet } from "../lib/offlineCache";
import { enqueueIncident } from "../lib/outbox";
import { notify } from "../lib/notify";
import { colors, radii, spacing } from "../theme";
import {
  OB_CATEGORIES,
  dangerForTypes,
  dangerMeta,
  obType,
  obTypesFor,
  requiresAttendance,
  type CreateIncidentRequest,
  type ObAttendance,
  type ObCategory,
  type ObPhase,
} from "@patrol-log/shared";

type Props = NativeStackScreenProps<RootStackParamList, "LogIncident">;
type Suburb = { id: string; name: string; aliases: string[] };

function nowParts(): { date: string; time: string } {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

export function LogIncidentScreen({ navigation }: Props) {
  const clock = nowParts();
  const [category, setCategory] = useState<ObCategory>("criminal");
  const [typeKey, setTypeKey] = useState("");
  const [typeQuery, setTypeQuery] = useState("");
  const [phase, setPhase] = useState<"" | ObPhase>("");
  const [date, setDate] = useState(clock.date);
  const [time, setTime] = useState(clock.time);
  const [suburbs, setSuburbs] = useState<Suburb[]>([]);
  const [suburbId, setSuburbId] = useState("");
  const [street, setStreet] = useState("");
  const [description, setDescription] = useState("");
  const [attendance, setAttendance] = useState<ObAttendance>("present");
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [locLabel, setLocLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [typeOpen, setTypeOpen] = useState(true);
  const [suburbOpen, setSuburbOpen] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const id = "ob-log-placeholder";
    if (document.getElementById(id)) return;
    const el = document.createElement("style");
    el.id = id;
    el.textContent = `input::placeholder,textarea::placeholder{font-weight:400;color:${colors.textMuted}}`;
    document.head.appendChild(el);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cached = await cacheGet<Suburb[]>("obSuburbs");
      if (!cancelled && cached?.data?.length) setSuburbs(cached.data);
      if (!useConnectivityStore.getState().online) return;
      try {
        const meta = await api.obMeta();
        if (cancelled) return;
        setSuburbs(meta.suburbs);
        await cacheSet("obSuburbs", meta.suburbs);
      } catch {
        /* keep cache */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const types = useMemo(() => {
    const q = typeQuery.trim().toLowerCase();
    return obTypesFor(category).filter((t) => {
      if (!q) return true;
      return t.name.toLowerCase().includes(q) || (t.code ?? "").toLowerCase().includes(q);
    });
  }, [category, typeQuery]);

  const mustAttend = requiresAttendance(category, typeKey ? [typeKey] : []);
  const danger = category === "criminal" && phase && typeKey ? dangerForTypes([typeKey], phase) : null;
  const dangerInfo = dangerMeta(danger);

  async function useGps() {
    setFormError(null);
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== "granted") {
      setFormError("Location permission is needed to drop a pin.");
      return;
    }
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    setLat(pos.coords.latitude);
    setLng(pos.coords.longitude);
    setLocLabel(`${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`);
  }

  function body(): CreateIncidentRequest {
    return {
      category,
      type_keys: [typeKey],
      phase: category === "criminal" ? phase || null : null,
      date,
      time,
      suburb_id: suburbId,
      street: street.trim(),
      lat,
      lng,
      description: description.trim(),
      attendance: mustAttend ? attendance : attendance,
      received_from: ["CPF Member / Patroller"],
    };
  }

  async function submit() {
    setFormError(null);
    if (!typeKey) {
      setFormError("Choose the type of incident.");
      return;
    }
    if (category === "criminal" && !phase) {
      setFormError("Choose Alpha (still happening) or Bravo (already over).");
      return;
    }
    if (!suburbId) {
      setFormError("Choose a suburb.");
      return;
    }
    if (!description.trim()) {
      setFormError("Write a short description.");
      return;
    }
    if (mustAttend && attendance === "not_present") {
      setFormError("Emergencies and by-law are only logged if you were present or assisting.");
      return;
    }

    const payload = body();
    setBusy(true);
    try {
      const offline = !useConnectivityStore.getState().online;
      if (offline) {
        await enqueueIncident(payload);
        notify("Saved offline", "The incident will go into the book when you have signal.");
        navigation.goBack();
        return;
      }
      try {
        const res = await api.createIncident(payload);
        const warn = res.dangerLevel === "leave_to_police" ? " Leave it to police." : "";
        notify("Incident logged", `${res.obNumber} is in the book.${warn}`);
        navigation.goBack();
      } catch (err: any) {
        if (isNetworkError(err)) {
          await enqueueIncident(payload);
          notify("Saved offline", "The incident will go into the book when you have signal.");
          navigation.goBack();
          return;
        }
        const msg = err?.body?.message ?? err?.message ?? "Could not log the incident.";
        setFormError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.hint}>
          Your call sign and sector are filled in. This does not end a patrol. Photos can be added from the office book for now.
        </Text>

        <Text style={styles.label}>Category</Text>
        <View style={styles.chips}>
          {OB_CATEGORIES.map((c) => {
            const on = category === c.key;
            return (
              <Pressable
                key={c.key}
                style={[styles.chip, on && styles.chipOn]}
                onPress={() => {
                  setCategory(c.key);
                  setTypeKey("");
                  setPhase("");
                  setTypeQuery("");
                  setTypeOpen(true);
                }}
              >
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{c.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.label}>Type</Text>
        {Platform.OS === "web" ? (
          <>
            <input
              placeholder="Search name or code"
              value={typeQuery}
              onChange={(e: any) => setTypeQuery(e.target.value)}
              style={webFieldStyle}
            />
            <select value={typeKey} onChange={(e: any) => setTypeKey(e.target.value)} style={webFieldStyle}>
              <option value="">Choose a type</option>
              {(typeKey && !types.some((t) => t.key === typeKey) && obType(typeKey) ? [obType(typeKey)!, ...types] : types).map((t) => (
                <option key={t.key} value={t.key}>
                  {t.name}
                  {t.code ? ` (${t.code})` : ""}
                </option>
              ))}
            </select>
          </>
        ) : typeKey && !typeOpen ? (
          <Pressable style={styles.chosen} onPress={() => setTypeOpen(true)}>
            <Text style={styles.chosenText}>
              {(() => {
                const picked = obType(typeKey);
                return picked ? `${picked.name}${picked.code ? ` (${picked.code})` : ""}` : "Type";
              })()}
            </Text>
            <Text style={styles.change}>Change</Text>
          </Pressable>
        ) : (
          <>
            <TextInput
              style={styles.input}
              value={typeQuery}
              onChangeText={setTypeQuery}
              placeholder="Search name or code"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
            />
            <ScrollView style={styles.menu} nestedScrollEnabled keyboardShouldPersistTaps="handled">
              {types.map((t) => (
                <Pressable
                  key={t.key}
                  style={styles.typeRow}
                  onPress={() => {
                    setTypeKey(t.key);
                    setTypeOpen(false);
                  }}
                >
                  <Text style={styles.typeName}>
                    {t.name}
                    {t.code ? ` (${t.code})` : ""}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </>
        )}

        {category === "criminal" && (
          <>
            <Text style={styles.label}>Still happening?</Text>
            <View style={styles.chips}>
              <Pressable style={[styles.chip, phase === "alpha" && styles.chipOn]} onPress={() => setPhase("alpha")}>
                <Text style={[styles.chipText, phase === "alpha" && styles.chipTextOn]}>Alpha — now</Text>
              </Pressable>
              <Pressable style={[styles.chip, phase === "bravo" && styles.chipOn]} onPress={() => setPhase("bravo")}>
                <Text style={[styles.chipText, phase === "bravo" && styles.chipTextOn]}>Bravo — over</Text>
              </Pressable>
            </View>
          </>
        )}

        {dangerInfo && (
          <View
            style={[
              styles.danger,
              danger === "leave_to_police" && { backgroundColor: colors.dangerSoft },
              danger === "caution" && { backgroundColor: colors.warningSoft },
              danger === "respond" && { backgroundColor: colors.successSoft },
            ]}
          >
            <Text style={styles.dangerTitle}>{dangerInfo.label}</Text>
            <Text style={styles.dangerBody}>{dangerInfo.instruction}</Text>
          </View>
        )}

        <Text style={styles.label}>When</Text>
        <View style={styles.when}>
          {Platform.OS === "web" ? (
            <>
              <input type="date" value={date} onChange={(e: any) => setDate(e.target.value)} style={webInputStyle} />
              <input type="time" value={time} onChange={(e: any) => setTime(e.target.value)} style={webInputStyle} />
            </>
          ) : (
            <>
              <TextInput style={[styles.input, styles.whenField]} value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" placeholderTextColor={colors.textMuted} />
              <TextInput style={[styles.input, styles.whenField]} value={time} onChangeText={setTime} placeholder="HH:MM" placeholderTextColor={colors.textMuted} />
            </>
          )}
        </View>

        <Text style={styles.label}>Suburb</Text>
        {suburbs.length === 0 ? (
          <Text style={styles.muted}>Suburb list isn’t on this phone yet. Open this screen once while online.</Text>
        ) : Platform.OS === "web" ? (
          <select value={suburbId} onChange={(e: any) => setSuburbId(e.target.value)} style={webFieldStyle}>
            <option value="">Choose a suburb</option>
            {suburbs.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        ) : suburbId && !suburbOpen ? (
          <Pressable style={styles.chosen} onPress={() => setSuburbOpen(true)}>
            <Text style={styles.chosenText}>{suburbs.find((s) => s.id === suburbId)?.name}</Text>
            <Text style={styles.change}>Change</Text>
          </Pressable>
        ) : (
          <ScrollView style={styles.menu} nestedScrollEnabled keyboardShouldPersistTaps="handled">
            {suburbs.map((s) => (
              <Pressable
                key={s.id}
                style={styles.typeRow}
                onPress={() => {
                  setSuburbId(s.id);
                  setSuburbOpen(false);
                }}
              >
                <Text style={styles.typeName}>{s.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}

        <Text style={styles.label}>Street number and name / complex</Text>
        <TextInput style={styles.input} value={street} onChangeText={setStreet} placeholder="12 Myrdal Rd" placeholderTextColor={colors.textMuted} />

        <Pressable style={styles.gps} onPress={() => void useGps()}>
          <Text style={styles.gpsText}>{locLabel ? `Pin set · ${locLabel}` : "Use my location"}</Text>
        </Pressable>

        {mustAttend && (
          <>
            <Text style={styles.label}>Were you there?</Text>
            <View style={styles.chips}>
              <Pressable style={[styles.chip, attendance === "present" && styles.chipOn]} onPress={() => setAttendance("present")}>
                <Text style={[styles.chipText, attendance === "present" && styles.chipTextOn]}>Present</Text>
              </Pressable>
              <Pressable style={[styles.chip, attendance === "assisting" && styles.chipOn]} onPress={() => setAttendance("assisting")}>
                <Text style={[styles.chipText, attendance === "assisting" && styles.chipTextOn]}>Assisting</Text>
              </Pressable>
            </View>
          </>
        )}

        <Text style={styles.label}>What happened</Text>
        <TextInput
          style={[styles.input, styles.notes]}
          value={description}
          onChangeText={setDescription}
          placeholder="Short description"
          placeholderTextColor={colors.textMuted}
          multiline
        />

        {formError ? <Text style={styles.error}>{formError}</Text> : null}

        <Pressable
          style={({ pressed }) => [styles.submit, busy && { opacity: 0.6 }, pressed && !busy && { opacity: 0.88 }]}
          onPress={() => void submit()}
          disabled={busy}
        >
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Save to the book</Text>}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const webFieldStyle: Record<string, string | number> = {
  width: "100%",
  boxSizing: "border-box",
  backgroundColor: colors.surfaceMuted,
  borderWidth: 1.5,
  borderStyle: "solid",
  borderColor: colors.border,
  borderRadius: radii.lg,
  padding: 14,
  fontSize: 16,
  fontWeight: "400",
  color: colors.text,
  marginBottom: 12,
};

const webInputStyle: Record<string, string | number> = {
  ...webFieldStyle,
  flex: 1,
  width: "auto",
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xl },
  hint: { color: colors.textMuted, marginBottom: spacing.md, lineHeight: 20 },
  label: { fontSize: 13, fontWeight: "700", color: colors.textMuted, marginBottom: spacing.sm, marginTop: spacing.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: spacing.sm },
  chip: {
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontWeight: "700", color: colors.text },
  chipTextOn: { color: "#fff" },
  input: {
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.md,
    fontSize: 16,
    fontWeight: "400",
    color: colors.text,
    marginBottom: spacing.sm,
  },
  notes: { minHeight: 96, textAlignVertical: "top" },
  menu: {
    maxHeight: 220,
    marginBottom: spacing.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.lg,
    backgroundColor: colors.bg,
    overflow: "hidden",
  },
  typeRow: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
    backgroundColor: colors.bg,
  },
  typeName: { fontSize: 15, color: colors.text },
  chosen: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  chosenText: { flex: 1, fontSize: 16, fontWeight: "700", color: colors.text, marginRight: spacing.sm },
  change: { color: colors.primary, fontWeight: "800" },
  when: { flexDirection: "row", gap: 8 },
  whenField: { flex: 1 },
  danger: { borderRadius: radii.lg, padding: spacing.md, marginBottom: spacing.sm },
  dangerTitle: { fontWeight: "800", marginBottom: 4, color: colors.text },
  dangerBody: { color: colors.text, lineHeight: 20 },
  muted: { color: colors.textMuted, marginBottom: spacing.sm },
  gps: { marginBottom: spacing.sm },
  gpsText: { color: colors.primary, fontWeight: "800" },
  error: { color: colors.danger, fontWeight: "600", marginVertical: spacing.sm },
  submit: {
    marginTop: spacing.lg,
    backgroundColor: colors.primary,
    borderRadius: radii.lg,
    paddingVertical: 16,
    alignItems: "center",
  },
  submitText: { color: "#fff", fontWeight: "800", fontSize: 16 },
});
