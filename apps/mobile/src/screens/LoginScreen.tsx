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
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
          <View style={styles.brand}>
            {logo ? (
              <Image source={logo} style={styles.logoImg} resizeMode="contain" />
            ) : (
              <View style={styles.logoFallback}>
                <Text style={styles.logoFallbackText}>PL</Text>
              </View>
            )}
            <Text style={styles.appName}>Patrol Log</Text>
          </View>

          <Text style={styles.headline}>Welcome back</Text>

          <TextInput
            style={styles.input}
            autoCapitalize="characters"
            autoCorrect={false}
            value={callSign}
            onChangeText={setCallSign}
            placeholder="Call sign"
            placeholderTextColor="#AFAFAF"
            returnKeyType="next"
          />
          <TextInput
            style={styles.input}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            placeholderTextColor="#AFAFAF"
            returnKeyType="done"
            onSubmitEditing={handleLogin}
          />

          <Pressable
            style={({ pressed }) => [styles.button, busy && { opacity: 0.6 }, pressed && { opacity: 0.9 }]}
            onPress={handleLogin}
            disabled={busy}
          >
            <Text style={styles.buttonText}>{busy ? "Signing in…" : "Continue"}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  inner: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xl,
    justifyContent: "center",
  },
  brand: { alignItems: "flex-start", marginBottom: spacing.xl },
  logoImg: { width: 56, height: 56, borderRadius: radii.md, marginBottom: spacing.md },
  logoFallback: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  logoFallbackText: { fontSize: 18, fontWeight: "700", color: "#fff" },
  appName: { fontSize: 15, fontWeight: "600", color: colors.textMuted },
  headline: {
    fontSize: 34,
    fontWeight: "700",
    color: colors.text,
    letterSpacing: -0.8,
    marginBottom: spacing.xl,
  },
  input: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.xl,
    paddingHorizontal: 20,
    paddingVertical: 18,
    fontSize: 17,
    fontWeight: "500",
    color: colors.text,
    marginBottom: spacing.md,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 28,
    paddingVertical: 17,
    alignItems: "center",
    marginTop: spacing.sm,
  },
  buttonText: { color: "#fff", fontWeight: "700", fontSize: 17 },
});
