import { useState } from "react";
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { api } from "../lib/api";
import { getApiBaseUrl } from "../config";
import { notify } from "../lib/notify";
import { useAuthStore } from "../store/auth";
import { colors, radii, spacing } from "../theme";
import { APP_NAME, APP_VERSION } from "../version";

interface Props {
  visible: boolean;
  onClose: () => void;
}

function formatAccessLevel(level: string) {
  return level.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ProfileDrawer({ visible, onClose }: Props) {
  const profile = useAuthStore((s) => s.profile);
  const signOut = useAuthStore((s) => s.signOut);
  const [changingPw, setChangingPw] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [busy, setBusy] = useState(false);

  if (!profile) return null;

  async function handleLogout() {
    onClose();
    try { await api.logout(); } catch {}
    await signOut();
  }

  async function handleChangePassword() {
    if (newPw.length < 8) {
      notify("Too short", "New password must be at least 8 characters.");
      return;
    }
    if (newPw !== confirmPw) {
      notify("Mismatch", "New passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await api.changePassword({ current_password: currentPw, new_password: newPw });
      notify("Done", "Password changed successfully.");
      setChangingPw(false);
      setCurrentPw(""); setNewPw(""); setConfirmPw("");
    } catch (err: any) {
      notify("Failed", err?.body?.message ?? "Could not change password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <ScrollView>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{profile.call_sign}</Text>
          </View>
          <Text style={styles.name}>{profile.name}</Text>
          <Text style={styles.callSign}>{profile.call_sign}</Text>

          <View style={styles.section}>
            <Row label="Access level" value={formatAccessLevel(profile.access_level)} />
            <Row label="Sector" value={profile.sector} />
            <Row label="Organization" value={profile.organization} />
            <Row label="Province" value={profile.province} />
          </View>

          <Text style={styles.aboutTitle}>About</Text>
          <View style={styles.section}>
            <Row label="App" value={APP_NAME} />
            <Row label="Version" value={APP_VERSION} />
            <Row label="API" value={getApiBaseUrl().replace(/^https?:\/\//, "")} />
          </View>

          <View style={styles.divider} />

          {!changingPw ? (
            <TouchableOpacity style={styles.menuItem} onPress={() => setChangingPw(true)}>
              <Text style={styles.menuItemText}>🔒  Change password</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.pwForm}>
              <Text style={styles.pwTitle}>Change password</Text>
              <TextInput
                style={styles.input}
                placeholder="Current password"
                secureTextEntry
                value={currentPw}
                onChangeText={setCurrentPw}
              />
              <TextInput
                style={styles.input}
                placeholder="New password (min 8 chars)"
                secureTextEntry
                value={newPw}
                onChangeText={setNewPw}
              />
              <TextInput
                style={styles.input}
                placeholder="Confirm new password"
                secureTextEntry
                value={confirmPw}
                onChangeText={setConfirmPw}
              />
              <View style={{ flexDirection: "row", gap: spacing.sm }}>
                <TouchableOpacity
                  style={[styles.btn, { backgroundColor: colors.primary, flex: 1 }, busy && { opacity: 0.6 }]}
                  onPress={handleChangePassword}
                  disabled={busy}
                >
                  <Text style={styles.btnText}>{busy ? "Saving…" : "Save"}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btn, { backgroundColor: colors.cardBg, borderWidth: 1.5, borderColor: colors.border, flex: 1 }]}
                  onPress={() => { setChangingPw(false); setCurrentPw(""); setNewPw(""); setConfirmPw(""); }}
                >
                  <Text style={[styles.btnText, { color: colors.text }]}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          <TouchableOpacity style={[styles.menuItem, { marginTop: spacing.sm }]} onPress={handleLogout}>
            <Text style={[styles.menuItemText, { color: colors.danger }]}>↩  Log out</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: spacing.lg,
    maxHeight: "90%",
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: spacing.md,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primary,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  avatarText: { fontSize: 24, fontWeight: "800", color: "#fff" },
  name: { fontSize: 20, fontWeight: "800", textAlign: "center" },
  callSign: { fontSize: 14, color: colors.textMuted, textAlign: "center", marginBottom: spacing.md },
  aboutTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.textMuted,
    marginBottom: spacing.sm,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  section: {
    backgroundColor: colors.cardBg,
    borderRadius: radii.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  row: { flexDirection: "row", justifyContent: "space-between" },
  rowLabel: { fontSize: 13, color: colors.textMuted },
  rowValue: { fontSize: 13, fontWeight: "700", textAlign: "right", flex: 1, marginLeft: spacing.md },
  divider: { height: 1, backgroundColor: colors.border, marginBottom: spacing.md },
  menuItem: {
    paddingVertical: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.cardBg,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  menuItemText: { fontSize: 15, fontWeight: "600" },
  pwForm: {
    backgroundColor: colors.cardBg,
    borderRadius: radii.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  pwTitle: { fontSize: 15, fontWeight: "700", marginBottom: spacing.sm },
  input: {
    backgroundColor: colors.bg,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    fontSize: 15,
  },
  btn: { borderRadius: radii.lg, padding: spacing.md, alignItems: "center" },
  btnText: { color: "#fff", fontWeight: "700" },
});
