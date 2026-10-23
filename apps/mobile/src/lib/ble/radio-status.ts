// Phone-level radio checks (Bluetooth adapter state, Android Location
// Services) -- separate from NordicUartLink, which is about one board's
// connection, not the phone's radios in general.
import { Linking, Platform } from "react-native";
import { BleManager, State } from "react-native-ble-plx";

import LocalHotspot from "../../../modules/local-hotspot/src/LocalHotspotModule";

const manager = new BleManager();

export { State as BleState };

export function getBleState(): Promise<State> {
  return manager.state();
}

export function onBleStateChange(listener: (state: State) => void): () => void {
  const subscription = manager.onStateChange(listener, true);
  return () => subscription.remove();
}

// Android only: pops the system "turn on Bluetooth?" dialog directly,
// no need to leave the app. No-op promise elsewhere.
export async function enableBluetooth(): Promise<void> {
  if (Platform.OS !== "android") return;
  await manager.enable();
}

export function openBluetoothSettings(): void {
  if (Platform.OS === "android") Linking.sendIntent("android.settings.BLUETOOTH_SETTINGS");
}

// Android only: startLocalOnlyHotspot() and BLE scanning both silently fail
// (or throw a permission-shaped error) when system Location is off, even
// with every runtime permission granted. True on every other platform.
export async function isLocationEnabled(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  return LocalHotspot.isLocationEnabled();
}

export function openLocationSettings(): void {
  if (Platform.OS === "android") Linking.sendIntent("android.settings.LOCATION_SOURCE_SETTINGS");
}
