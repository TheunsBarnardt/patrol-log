import { StyleSheet, Text, View } from "react-native";
import { useConnectivityStore } from "../lib/connectivity";
import { colors, spacing } from "../theme";

export function OfflineBanner() {
  const online = useConnectivityStore((s) => s.online);
  const pending = useConnectivityStore((s) => s.pendingCount);

  if (online && pending === 0) return null;

  const text = !online
    ? pending > 0
      ? `You’re offline — showing last saved data · ${pending} waiting to sync`
      : "You’re offline — showing last saved data"
    : `${pending} action${pending === 1 ? "" : "s"} waiting to sync…`;

  return (
    <View style={[styles.banner, online ? styles.bannerPending : styles.bannerOffline]}>
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  bannerOffline: {
    backgroundColor: "#FFF8DB",
    borderBottomColor: "#E6D27A",
  },
  bannerPending: {
    backgroundColor: "#E8F1FB",
    borderBottomColor: colors.border,
  },
  text: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.text,
    textAlign: "center",
  },
});
