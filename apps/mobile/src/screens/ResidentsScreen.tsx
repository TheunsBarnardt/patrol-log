// WhatsApp-style residents directory — local list first, paged from the API, A–Z.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FontAwesome5 } from "@expo/vector-icons";
import { api } from "../lib/api";
import { cacheGet, cacheGetSync, cacheSet, EMPTY_CACHE_HINT } from "../lib/offlineCache";
import { useConnectivityStore } from "../lib/connectivity";
import { colors, radii, spacing } from "../theme";
import type { ResidentRecord } from "@patrol-log/shared";

const PAGE_SIZE = 50;

function byName(a: ResidentRecord, b: ResidentRecord) {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

function mergeById(existing: ResidentRecord[], incoming: ResidentRecord[]): ResidentRecord[] {
  const map = new Map(existing.map((r) => [r.resident_id, r]));
  for (const r of incoming) map.set(r.resident_id, r);
  return [...map.values()].sort(byName);
}

export function ResidentsScreen() {
  const online = useConnectivityStore((s) => s.online);
  const [q, setQ] = useState("");
  const [catalog, setCatalog] = useState<ResidentRecord[]>(
    () => [...(cacheGetSync<ResidentRecord[]>("residents")?.data ?? [])].sort(byName),
  );
  const [searchHits, setSearchHits] = useState<ResidentRecord[] | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [searchHasMore, setSearchHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const nextOffset = useRef(0);
  const searchOffset = useRef(0);
  const searchGen = useRef(0);

  const loadCatalog = useCallback(
    async (offset: number, append: boolean) => {
      if (!online) return;
      const r = await api.residents(undefined, { offset, limit: PAGE_SIZE });
      const page = [...r.results].sort(byName);
      setCatalog((prev) => {
        const next = append ? mergeById(prev, page) : page;
        void cacheSet("residents", next);
        return next;
      });
      nextOffset.current = r.next_offset ?? offset + page.length;
      setHasMore(!!r.has_more);
    },
    [online],
  );

  const loadSearch = useCallback(
    async (term: string, offset: number, append: boolean, gen: number) => {
      if (!online) return;
      const r = await api.residents(term, { offset, limit: PAGE_SIZE });
      if (searchGen.current !== gen) return;
      const page = [...r.results].sort(byName);
      setSearchHits((prev) => (append && prev ? mergeById(prev, page) : page));
      searchOffset.current = r.next_offset ?? offset + page.length;
      setSearchHasMore(!!r.has_more);
    },
    [online],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (catalog.length === 0) {
        const cached = await cacheGet<ResidentRecord[]>("residents");
        if (!cancelled && cached?.data) setCatalog([...cached.data].sort(byName));
      }
      if (!online) return;
      try {
        await loadCatalog(0, false);
      } catch {
        // keep local list
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [online]);

  useEffect(() => {
    const term = q.trim();
    if (term.length === 0) {
      setSearchHits(null);
      setSearchHasMore(false);
      return;
    }
    if (term.length < 2) {
      setSearchHits([]);
      setSearchHasMore(false);
      return;
    }
    const gen = ++searchGen.current;
    const t = setTimeout(() => {
      void loadSearch(term, 0, false, gen).catch(() => {
        if (searchGen.current === gen) setSearchHits([]);
      });
    }, 300);
    return () => clearTimeout(t);
  }, [q, loadSearch]);

  const term = q.trim();
  const searching = term.length > 0;
  const results = useMemo(() => {
    if (!searching) return catalog;
    return searchHits ?? [];
  }, [searching, catalog, searchHits]);

  const canLoadMore = searching ? searchHasMore : hasMore;

  async function loadMore() {
    if (loadingMore || !canLoadMore || !online) return;
    setLoadingMore(true);
    try {
      if (searching && term.length >= 2) {
        await loadSearch(term, searchOffset.current, true, searchGen.current);
      } else if (!searching) {
        await loadCatalog(nextOffset.current, true);
      }
    } catch {
      /* keep what we have */
    } finally {
      setLoadingMore(false);
    }
  }

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
            {term.length > 0 && term.length < 2
              ? "Type at least 2 characters"
              : catalog.length === 0
                ? !online
                  ? EMPTY_CACHE_HINT
                  : "No residents found"
                : "No matches"}
          </Text>
        )}
        ListFooterComponent={
          canLoadMore && term.length !== 1 ? (
            <Pressable
              style={({ pressed }) => [styles.loadMore, pressed && styles.loadMorePressed]}
              onPress={() => void loadMore()}
              disabled={loadingMore}
            >
              {loadingMore ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Text style={styles.loadMoreText}>Load more</Text>
              )}
            </Pressable>
          ) : null
        }
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
  loadMore: {
    marginHorizontal: spacing.md,
    marginVertical: spacing.md,
    paddingVertical: 12,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
  },
  loadMorePressed: { opacity: 0.7 },
  loadMoreText: { fontSize: 15, fontWeight: "700", color: colors.primary },
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
