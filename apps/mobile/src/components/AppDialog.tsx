import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useDialogStore } from "../store/dialog";
import { colors, radii, spacing } from "../theme";

export function AppDialog() {
  const open = useDialogStore((s) => s.open);
  const title = useDialogStore((s) => s.title);
  const message = useDialogStore((s) => s.message);
  const actions = useDialogStore((s) => s.actions);
  const hide = useDialogStore((s) => s.hide);

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={hide}>
      <View style={styles.backdrop}>
        <View style={styles.sheet} accessibilityRole="alert">
          <Text style={styles.title}>{title}</Text>
          {!!message && <Text style={styles.message}>{message}</Text>}
          <View style={styles.actions}>
            {actions.map((a) => {
              const variant = a.variant ?? (actions.length === 1 ? "primary" : "ghost");
              return (
                <Pressable
                  key={a.label}
                  style={({ pressed }) => [
                    styles.btn,
                    variant === "primary" && styles.btnPrimary,
                    variant === "danger" && styles.btnDanger,
                    variant === "ghost" && styles.btnGhost,
                    pressed && styles.pressed,
                  ]}
                  onPress={() => {
                    hide();
                    a.onPress?.();
                  }}
                >
                  <Text
                    style={[
                      styles.btnText,
                      variant === "primary" && styles.btnTextPrimary,
                      variant === "danger" && styles.btnTextDanger,
                      variant === "ghost" && styles.btnTextGhost,
                    ]}
                  >
                    {a.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  sheet: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.text,
    marginBottom: spacing.sm,
  },
  message: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.textMuted,
    marginBottom: spacing.md,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  btn: {
    minWidth: 88,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radii.lg,
    alignItems: "center",
  },
  btnPrimary: { backgroundColor: colors.primary },
  btnDanger: { backgroundColor: colors.danger },
  btnGhost: {
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  btnText: { fontSize: 14, fontWeight: "700" },
  btnTextPrimary: { color: "#fff" },
  btnTextDanger: { color: "#fff" },
  btnTextGhost: { color: colors.text },
  pressed: { opacity: 0.85 },
});
