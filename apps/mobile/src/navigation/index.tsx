import { useState } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { FontAwesome } from "@expo/vector-icons";
import { useAuthStore } from "../store/auth";
import { useMessagingStore } from "../store/messaging";
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

/** Hamburger icon — three horizontal bars */
function HamburgerIcon({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} hitSlop={12} style={{ padding: 4, gap: 5, justifyContent: "center" }}>
      {[0, 1, 2].map((i) => (
        <View
          key={i}
          style={{ width: 22, height: 2, backgroundColor: colors.primary, borderRadius: 1 }}
        />
      ))}
    </TouchableOpacity>
  );
}

/** Bell icon with unread badge — navigates to Messaging */
function BellIcon({ navigation }: { navigation: any }) {
  const unreadCount = useMessagingStore((s) => s.unreadCount);
  return (
    <TouchableOpacity
      onPress={() => navigation.navigate("Messaging")}
      hitSlop={12}
      style={{ padding: 4, marginRight: 8, width: 32, height: 32, justifyContent: "center", alignItems: "center" }}
    >
      <FontAwesome name="bell-o" size={24} color={colors.text} />
      {unreadCount > 0 && (
        <View
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            backgroundColor: colors.danger,
            borderRadius: 9,
            minWidth: 18,
            height: 18,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 4,
            borderWidth: 1.5,
            borderColor: "#fff",
          }}
        >
          <Text style={{ color: "#fff", fontSize: 10, fontWeight: "800" }}>
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
              options={({ navigation }) => ({
                title: "PATROL LOG",
                headerRight: () => (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <BellIcon navigation={navigation} />
                    <HamburgerIcon onPress={() => setDrawerOpen(true)} />
                  </View>
                ),
              })}
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
