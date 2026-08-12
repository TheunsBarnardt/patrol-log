// FDL: blueprints/data/emergency-contacts-directory.blueprint.yaml

import { useEffect, useMemo, useState } from "react";
import { FlatList, Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FontAwesome5 } from "@expo/vector-icons";
import { api } from "../lib/api";
import { cacheGet, cacheSet, EMPTY_CACHE_HINT } from "../lib/offlineCache";
import { useConnectivityStore } from "../lib/connectivity";
import { colors, radii, spacing } from "../theme";
import { parseSqliteUtc, type EmergencyServiceRecord } from "@patrol-log/shared";

function formatType(type: string) {
  return type.replace(/_/g, " ");
}

export function EmergencyContactsScreen() {
  const [results, setResults] = useState<EmergencyServiceRecord[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const online = useConnectivityStore((s) => s.online);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cached = await cacheGet<EmergencyServiceRecord[]>("emergency");
      if (!cancelled && cached?.data) {
        setResults(cached.data);
        setLoading(false);
      }
      if (!online) {
        if (!cancelled) setLoading(false);
        return;
      }
      try {
        const r = await api.emergencyContacts();
        if (cancelled) return;
        setResults(r.results);
        await cacheSet("emergency", r.results);
      } catch {
        if (!cancelled && !cached?.data) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [online]);

  const filtered = useMemo(() => {
    const term = q.toLowerCase().trim();
    if (!term) return results;
    return results.filter(
      (s) =>
        s.name.toLowerCase().includes(term) ||
        s.service_type.toLowerCase().includes(term) ||
        s.primary_number.includes(term) ||
        (s.secondary_number?.includes(term) ?? false),
    );
  }, [results, q]);

  async function call(service: EmergencyServiceRecord, num: string) {
    await api.emergencyTapToCall(service.service_id).catch(() => {});
    Linking.openURL(`tel:${num.replace(/\s/g, "")}`).catch(() => {});
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <View style={styles.searchWrap}>
        <FontAwesome5 name="search" size={14} color={colors.textMuted} />
        <TextInput
          style={styles.input}
          value={q}
          onChangeText={setQ}
          placeholder="Search contacts"
          placeholderTextColor={colors.textMuted}
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(s) => s.service_id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={() => (
          <Text style={styles.empty}>
            {loading
              ? "Loading…"
              : !online && results.length === 0
                ? EMPTY_CACHE_HINT
                : "No contacts found"}
          </Text>
        )}
        renderItem={({ item }) => {
          const verifiedAt = parseSqliteUtc(item.verified_at)?.getTime() ?? new Date(item.verified_at).getTime();
          const stale = Date.now() - verifiedAt > 90 * 24 * 60 * 60 * 1000;
          const numbers = [
            { label: "Primary", num: item.primary_number },
            ...(item.secondary_number ? [{ label: "Secondary", num: item.secondary_number }] : []),
          ];

          return (
            <View style={styles.card}>
              <View style={styles.cardTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{item.name}</Text>
                  <Text style={styles.type}>{formatType(item.service_type)}</Text>
                  {stale && <Text style={styles.stale}>Needs re-verification</Text>}
                  {!!item.address && <Text style={styles.address}>{item.address}</Text>}
                </View>
              </View>

              {numbers.map((n) => (
                <Pressable
                  key={n.num}
                  style={({ pressed }) => [styles.callRow, pressed && styles.pressed]}
                  onPress={() => call(item, n.num)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.callLabel}>{n.label}</Text>
                    <Text style={styles.callNumber}>{n.num}</Text>
                  </View>
                  <View style={styles.callBtn}>
                    <FontAwesome5 name="phone-alt" size={14} color="#fff" solid />
                  </View>
                </Pressable>
              ))}
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  searchWrap: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  input: {
    flex: 1,
    paddingVertical: 16,
    fontSize: 16,
    fontWeight: "500",
    color: colors.text,
  },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, gap: 12 },
  empty: { textAlign: "center", color: colors.textMuted, marginTop: spacing.xl, fontWeight: "500" },

  card: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: 18,
    gap: 10,
  },
  cardTop: { marginBottom: 4 },
  name: { fontSize: 17, fontWeight: "700", color: colors.text, letterSpacing: -0.2 },
  type: {
    fontSize: 13,
    fontWeight: "500",
    color: colors.textMuted,
    marginTop: 4,
    textTransform: "capitalize",
  },
  stale: { fontSize: 12, fontWeight: "600", color: colors.textMuted, marginTop: 6 },
  address: { fontSize: 13, color: colors.textMuted, marginTop: 6, fontWeight: "500" },

  callRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.bg,
    borderRadius: radii.lg,
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 12,
  },
  callLabel: { fontSize: 12, fontWeight: "600", color: colors.textMuted },
  callNumber: { fontSize: 16, fontWeight: "700", color: colors.text, marginTop: 2 },
  callBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { opacity: 0.88 },
});
