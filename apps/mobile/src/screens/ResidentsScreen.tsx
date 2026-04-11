// FDL: blueprints/data/residents-directory.blueprint.yaml

import { useEffect, useState } from "react";
import { FlatList, Linking, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../lib/api";
import { colors, spacing } from "../theme";
import type { ResidentRecord } from "@patrol-log/shared";

export function ResidentsScreen() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ResidentRecord[]>([]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (q && q.length < 2) return;
      api.residents(q || undefined).then((r) => setResults(r.results)).catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  async function call(resident: ResidentRecord) {
    await api.residentTapToCall(resident.resident_id).catch(() => {});
    Linking.openURL(`tel:${resident.phone.replace(/\s/g, "")}`).catch(() => {});
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <TextInput style={styles.input} value={q} onChangeText={setQ} placeholder="Search by name, phone or address…" placeholderTextColor={colors.textMuted} />
      <FlatList
        data={results}
        keyExtractor={(r) => r.resident_id}
        ItemSeparatorComponent={() => <View style={styles.divider} />}
        renderItem={({ item }) => (
          <TouchableOpacity onPress={() => call(item)}>
            <Text style={styles.cardName}>{item.name}</Text>
            <Text style={styles.cardMeta}>{item.phone}</Text>
            <Text style={styles.cardMeta}>{item.address}</Text>
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing.md },
  input: {
    backgroundColor: colors.cardBg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  cardName: { fontSize: 16, fontWeight: "800" },
  cardMeta: { fontSize: 14, fontWeight: "600" },
});
