// Remembers a WiFi password locally, keyed by SSID, so the debug screen
// only needs it typed once per network -- the real fix for "I don't want to
// type this every time," since the password itself can't be read from the
// OS (see network-info.ts). Plain AsyncStorage, same as every other local
// preference in this app: fine for a bench-testing tool, not meant as a
// secure credential store.
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY_PREFIX = "buildo.glasses-debug.wifi-password.";

export async function getSavedWifiPassword(ssid: string): Promise<string | null> {
  if (!ssid) return null;
  return AsyncStorage.getItem(KEY_PREFIX + ssid);
}

export async function saveWifiPassword(ssid: string, password: string): Promise<void> {
  if (!ssid) return;
  await AsyncStorage.setItem(KEY_PREFIX + ssid, password);
}
