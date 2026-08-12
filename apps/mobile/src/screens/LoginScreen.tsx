// FDL: blueprints/auth/patroller-login.blueprint.yaml

import { useEffect, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  Pressable,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../lib/api";
import { useAuthStore } from "../store/auth";
import { getOrCreateDeviceId } from "../lib/device-id";
import {
  initialDiagChecks,
  runNetworkDiagnostics,
  type DiagCheck,
  type DiagReport,
} from "../lib/diagnostics";
import { notify } from "../lib/notify";
import { colors, radii, spacing } from "../theme";
import { APP_VERSION } from "../version";

let logo: ReturnType<typeof require> | null = null;
try {
  logo = require("../../assets/LOGO.jpg");
} catch {}

function statusGlyph(status: DiagCheck["status"]): string {
  switch (status) {
    case "pass":
      return "✓";
    case "fail":
      return "✗";
    case "slow":
      return "!";
    case "running":
      return "…";
    default:
      return "·";
  }
}

function statusColor(status: DiagCheck["status"]): string {
  switch (status) {
    case "pass":
      return "#1B7A3D";
    case "fail":
      return colors.danger;
    case "slow":
      return "#B26A00";
    default:
      return colors.textMuted;
  }
}

export function LoginScreen() {
  const [callSign, setCallSign] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [checks, setChecks] = useState<DiagCheck[]>(() => initialDiagChecks());
  const [report, setReport] = useState<DiagReport | null>(null);
  const [diagRunning, setDiagRunning] = useState(true);
  const setAuthenticated = useAuthStore((s) => s.setAuthenticated);

  useEffect(() => {
    let cancelled = false;
    setDiagRunning(true);
    setReport(null);
    void runNetworkDiagnostics((next) => {
      if (!cancelled) setChecks(next);
    }).then((r) => {
      if (cancelled) return;
      setReport(r);
      setChecks(r.checks);
      setDiagRunning(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogin() {
    if (!callSign.trim() || !password) {
      notify("Missing input", "Call sign and password are both required.");
      return;
    }
    setBusy(true);
    try {
      const deviceId = await getOrCreateDeviceId();
      const res = await api.login({
        call_sign: callSign.trim().toUpperCase(),
        password,
        device_id: deviceId,
      });
      await setAuthenticated(res.patroller, res.device_token);
    } catch (err: any) {
      notify("Login failed", err?.body?.message ?? "Unable to log in. Check your call sign and password.");
    } finally {
      setBusy(false);
    }
  }

  async function openLogLink() {
    if (!report?.logLink) return;
    try {
      const supported = await Linking.canOpenURL(report.logLink);
      if (supported) {
        await Linking.openURL(report.logLink);
        return;
      }
    } catch {}
    // Web fallback: copy log to clipboard when WhatsApp deep link fails.
    if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(report.logText);
        notify("Log copied", "Paste it into WhatsApp or SMS to the admin.");
        return;
      } catch {}
    }
    notify("Share log", report.logText.slice(0, 280));
  }

  async function rerunDiag() {
    setDiagRunning(true);
    setReport(null);
    setChecks(initialDiagChecks());
    const r = await runNetworkDiagnostics(setChecks);
    setReport(r);
    setChecks(r.checks);
    setDiagRunning(false);
  }

  const showLogLink = !!report?.needsAttention;

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.sheet}>
            <View style={styles.brand}>
              {logo ? (
                <Image source={logo} style={styles.logoImg} resizeMode="contain" />
              ) : (
                <View style={styles.logoFallback}>
                  <Text style={styles.logoFallbackText}>PL</Text>
                </View>
              )}
              <Text style={styles.appName}>PATROL LOG</Text>
              <Text style={styles.tagline}>Sign in with your call sign</Text>
              <Text style={styles.version}>v{APP_VERSION}</Text>
            </View>

            {/* Temporary auto network checklist — remove after field testing */}
            <View style={styles.diagCard}>
              <View style={styles.diagHeader}>
                <Text style={styles.diagTitle}>Connection check</Text>
                <Pressable onPress={() => void rerunDiag()} disabled={diagRunning} hitSlop={8}>
                  <Text style={[styles.diagRerun, diagRunning && { opacity: 0.5 }]}>
                    {diagRunning ? "Running…" : "Re-run"}
                  </Text>
                </Pressable>
              </View>
              {checks.map((c) => (
                <View key={c.id} style={styles.diagRow}>
                  <Text style={[styles.diagGlyph, { color: statusColor(c.status) }]}>
                    {statusGlyph(c.status)}
                  </Text>
                  <View style={styles.diagTextCol}>
                    <Text style={styles.diagLabel}>{c.label}</Text>
                    {c.detail ? <Text style={styles.diagDetail}>{c.detail}</Text> : null}
                  </View>
                </View>
              ))}
              {showLogLink && report ? (
                <View style={styles.logBox}>
                  <Text style={styles.logWarn}>
                    {report.overall === "fail"
                      ? "Connection failed — send this log to admin."
                      : "Connection is slow — send this log to admin."}
                  </Text>
                  <Pressable style={styles.logLinkBtn} onPress={() => void openLogLink()}>
                    <Text style={styles.logLinkBtnText}>Open log link (WhatsApp)</Text>
                  </Pressable>
                  {Platform.OS === "web" ? (
                    <Pressable
                      style={styles.logCopyBtn}
                      onPress={async () => {
                        try {
                          await navigator.clipboard.writeText(report.logText);
                          notify("Copied", "Diagnostic log copied to clipboard.");
                        } catch {
                          notify("Log", report.logText.slice(0, 200));
                        }
                      }}
                    >
                      <Text style={styles.logCopyBtnText}>Copy log text</Text>
                    </Pressable>
                  ) : null}
                  <Text style={styles.logPreview} selectable>
                    {report.logText}
                  </Text>
                </View>
              ) : null}
            </View>

            <View style={styles.form}>
              <Text style={styles.label}>Call sign</Text>
              <TextInput
                style={styles.input}
                autoCapitalize="characters"
                autoCorrect={false}
                value={callSign}
                onChangeText={setCallSign}
                placeholder="e.g. WC29"
                placeholderTextColor={colors.textMuted}
                returnKeyType="next"
              />

              <Text style={[styles.label, styles.labelSpaced]}>Password</Text>
              <TextInput
                style={styles.input}
                secureTextEntry
                value={password}
                onChangeText={setPassword}
                placeholder="Password"
                placeholderTextColor={colors.textMuted}
                returnKeyType="done"
                onSubmitEditing={handleLogin}
              />

              <Pressable
                style={({ pressed }) => [
                  styles.button,
                  busy && styles.buttonDisabled,
                  pressed && !busy && styles.buttonPressed,
                ]}
                onPress={handleLogin}
                disabled={busy}
              >
                <Text style={styles.buttonText}>{busy ? "Signing in…" : "Continue"}</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surfaceMuted },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    width: "100%",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
  },
  sheet: {
    width: "100%",
    maxWidth: 400,
    alignSelf: "center",
  },
  brand: {
    alignItems: "center",
    marginBottom: spacing.lg,
  },
  logoImg: {
    width: 112,
    height: 112,
    borderRadius: 56,
    marginBottom: spacing.md,
    backgroundColor: "#fff",
    borderWidth: 3,
    borderColor: colors.accent,
  },
  logoFallback: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  logoFallbackText: { fontSize: 28, fontWeight: "800", color: "#fff" },
  appName: {
    fontSize: 28,
    fontWeight: "800",
    color: colors.text,
    letterSpacing: 1.2,
    textAlign: "center",
  },
  tagline: {
    marginTop: spacing.sm,
    fontSize: 15,
    fontWeight: "500",
    color: colors.textMuted,
    textAlign: "center",
  },
  version: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: "600",
    color: colors.textMuted,
  },
  diagCard: {
    backgroundColor: "#fff",
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  diagHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  diagTitle: { fontSize: 14, fontWeight: "800", color: colors.text },
  diagRerun: { fontSize: 13, fontWeight: "700", color: colors.primary },
  diagRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginTop: 8 },
  diagGlyph: { fontSize: 14, fontWeight: "800", width: 16, marginTop: 1 },
  diagTextCol: { flex: 1 },
  diagLabel: { fontSize: 13, fontWeight: "600", color: colors.text },
  diagDetail: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  logBox: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  logWarn: { fontSize: 13, fontWeight: "700", color: colors.danger, marginBottom: spacing.sm },
  logLinkBtn: {
    backgroundColor: colors.primary,
    borderRadius: radii.lg,
    paddingVertical: 12,
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  logLinkBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  logCopyBtn: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.lg,
    paddingVertical: 10,
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  logCopyBtnText: { color: colors.text, fontWeight: "700", fontSize: 13 },
  logPreview: {
    fontSize: 11,
    fontFamily: Platform.OS === "web" ? "monospace" : undefined,
    color: colors.textMuted,
    lineHeight: 16,
  },
  form: {
    width: "100%",
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textMuted,
    marginBottom: spacing.sm,
    marginLeft: 4,
  },
  labelSpaced: {
    marginTop: spacing.md,
  },
  input: {
    width: "100%",
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === "web" ? 14 : 16,
    fontSize: 17,
    fontWeight: "600",
    color: colors.text,
  },
  button: {
    width: "100%",
    backgroundColor: colors.primary,
    borderRadius: radii.lg,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: spacing.lg,
  },
  buttonPressed: { opacity: 0.88 },
  buttonDisabled: { opacity: 0.55 },
  buttonText: { color: "#fff", fontWeight: "700", fontSize: 17 },
});
