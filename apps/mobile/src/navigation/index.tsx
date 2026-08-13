import { useEffect, useState } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { FontAwesome } from "@expo/vector-icons";
import { useAuthStore } from "../store/auth";
import { useMessagingStore } from "../store/messaging";
import { colors } from "../theme";
import { OfflineBanner } from "../components/OfflineBanner";
import { ProfileDrawer } from "../components/ProfileDrawer";
import { startConnectivityMonitoring } from "../lib/connectivity";
import { ensureHeartbeatForActivePatrol, startHeartbeatForPatrol } from "../lib/heartbeat";
import { useKeepScreenOn } from "../lib/keepAwake";
import { flushOutbox, refreshOutboxCount } from "../lib/outbox";
import { useCacheSyncStore } from "../lib/cacheSync";
import { api } from "../lib/api";
import { storage } from "../lib/storage";
import { LoginScreen } from "../screens/LoginScreen";
import { HomeScreen } from "../screens/HomeScreen";
import { CommencePatrolScreen } from "../screens/CommencePatrolScreen";
import { CapturePatrolScreen } from "../screens/CapturePatrolScreen";
import { JoinPatrolScreen } from "../screens/JoinPatrolScreen";
import { ActivePatrolScreen } from "../screens/ActivePatrolScreen";
import { HotspotsMapScreen } from "../screens/HotspotsMapScreen";
import { ResidentsScreen } from "../screens/ResidentsScreen";
import { MembersScreen } from "../screens/MembersScreen";
import { EmergencyContactsScreen } from "../screens/EmergencyContactsScreen";
import { LivePatrollerMapScreen } from "../screens/LivePatrollerMapScreen";
import { MessagingScreen } from "../screens/MessagingScreen";
import { ChannelScreen } from "../screens/ChannelScreen";
import { NewGroupScreen } from "../screens/NewGroupScreen";

export type RootStackParamList = {
  Login: undefined;
  Home: undefined;
  CommencePatrol: undefined;
  CapturePatrol: undefined;
  JoinPatrol: undefined;
  ActivePatrol: { patrolId: string };
  HotspotsMap: undefined;
  Residents: undefined;
  Members: undefined;
  EmergencyContacts: undefined;
  LivePatrollerMap: undefined;
  Messaging: undefined;
  NewGroup: undefined;
  Channel: {
    channelId: string;
    channelName?: string;
    kind?: "chat" | "group";
    memberCount?: number;
  };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

function HamburgerIcon({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} hitSlop={12} style={{ padding: 6 }}>
      <FontAwesome name="bars" size={18} color={colors.text} />
    </TouchableOpacity>
  );
}

function BellIcon({ navigation }: { navigation: any }) {
  const unreadCount = useMessagingStore((s) => s.unreadCount);
  return (
    <TouchableOpacity
      onPress={() => navigation.navigate("Messaging")}
      hitSlop={12}
      style={{ padding: 6, marginRight: 4, width: 34, height: 34, justifyContent: "center", alignItems: "center" }}
    >
      <FontAwesome name="bell-o" size={18} color={colors.text} />
      {unreadCount > 0 && (
        <View
          style={{
            position: "absolute",
            top: 2,
            right: 2,
            backgroundColor: colors.danger,
            borderRadius: 6,
            minWidth: 16,
            height: 16,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 3,
          }}
        >
          <Text style={{ color: "#fff", fontSize: 9, fontWeight: "700" }}>
            {unreadCount > 99 ? "99+" : unreadCount}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

export function RootNavigator() {
  const status = useAuthStore((s) => s.status);
  const [drawerOpen, setDrawerOpen] = useState(false);
  useKeepScreenOn(status === "authenticated");

  useEffect(() => {
    if (status !== "authenticated") return;
    void (async () => {
      const existing = await ensureHeartbeatForActivePatrol();
      if (existing) return;
      try {
        const p = await api.activePatrol();
        if (!p?.patrol_id) return;
        try {
          await storage.setActivePatrolCache(JSON.stringify(p));
        } catch {
          /* ignore */
        }
        await startHeartbeatForPatrol(p.patrol_id);
      } catch {
        /* not on patrol */
      }
    })();
    void refreshOutboxCount();
    useCacheSyncStore.getState().startBackgroundSync();
    return startConnectivityMonitoring(() => {
      void flushOutbox();
      useCacheSyncStore.getState().startBackgroundSync();
    });
  }, [status]);

  if (status === "unauthenticated") {
    return (
      <Stack.Navigator
        screenOptions={{
          headerTitleAlign: "center",
          headerTitleStyle: { fontSize: 17, fontWeight: "700", color: colors.text },
          headerStyle: { backgroundColor: colors.bg },
          headerShadowVisible: false,
          headerTintColor: colors.text,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
      </Stack.Navigator>
    );
  }

  return (
    <>
      <ProfileDrawer visible={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <View style={{ flex: 1 }}>
        <OfflineBanner />
        <Stack.Navigator
          screenOptions={{
            headerTitleAlign: "center",
            headerTitleStyle: { fontSize: 17, fontWeight: "700", color: colors.text },
            headerStyle: { backgroundColor: colors.bg },
            headerShadowVisible: false,
            headerTintColor: colors.text,
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
            <Stack.Screen
              name="Home"
              component={HomeScreen}
              options={({ navigation }) => ({
                title: "Patrol Log",
                headerRight: () => (
                  <View style={{ flexDirection: "row", alignItems: "center", paddingRight: 12 }}>
                    <BellIcon navigation={navigation} />
                    <HamburgerIcon onPress={() => setDrawerOpen(true)} />
                  </View>
                ),
              })}
            />
            <Stack.Screen name="CommencePatrol" component={CommencePatrolScreen} options={{ title: "Commence patrol" }} />
            <Stack.Screen name="CapturePatrol" component={CapturePatrolScreen} options={{ title: "Capture patrol" }} />
            <Stack.Screen name="JoinPatrol" component={JoinPatrolScreen} options={{ title: "Join patrol" }} />
            <Stack.Screen name="ActivePatrol" component={ActivePatrolScreen} options={{ title: "Active patrol" }} />
            <Stack.Screen name="HotspotsMap" component={HotspotsMapScreen} options={{ title: "Hotspots" }} />
            <Stack.Screen name="Residents" component={ResidentsScreen} options={{ title: "Residents" }} />
            <Stack.Screen name="Members" component={MembersScreen} options={{ title: "Members" }} />
            <Stack.Screen name="EmergencyContacts" component={EmergencyContactsScreen} options={{ title: "Emergency contacts" }} />
            <Stack.Screen name="LivePatrollerMap" component={LivePatrollerMapScreen} options={{ title: "Live map" }} />
            <Stack.Screen
              name="Messaging"
              component={MessagingScreen}
              options={{
                title: "Chats",
                headerStyle: { backgroundColor: colors.primary },
                headerTintColor: "#fff",
                headerTitleStyle: { fontSize: 17, fontWeight: "700", color: "#fff" },
                contentStyle: { backgroundColor: colors.bg },
              }}
            />
            <Stack.Screen
              name="NewGroup"
              component={NewGroupScreen}
              options={{
                title: "New group",
                headerStyle: { backgroundColor: colors.primary },
                headerTintColor: "#fff",
                headerTitleStyle: { fontSize: 17, fontWeight: "700", color: "#fff" },
                contentStyle: { backgroundColor: colors.bg },
              }}
            />
            <Stack.Screen
              name="Channel"
              component={ChannelScreen}
              options={({ route }) => ({
                title: route.params.channelName || "Chat",
                headerStyle: { backgroundColor: colors.primary },
                headerTintColor: "#fff",
                headerTitleStyle: { fontSize: 17, fontWeight: "700", color: "#fff" },
                contentStyle: { backgroundColor: colors.primarySoft },
              })}
            />
        </Stack.Navigator>
      </View>
    </>
  );
}
