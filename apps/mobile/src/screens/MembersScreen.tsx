// WhatsApp-style members directory (chat-list layout).

import { useEffect, useState } from "react";
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
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation";
import { api } from "../lib/api";
import { notify } from "../lib/notify";
import { useAuthStore } from "../store/auth";
import { radii, spacing } from "../theme";
import type { MemberRecord } from "@patrol-log/shared";

type Props = NativeStackScreenProps<RootStackParamList, "Members">;

export function MembersScreen({ navigation }: Props) {
  const myId = useAuthStore((s) => s.profile?.patroller_id);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<MemberRecord[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [messagingId, setMessagingId] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      if (q && q.length < 2) return;
      api.members(q || undefined).then((r) => setResults(r.results)).catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  async function call(phone: string, memberId?: string) {
    if (memberId) await api.memberTapToCall(memberId).catch(() => {});
    Linking.openURL(`tel:${phone.replace(/\s/g, "")}`).catch(() => {});
  }

  async function openChat(member: MemberRecord) {
    if (!member.member_id || member.member_id === myId || messagingId) return;
    setMessagingId(member.member_id);
    try {
      const ch = await api.openDirectChannel(member.member_id);
      navigation.navigate("Channel", {
        channelId: ch.id,
        channelName: member.call_sign || ch.name,
        kind: "chat",
        memberCount: 2,
      });
    } catch (err) {
      console.warn("[members] open chat failed", err);
      const message = err instanceof Error ? err.message : "Could not open chat";
      notify("Message", message);
    } finally {
      setMessagingId(null);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <View style={styles.searchWrap}>
        <FontAwesome5 name="search" size={14} color="#667781" />
        <TextInput
          style={styles.searchInput}
          value={q}
          onChangeText={setQ}
          placeholder="Search name or call sign"
          placeholderTextColor="#667781"
        />
      </View>

      <FlatList
        data={results}
        keyExtractor={(m) => m.member_id}
        ListEmptyComponent={() => (
          <Text style={styles.empty}>
            {q.length > 0 && q.length < 2 ? "Type at least 2 characters" : "No members found"}
          </Text>
        )}
        renderItem={({ item }) => {
          const open = expanded === item.member_id;
          const isSelf = item.member_id === myId;
          const opening = messagingId === item.member_id;
          return (
            <View>
              <View style={styles.row}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{item.call_sign.slice(0, 2)}</Text>
                  {item.is_on_duty && <View style={styles.onlineDot} />}
                </View>
                <View style={styles.body}>
                  <View style={styles.topLine}>
                    <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                    <View style={styles.actions}>
                      {!isSelf && (
                        <Pressable
                          hitSlop={10}
                          onPress={() => void openChat(item)}
                          disabled={!!messagingId}
                          style={styles.actionBtn}
                          accessibilityLabel={`Message ${item.call_sign}`}
                        >
                          {opening ? (
                            <ActivityIndicator size="small" color="#008069" />
                          ) : (
                            <FontAwesome5 name="comment" size={16} color="#008069" solid />
                          )}
                        </Pressable>
                      )}
                      <Pressable
                        hitSlop={10}
                        onPress={() => call(item.phone, item.member_id)}
                        style={styles.actionBtn}
                        accessibilityLabel={`Call ${item.call_sign}`}
                      >
                        <FontAwesome5 name="phone-alt" size={14} color="#008069" solid />
                      </Pressable>
                    </View>
                  </View>
                  <Text style={styles.preview} numberOfLines={1}>
                    {item.call_sign}
                    {item.phone ? ` · ${item.phone}` : ""}
                    {item.is_on_duty ? " · on duty" : ""}
                  </Text>
                  {item.next_of_kin.length > 0 && (
                    <Pressable
                      onPress={() => setExpanded(open ? null : item.member_id)}
                      style={styles.nokLink}
                    >
                      <Text style={styles.nokLinkText}>
                        Next of kin · {item.next_of_kin.length}
                      </Text>
                      <FontAwesome5
                        name={open ? "chevron-up" : "chevron-down"}
                        size={10}
                        color="#667781"
                      />
                    </Pressable>
                  )}
                </View>
              </View>

              {open &&
                item.next_of_kin.map((nok, i) => (
                  <Pressable
                    key={`${item.member_id}-${i}`}
                    style={styles.nokRow}
                    onPress={() => call(nok.phone)}
                  >
                    <View style={styles.nokAvatar}>
                      <FontAwesome5 name="user" size={12} color="#54656f" solid />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.nokName}>{nok.name}</Text>
                      <Text style={styles.preview}>{nok.relationship} · {nok.phone}</Text>
                    </View>
                    <FontAwesome5 name="phone-alt" size={13} color="#008069" solid />
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
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#dfe5e7",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 14, fontWeight: "700", color: "#54656f" },
  onlineDot: {
    position: "absolute",
    right: 2,
    bottom: 2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#25d366",
    borderWidth: 2,
    borderColor: "#fff",
  },
  body: {
    flex: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e9edef",
    paddingBottom: 12,
  },
  topLine: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  name: { flex: 1, fontSize: 16, fontWeight: "600", color: "#111b21" },
  actions: { flexDirection: "row", alignItems: "center", gap: 4 },
  actionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  preview: { marginTop: 3, fontSize: 14, color: "#667781" },
  nokLink: {
    marginTop: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  nokLinkText: { fontSize: 12.5, fontWeight: "600", color: "#667781" },
  nokRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingLeft: 80,
    paddingRight: spacing.md,
    paddingVertical: 10,
    backgroundColor: "#fafafa",
  },
  nokAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#dfe5e7",
    alignItems: "center",
    justifyContent: "center",
  },
  nokName: { fontSize: 14, fontWeight: "600", color: "#111b21" },
});
