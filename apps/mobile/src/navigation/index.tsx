import { useState } from "react";
import { TouchableOpacity } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useAuthStore } from "../store/auth";
import { colors } from "../theme";
import { ProfileDrawer } from "../components/ProfileDrawer";
import { LoginScreen } from "../screens/LoginScreen";
import { HomeScreen } from "../screens/HomeScreen";
import { CommencePatrolScreen } from "../screens/CommencePatrolScreen";
import { ActivePatrolScreen } from "../screens/ActivePatrolScreen";
import { HotspotsMapScreen } from "../screens/HotspotsMapScreen";
import { ResidentsScreen } from "../screens/ResidentsScreen";
import { MembersScreen } from "../screens/MembersScreen";
import { EmergencyContactsScreen } from "../screens/EmergencyContactsScreen";
import { LivePatrollerMapScreen } from "../screens/LivePatrollerMapScreen";
import { MessagingScreen } from "../screens/MessagingScreen";
import { ChannelScreen } from "../screens/ChannelScreen";

export type RootStackParamList = {
  Login: undefined;
  Home: undefined;
  CommencePatrol: undefined;
  ActivePatrol: { patrolId: string };
  HotspotsMap: undefined;
  Residents: undefined;
  Members: undefined;
  EmergencyContacts: undefined;
  LivePatrollerMap: undefined;
  Messaging: undefined;
  Channel: { channelId: string; channelName: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

/** Hamburger icon rendered as three horizontal bars. */
function HamburgerIcon({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} hitSlop={12} style={{ padding: 4, gap: 5, justifyContent: "center" }}>
      {[0, 1, 2].map((i) => (
        <TouchableOpacity
          key={i}
          style={{ width: 22, height: 2, backgroundColor: colors.primary, borderRadius: 1 }}
          pointerEvents="none"
        />
      ))}
    </TouchableOpacity>
  );
}

export function RootNavigator() {
  const status = useAuthStore((s) => s.status);
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <>
      <ProfileDrawer visible={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <Stack.Navigator
        screenOptions={{
          headerTitleAlign: "center",
          headerTitleStyle: { fontSize: 15, fontWeight: "700" },
          headerStyle: { backgroundColor: colors.bg },
          headerShadowVisible: true,
        }}
      >
        {status === "unauthenticated" ? (
          <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
        ) : (
          <>
            <Stack.Screen
              name="Home"
              component={HomeScreen}
              options={{
                title: "PATROL LOG",
                headerRight: () => (
                  <HamburgerIcon onPress={() => setDrawerOpen(true)} />
                ),
              }}
            />
            <Stack.Screen name="CommencePatrol" component={CommencePatrolScreen} options={{ title: "Commence Patrol" }} />
            <Stack.Screen name="ActivePatrol" component={ActivePatrolScreen} options={{ title: "Active Patrol" }} />
            <Stack.Screen name="HotspotsMap" component={HotspotsMapScreen} options={{ title: "Hotspot Map" }} />
            <Stack.Screen name="Residents" component={ResidentsScreen} options={{ title: "Residents" }} />
            <Stack.Screen name="Members" component={MembersScreen} options={{ title: "Members" }} />
            <Stack.Screen name="EmergencyContacts" component={EmergencyContactsScreen} options={{ title: "Emergency Contacts" }} />
            <Stack.Screen name="LivePatrollerMap" component={LivePatrollerMapScreen} options={{ title: "Live Patroller Map" }} />
            <Stack.Screen name="Messaging" component={MessagingScreen} options={{ title: "Messages" }} />
            <Stack.Screen
              name="Channel"
              component={ChannelScreen}
              options={({ route }) => ({ title: route.params.channelName })}
            />
          </>
        )}
      </Stack.Navigator>
    </>
  );
}
