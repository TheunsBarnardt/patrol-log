// FDL: blueprints/data/emergency-contacts-directory.blueprint.yaml

import { useEffect, useMemo, useState } from "react";
import { FlatList, Linking, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../lib/api";
import { colors, spacing } from "../theme";
import type { EmergencyServiceRecord } from "@patrol-log/shared";

export function EmergencyContactsScreen() {
  const [results, setResults] = useState<EmergencyServiceRecord[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    api.emergencyContacts().then((r) => setResults(r.results)).catch(() => setResults([]));
  }, []);

  const filtered = useMemo(() => {
    const term = q.toLowerCase().trim();
    if (!term) return results;
    return results.filter(
      (s) =>
        s.name.toLowerCase().includes(term) ||
        s.service_type.toLowerCase().includes(term) ||
        s.primary_number.includes(term),
    );
  }, [results, q]);

  async function call(service: EmergencyServiceRecord, num: string) {
    await api.emergencyTapToCall(service.service_id).catch(() => {});
    Linking.openURL(`tel:${num.replace(/\s/g, "")}`).catch(() => {});
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      {/* Search bar */}
      <View style={styles.searchWrap}>
        <TextInput
          style={styles.input}
          value={q}
          onChangeText={setQ}
          placeholder="Search by name, type or number…"
          placeholderTextColor={colors.textMuted}
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(s) => s.service_id}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={styles.divider} />}
        ListEmptyComponent={() => (
          <Text style={styles.empty}>{results.length === 0 ? "Loading…" : "No results"}</Text>
        )}
        renderItem={({ item }) => {
          const stale = Date.now() - new Date(item.verified_at).getTime() > 90 * 24 * 60 * 60 * 1000;
          return (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardName}>{item.name}</Text>
                  <Text style={styles.cardType}>{item.service_type.replace(/_/g, " ")}</Text>
                </View>
                {stale && (
                  <View style={styles.staleBadge}>
                    <Text style={styles.staleText}>⚠ Unverified</Text>
                  </View>
                )}
              </View>
              <TouchableOpacity style={[styles.callBtn, { backgroundColor: colors.danger }]} onPress={() => call(item, item.primary_number)}>
                <Text style={styles.callText}>📞 {item.primary_number}</Text>
              </TouchableOpacity>
              {item.secondary_number && (
                <TouchableOpacity style={[styles.callBtn, { backgroundColor: colors.info }]} onPress={() => call(item, item.secondary_number!)}>
                  <Text style={styles.callText}>📞 {item.secondary_number}</Text>
                </TouchableOpacity>
              )}
              {item.address && <Text style={styles.cardMeta}>📍 {item.address}</Text>}
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  searchWrap: { padding: spacing.md, paddingBottom: spacing.sm },
  input: {
    backgroundColor: colors.cardBg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: spacing.md,
    fontSize: 15,
  },
  list: { padding: spacing.md, paddingTop: 0 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  empty: { textAlign: "center", color: colors.textMuted, marginTop: spacing.xl },
  card: { paddingVertical: spacing.sm },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", marginBottom: spacing.sm },
  cardName: { fontSize: 16, fontWeight: "800" },
  cardType: { fontSize: 12, fontWeight: "700", color: colors.textMuted, textTransform: "uppercase", marginTop: 2 },
  staleBadge: { backgroundColor: "#FEF3C7", borderRadius: 6, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  staleText: { fontSize: 10, fontWeight: "700", color: "#92400E" },
  cardMeta: { fontSize: 13, color: colors.textMuted, marginTop: spacing.xs },
  callBtn: {
    padding: spacing.sm + 2,
    borderRadius: 8,
    alignItems: "center",
    marginTop: spacing.xs,
  },
  callText: { color: "#fff", fontWeight: "700", fontSize: 14 },
});
