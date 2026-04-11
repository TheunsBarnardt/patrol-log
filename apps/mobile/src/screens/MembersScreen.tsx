// FDL: blueprints/data/members-directory.blueprint.yaml

import { useEffect, useState } from "react";
import { FlatList, Linking, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../lib/api";
import { colors, spacing } from "../theme";
import type { MemberRecord } from "@patrol-log/shared";

export function MembersScreen() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<MemberRecord[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      if (q && q.length < 2) return;
      api.members(q || undefined).then((r) => setResults(r.results)).catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  async function call(member: MemberRecord) {
    await api.memberTapToCall(member.member_id).catch(() => {});
    Linking.openURL(`tel:${member.phone.replace(/\s/g, "")}`).catch(() => {});
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <TextInput style={styles.input} value={q} onChangeText={setQ} placeholder="Search by name, call sign or phone…" placeholderTextColor={colors.textMuted} />
      <FlatList
        data={results}
        keyExtractor={(m) => m.member_id}
        ItemSeparatorComponent={() => <View style={styles.divider} />}
        renderItem={({ item }) => (
          <View>
            <TouchableOpacity onPress={() => call(item)}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                <Text style={styles.cardName}>{item.call_sign}</Text>
                {item.is_on_duty && <View style={styles.badge}><Text style={styles.badgeText}>ON DUTY</Text></View>}
              </View>
              <Text style={styles.cardMeta}>{item.name}</Text>
              <Text style={styles.cardMeta}>{item.phone}</Text>
              <Text style={styles.cardMeta}>{item.address}</Text>
            </TouchableOpacity>
            {item.next_of_kin.length > 0 && (
              <TouchableOpacity onPress={() => setExpanded(expanded === item.member_id ? null : item.member_id)}>
                <Text style={{ color: colors.info, marginTop: 4 }}>
                  {expanded === item.member_id ? "Hide" : "Show"} next-of-kin ({item.next_of_kin.length})
                </Text>
              </TouchableOpacity>
            )}
            {expanded === item.member_id &&
              item.next_of_kin.map((nok, i) => (
                <TouchableOpacity
                  key={i}
                  style={styles.nokRow}
                  onPress={() => Linking.openURL(`tel:${nok.phone.replace(/\s/g, "")}`).catch(() => {})}
                >
                  <Text style={{ fontWeight: "700" }}>{nok.name} <Text style={{ color: colors.textMuted }}>({nok.relationship})</Text></Text>
                  <Text>{nok.phone}</Text>
                </TouchableOpacity>
              ))}
          </View>
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
  badge: { backgroundColor: colors.primary, paddingHorizontal: spacing.sm, borderRadius: 10 },
  badgeText: { color: "#fff", fontSize: 10, fontWeight: "800" },
  nokRow: { marginTop: spacing.xs, padding: spacing.sm, backgroundColor: colors.cardBg, borderRadius: 6 },
});
