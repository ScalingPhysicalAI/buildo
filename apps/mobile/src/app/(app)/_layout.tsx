import { Bluetooth, CircleDot, House } from "lucide-react-native";
import { Redirect, Tabs } from "expo-router";
import { ActivityIndicator, View } from "react-native";

import { useAuth } from "../../lib/auth-context";
import { colors, fonts } from "../../theme";

export default function AppLayout() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.sandDark} size="large" />
      </View>
    );
  }

  if (!user) return <Redirect href="/login" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.sandDark,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: 84,
          paddingTop: 8,
        },
        tabBarLabelStyle: {
          fontFamily: fonts.bodyMedium,
          fontSize: 11,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: "Home", tabBarIcon: ({ color, size }) => <House color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="pair"
        options={{ title: "Devices", tabBarIcon: ({ color, size }) => <Bluetooth color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="record"
        options={{ title: "Record", tabBarIcon: ({ color, size }) => <CircleDot color={color} size={size} /> }}
      />
    </Tabs>
  );
}
