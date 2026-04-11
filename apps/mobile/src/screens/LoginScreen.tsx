// FDL: blueprints/auth/patroller-login.blueprint.yaml

import { useState } from "react";
import { Alert, Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../lib/api";
import { useAuthStore } from "../store/auth";
import { getOrCreateDeviceId } from "../lib/device-id";
import { colors, spacing } from "../theme";

// Place LOGO.jpg in apps/mobile/assets/LOGO.jpg
let logo: ReturnType<typeof require> | null = null;
try {
  logo = require("../../assets/LOGO.jpg");
} catch {}

export function LoginScreen() {
  const [callSign, setCallSign] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const setAuthenticated = useAuthStore((s) => s.setAuthenticated);

  async function handleLogin() {
    if (!callSign.trim() || !password) {
      Alert.alert("Missing input", "Call sign and password are both required.");
      return;
    }
    setBusy(true);
    try {
      const deviceId = await getOrCreateDeviceId();
      const res = await api.login({ call_sign: callSign.trim().toUpperCase(), password, device_id: deviceId });
      await setAuthenticated(res.patroller, res.device_token);
    } catch (err: any) {
      Alert.alert("Login failed", err?.body?.message ?? "Unable to log in. Check your call sign and password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
          {/* Logo */}
          <View style={styles.logoWrap}>
            {logo ? (
              <Image source={logo} style={styles.logoImg} resizeMode="contain" />
            ) : (
              <View style={styles.logoFallback}>
                <Text style={styles.logoFallbackText}>CPF</Text>
              </View>
            )}
          </View>

          <Text style={styles.appName}>PATROL LOG</Text>
          <Text style={styles.subtitle}>Patroller sign-in</Text>

          <View style={styles.card}>
            <Text style={styles.label}>Call sign</Text>
            <TextInput
              style={styles.input}
              autoCapitalize="characters"
              autoCorrect={false}
              value={callSign}
              onChangeText={setCallSign}
              placeholder="e.g. WV46"
              placeholderTextColor={colors.textMuted}
              returnKeyType="next"
            />

            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              placeholderTextColor={colors.textMuted}
              returnKeyType="done"
              onSubmitEditing={handleLogin}
            />

            <TouchableOpacity
              style={[styles.button, busy && { opacity: 0.6 }]}
              onPress={handleLogin}
              disabled={busy}
              activeOpacity={0.85}
            >
              <Text style={styles.buttonText}>{busy ? "Signing in…" : "Sign in"}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  inner: { flexGrow: 1, padding: spacing.lg, alignItems: "center", justifyContent: "center" },
  logoWrap: { marginBottom: spacing.md },
  logoImg: { width: 120, height: 120 },
  logoFallback: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  logoFallbackText: { fontSize: 36, fontWeight: "800", color: "#fff" },
  appName: { fontSize: 26, fontWeight: "900", letterSpacing: 2, marginBottom: spacing.xs },
  subtitle: { fontSize: 14, color: colors.textMuted, marginBottom: spacing.xl },
  card: {
    width: "100%",
    backgroundColor: colors.cardBg,
    borderRadius: 14,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  label: { fontSize: 13, fontWeight: "700", color: colors.textMuted, marginBottom: spacing.xs, textTransform: "uppercase", letterSpacing: 0.5 },
  input: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: spacing.md,
    fontSize: 16,
    marginBottom: spacing.md,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    padding: spacing.md,
    alignItems: "center",
    marginTop: spacing.sm,
  },
  buttonText: { color: "#fff", fontWeight: "800", fontSize: 16 },
});
