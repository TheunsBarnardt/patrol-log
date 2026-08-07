// FDL: blueprints/auth/patroller-login.blueprint.yaml

import { useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
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
import { notify } from "../lib/notify";
import { colors, radii, spacing } from "../theme";

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
    marginBottom: spacing.xl,
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
    borderWidth: 1,
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
