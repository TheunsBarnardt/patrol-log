// WhatsApp-style residents directory.

import { useEffect, useState } from "react";
import { FlatList, Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FontAwesome5 } from "@expo/vector-icons";
import { api } from "../lib/api";
import { radii, spacing } from "../theme";
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
      <View style={styles.searchWrap}>
        <FontAwesome5 name="search" size={14} color="#667781" />
        <TextInput
          style={styles.searchInput}
          value={q}
          onChangeText={setQ}
          placeholder="Search name, phone or address"
          placeholderTextColor="#667781"
        />
      </View>
      <FlatList
        data={results}
        keyExtractor={(r) => r.resident_id}
        ListEmptyComponent={() => (
          <Text style={styles.empty}>
            {q.length > 0 && q.length < 2 ? "Type at least 2 characters" : "No residents found"}
          </Text>
        )}
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            onPress={() => call(item)}
          >
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{item.name.slice(0, 1).toUpperCase()}</Text>
            </View>
            <View style={styles.body}>
              <View style={styles.topLine}>
                <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                <FontAwesome5 name="phone-alt" size={14} color="#008069" solid />
              </View>
              <Text style={styles.preview} numberOfLines={1}>{item.phone}</Text>
              <Text style={styles.preview} numberOfLines={1}>{item.address}</Text>
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
    backgroundColor: "#f0f2f5",
    borderRadius: radii.xl,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  searchInput: { flex: 1, paddingVertical: 12, fontSize: 15, color: "#111b21" },
  empty: { textAlign: "center", color: "#667781", marginTop: 40, fontWeight: "500" },
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
  avatarText: { fontSize: 18, fontWeight: "700", color: "#54656f" },
  body: {
    flex: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e9edef",
    paddingBottom: 12,
  },
  topLine: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  name: { flex: 1, fontSize: 16, fontWeight: "600", color: "#111b21" },
  preview: { marginTop: 2, fontSize: 14, color: "#667781" },
});
