// WhatsApp-style new group: pick members, then name the group.

import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FontAwesome5 } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation";
import { api } from "../lib/api";
import { notify } from "../lib/notify";
import { useAuthStore } from "../store/auth";
import { colors, radii, spacing } from "../theme";
import type { MemberRecord } from "@patrol-log/shared";

type Props = NativeStackScreenProps<RootStackParamList, "NewGroup">;

export function NewGroupScreen({ navigation }: Props) {
  const myId = useAuthStore((s) => s.profile?.patroller_id);
  const [step, setStep] = useState<"members" | "name">("members");
  const [q, setQ] = useState("");
  const [members, setMembers] = useState<MemberRecord[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [groupName, setGroupName] = useState("");
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => {
      api
        .members(q.length >= 2 ? q : undefined)
        .then((r) => setMembers(r.results.filter((m) => m.member_id !== myId)))
        .catch(() => setMembers([]))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [q, myId]);

  const selectedMembers = useMemo(
    () => members.filter((m) => selected.has(m.member_id)),
    [members, selected],
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function create() {
    const name = groupName.trim();
    if (!name || selected.size < 1 || creating) return;
    setCreating(true);
    try {
      const ch = await api.createGroup({ name, member_ids: [...selected] });
      navigation.replace("Channel", { channelId: ch.id, channelName: ch.name });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not create group";
      notify("New group", message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      {step === "members" ? (
        <>
          <View style={styles.searchWrap}>
            <FontAwesome5 name="search" size={14} color={colors.textMuted} />
            <TextInput
              style={styles.searchInput}
              value={q}
              onChangeText={setQ}
              placeholder="Search members"
              placeholderTextColor={colors.textMuted}
            />
          </View>
          {selected.size > 0 && (
            <Text style={styles.selectedCount}>{selected.size} selected</Text>
          )}
          {loading ? (
            <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
          ) : (
            <FlatList
              data={members}
              keyExtractor={(m) => m.member_id}
              renderItem={({ item }) => {
                const on = selected.has(item.member_id);
                return (
                  <Pressable style={styles.row} onPress={() => toggle(item.member_id)}>
                    <View style={[styles.check, on && styles.checkOn]}>
                      {on && <FontAwesome5 name="check" size={12} color="#fff" />}
                    </View>
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>{item.call_sign.slice(0, 2)}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name}>{item.name}</Text>
                      <Text style={styles.sub}>{item.call_sign}</Text>
                    </View>
                  </Pressable>
                );
              }}
            />
          )}
          <Pressable
            style={[styles.fab, selected.size < 1 && styles.fabDisabled]}
            disabled={selected.size < 1}
            onPress={() => setStep("name")}
          >
            <FontAwesome5 name="arrow-right" size={16} color="#fff" />
          </Pressable>
        </>
      ) : (
        <View style={styles.nameStep}>
          <View style={styles.groupAvatar}>
            <FontAwesome5 name="users" size={22} color={colors.textMuted} solid />
          </View>
          <TextInput
            style={styles.nameInput}
            value={groupName}
            onChangeText={setGroupName}
            placeholder="Group subject"
            placeholderTextColor={colors.textMuted}
            autoFocus
            maxLength={60}
          />
          <Text style={styles.hint}>
            {selectedMembers.length} participant{selectedMembers.length === 1 ? "" : "s"}
            {selectedMembers.length ? `: ${selectedMembers.map((m) => m.call_sign).join(", ")}` : ""}
          </Text>
          <View style={styles.nameActions}>
            <Pressable style={styles.secondaryBtn} onPress={() => setStep("members")}>
              <Text style={styles.secondaryText}>Back</Text>
            </Pressable>
            <Pressable
              style={[styles.primaryBtn, (!groupName.trim() || creating) && styles.fabDisabled]}
              disabled={!groupName.trim() || creating}
              onPress={() => void create()}
            >
              {creating ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryText}>Create</Text>
              )}
            </Pressable>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  searchWrap: {
    marginHorizontal: spacing.md,
    marginVertical: spacing.sm,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.xl,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: 14,
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  searchInput: { flex: 1, fontSize: 15, color: colors.text, paddingVertical: 10 },
  selectedCount: {
    paddingHorizontal: spacing.md,
    paddingBottom: 8,
    fontSize: 13,
    fontWeight: "600",
    color: colors.primary,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: "#8696a0",
    alignItems: "center",
    justifyContent: "center",
  },
  checkOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#dfe5e7",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 14, fontWeight: "700", color: colors.textMuted },
  name: { fontSize: 16, fontWeight: "600", color: colors.text },
  sub: { marginTop: 2, fontSize: 13, color: colors.textMuted },
  fab: {
    position: "absolute",
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    elevation: 3,
  },
  fabDisabled: { opacity: 0.4 },
  nameStep: { flex: 1, padding: spacing.lg, alignItems: "center" },
  groupAvatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#dfe5e7",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  nameInput: {
    alignSelf: "stretch",
    borderBottomWidth: 2,
    borderBottomColor: colors.primary,
    fontSize: 17,
    color: colors.text,
    paddingVertical: 10,
  },
  hint: { alignSelf: "stretch", marginTop: 12, fontSize: 13, color: colors.textMuted, lineHeight: 18 },
  nameActions: { marginTop: 28, flexDirection: "row", gap: 12, alignSelf: "stretch" },
  secondaryBtn: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryText: { fontWeight: "600", color: colors.text },
  primaryBtn: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: { fontWeight: "700", color: "#fff" },
});
