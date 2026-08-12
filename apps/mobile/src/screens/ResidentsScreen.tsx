// WhatsApp-style residents directory — local list first, search in memory.

import { useEffect, useMemo, useState } from "react";
import { FlatList, Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FontAwesome5 } from "@expo/vector-icons";
import { api } from "../lib/api";
import { cacheGet, cacheGetSync, cacheSet, EMPTY_CACHE_HINT } from "../lib/offlineCache";
import { useConnectivityStore } from "../lib/connectivity";
import { colors, radii, spacing } from "../theme";
import type { ResidentRecord } from "@patrol-log/shared";

export function ResidentsScreen() {
  const online = useConnectivityStore((s) => s.online);
  const [q, setQ] = useState("");
  const [list, setList] = useState<ResidentRecord[]>(
    () => cacheGetSync<ResidentRecord[]>("residents")?.data ?? [],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (list.length === 0) {
        const cached = await cacheGet<ResidentRecord[]>("residents");
        if (!cancelled && cached?.data) setList(cached.data);
      }
      if (!online) return;
      try {
        const r = await api.residents();
        if (cancelled) return;
        setList(r.results);
        await cacheSet("residents", r.results);
      } catch {
        // keep local list
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [online]);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return list;
    if (term.length < 2) return [];
    return list.filter(
      (r) =>
        r.name.toLowerCase().includes(term) ||
        r.phone.includes(term) ||
        r.address.toLowerCase().includes(term),
    );
  }, [list, q]);

  async function call(resident: ResidentRecord) {
    await api.residentTapToCall(resident.resident_id).catch(() => {});
    Linking.openURL(`tel:${resident.phone.replace(/\s/g, "")}`).catch(() => {});
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <View style={styles.searchWrap}>
        <FontAwesome5 name="search" size={14} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={q}
          onChangeText={setQ}
          placeholder="Search name, phone or address"
          placeholderTextColor={colors.textMuted}
        />
      </View>
      <FlatList
        data={results}
        keyExtractor={(r) => r.resident_id}
        initialNumToRender={24}
        windowSize={11}
        maxToRenderPerBatch={24}
        ListEmptyComponent={() => (
          <Text style={styles.empty}>
            {q.length > 0 && q.length < 2
              ? "Type at least 2 characters"
              : list.length === 0
                ? !online
                  ? EMPTY_CACHE_HINT
                  : "No residents found"
                : "No matches"}
          </Text>
        )}
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            onPress={() => void call(item)}
          >
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{item.name.slice(0, 1).toUpperCase()}</Text>
            </View>
            <View style={styles.body}>
              <View style={styles.topLine}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.name}
                </Text>
                <FontAwesome5 name="phone-alt" size={14} color={colors.primary} solid />
              </View>
              <Text style={styles.preview} numberOfLines={1}>
                {item.phone}
              </Text>
              <Text style={styles.preview} numberOfLines={1}>
                {item.address}
              </Text>
            </View>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  searchWrap: {
    marginHorizontal: spacing.md,
    marginVertical: spacing.sm,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  searchInput: { flex: 1, paddingVertical: 12, fontSize: 15, color: colors.text },
  empty: { textAlign: "center", color: colors.textMuted, marginTop: 40, fontWeight: "500" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: spacing.md,
    paddingTop: 12,
  },
  pressed: { backgroundColor: "#f5f6f6" },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#dfe5e7",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 18, fontWeight: "700", color: colors.textMuted },
  body: {
    flex: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e9edef",
    paddingBottom: 12,
  },
  topLine: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  name: { flex: 1, fontSize: 16, fontWeight: "600", color: colors.text },
  preview: { marginTop: 2, fontSize: 14, color: colors.textMuted },
});
