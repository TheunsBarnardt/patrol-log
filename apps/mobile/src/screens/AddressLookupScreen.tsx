// Search the occurrence book by address for vehicles and persons of interest.

import { useState, type ReactNode } from "react";
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
import type { AddressLookupPerson, AddressLookupResult, AddressLookupVehicle } from "@patrol-log/shared";
import { api } from "../lib/api";
import { useConnectivityStore } from "../lib/connectivity";
import { colors, radii, spacing } from "../theme";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function whenLabel(value: string): string {
  const [date, time] = value.split(" ");
  const [year, month, day] = (date ?? "").split("-");
  if (!year || !month || !day) return value;
  const clock = (time ?? "").slice(0, 5);
  return `${Number(day)} ${MONTHS[Number(month) - 1] ?? month} ${year}${clock ? `, ${clock}` : ""}`;
}

function vehicleTitle(vehicle: AddressLookupVehicle): string {
  const description = [vehicle.colour, vehicle.make, vehicle.model, vehicle.shape].filter(Boolean).join(" ");
  return [vehicle.identifier, vehicle.name, description || "Vehicle", vehicle.registration].filter(Boolean).join(" · ");
}

function personTitle(person: AddressLookupPerson): string {
  const description = [person.gender, person.clothing].filter(Boolean).join(" · ");
  return [person.identifier, person.name, description].filter(Boolean).join(" · ") || "Person of interest";
}

export function AddressLookupScreen() {
  const online = useConnectivityStore((s) => s.online);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<AddressLookupResult | null>(null);
  const [searched, setSearched] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function search() {
    const q = query.trim();
    if (q.length < 3) {
      setError("Enter a name, code, or street.");
      setResult(null);
      return;
    }
    if (!useConnectivityStore.getState().online) {
      setError("Search needs a connection.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const next = await api.lookupAddress(q);
      setResult(next);
      setSearched(q);
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : "Could not search");
    } finally {
      setBusy(false);
    }
  }

  const vehicles = result?.vehicles ?? [];
  const persons = result?.persons ?? [];
  const nothing = result != null && vehicles.length === 0 && persons.length === 0;

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.hint}>
          Search a name, code such as Whisky, registration, or address.
        </Text>
        <View style={styles.searchRow}>
          <TextInput
            style={styles.input}
            value={query}
            onChangeText={setQuery}
            placeholder="Whisky, ABC123GP, or 12 Jean Avenue"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={() => void search()}
          />
          <Pressable style={styles.searchBtn} onPress={() => void search()} disabled={busy}>
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <FontAwesome5 name="search" size={16} color="#fff" solid />
            )}
          </Pressable>
        </View>
        {!online ? <Text style={styles.error}>Search needs a connection.</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {nothing ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Nothing of interest</Text>
            <Text style={styles.emptyBody}>No vehicle or person of interest matches {searched}.</Text>
          </View>
        ) : null}

        {vehicles.length > 0 ? (
          <Section title="Vehicles of interest">
            {vehicles.map((vehicle, index) => (
              <Card
                key={`${vehicle.ob_number}-${vehicle.registration ?? index}`}
                title={vehicleTitle(vehicle)}
                detail={[vehicle.features, vehicle.last_seen ? "Last seen here" : null].filter(Boolean).join(" · ")}
                address={vehicle.address}
                meta={`${vehicle.ob_number} · ${whenLabel(vehicle.occurred_at)} · ${vehicle.status === "active" ? "Open" : "Closed"}`}
              />
            ))}
          </Section>
        ) : null}

        {persons.length > 0 ? (
          <Section title="Persons of interest">
            {persons.map((person, index) => (
              <Card
                key={`${person.ob_number}-poi-${index}`}
                title={personTitle(person)}
                detail={[person.ethnicity, person.direction ? `Heading ${person.direction}` : null, person.note, person.last_seen ? "Last seen here" : null].filter(Boolean).join(" · ")}
                address={person.address}
                meta={`${person.ob_number} · ${whenLabel(person.occurred_at)} · ${person.status === "active" ? "Open" : "Closed"}`}
              />
            ))}
          </Section>
        ) : null}

        {result && vehicles.length > 0 && persons.length === 0 ? (
          <Text style={styles.clear}>No person of interest at this address.</Text>
        ) : null}
        {result && persons.length > 0 && vehicles.length === 0 ? (
          <Text style={styles.clear}>No vehicle of interest at this address.</Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Card({ title, detail, address, meta }: { title: string; detail: string; address: string; meta: string }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {detail ? <Text style={styles.cardDetail}>{detail}</Text> : null}
      {address ? <Text style={styles.cardAddress}>{address}</Text> : null}
      <Text style={styles.cardMeta}>{meta}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xl },
  hint: { color: colors.textMuted, lineHeight: 20, marginBottom: spacing.md },
  searchRow: { flexDirection: "row", gap: 10, marginBottom: spacing.md },
  input: {
    flex: 1,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === "web" ? 14 : 12,
    fontSize: 16,
    color: colors.text,
  },
  searchBtn: {
    width: 52,
    borderRadius: radii.lg,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  error: { color: colors.danger, marginBottom: spacing.md, fontWeight: "600" },
  empty: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: colors.text, marginBottom: 4 },
  emptyBody: { color: colors.textMuted, lineHeight: 20 },
  section: { marginTop: spacing.sm, marginBottom: spacing.md },
  sectionTitle: { fontSize: 18, fontWeight: "700", color: colors.text, marginBottom: spacing.sm },
  card: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  cardTitle: { fontSize: 16, fontWeight: "700", color: colors.text },
  cardDetail: { marginTop: 4, color: colors.text, lineHeight: 20 },
  cardAddress: { marginTop: 6, color: colors.text, fontWeight: "600" },
  cardMeta: { marginTop: 4, color: colors.textMuted, fontSize: 13 },
  clear: { color: colors.textMuted, marginTop: spacing.sm },
});
