import "react-native-gesture-handler";
import { useEffect } from "react";
import { ActivityIndicator, Platform, View } from "react-native";
import { NavigationContainer, type LinkingOptions } from "@react-navigation/native";
import * as ExpoLinking from "expo-linking";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useAuthStore } from "./src/store/auth";
import { RootNavigator, type RootStackParamList } from "./src/navigation";
import { AppDialog } from "./src/components/AppDialog";
import { colors } from "./src/theme";

/** Web-only: sync stack with browser history so Back pops screens instead of leaving the app. */
const webLinking: LinkingOptions<RootStackParamList> = {
  prefixes: [ExpoLinking.createURL("/"), typeof window !== "undefined" ? window.location.origin : ""].filter(Boolean),
  config: {
    screens: {
      Login: "login",
      Home: "",
      CommencePatrol: "commence",
      ActivePatrol: "patrol/:patrolId",
      HotspotsMap: "hotspots",
      Residents: "residents",
      Members: "members",
      EmergencyContacts: "emergency",
      LivePatrollerMap: "live-map",
      Messaging: "messages",
      NewGroup: "messages/new-group",
      Channel: {
        path: "messages/:channelId",
        parse: {
          channelId: (id: string) => id,
        },
        stringify: {
          channelId: (id: string) => id,
        },
      },
    },
  },
};

export default function App() {
  const status = useAuthStore((s) => s.status);
  const bootstrap = useAuthStore((s) => s.bootstrap);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {status === "bootstrapping" ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <NavigationContainer linking={Platform.OS === "web" ? webLinking : undefined}>
          <RootNavigator />
        </NavigationContainer>
      )}
      <AppDialog />
    </SafeAreaProvider>
  );
}
