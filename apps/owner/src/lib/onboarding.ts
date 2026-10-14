import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "buildo-owner.onboarded";

export async function hasSeenOnboarding(): Promise<boolean> {
  return (await AsyncStorage.getItem(KEY)) === "true";
}

export async function markOnboardingSeen(): Promise<void> {
  await AsyncStorage.setItem(KEY, "true");
}
