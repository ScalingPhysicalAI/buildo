// Auto-fills what's actually readable from the OS, for the BLE provisioning
// step in glasses-debug.tsx: the phone's current WiFi SSID and its own local
// IP address. The WiFi *password* is deliberately not handled here -- no
// app on Android or iOS can read the password of a network it didn't itself
// configure (OS security boundary, not a library gap). See
// wifi-credential-store.ts for the one realistic mitigation: remember it
// locally after the user types it once.
//
// IMPORTANT: this bypasses expo-network's own JS entry point on purpose.
// That package's ExpoNetwork.js calls expo-modules-core's
// requireNativeModule('ExpoNetwork') *at module-evaluation time*, which
// throws synchronously the instant it's imported -- by anything, static or
// dynamic import() alike, since both still have to evaluate the module's
// top-level code -- on a dev client that hasn't been rebuilt with this
// native module yet. That crashed the whole screen before any try/catch
// here ever ran. requireOptionalNativeModule() is the same resolution
// expo-network uses underneath, except it returns null instead of
// throwing -- calling it directly here, instead of going through
// expo-network's wrapper, is what actually makes this gracefully optional.
import { requireOptionalNativeModule } from "expo-modules-core";
import { PermissionsAndroid, Platform } from "react-native";
import WifiManager from "react-native-wifi-reborn";

interface ExpoNetworkNativeModule {
  getIpAddressAsync(): Promise<string>;
}

export async function getPhoneIpAddress(): Promise<string | null> {
  try {
    const native = requireOptionalNativeModule<ExpoNetworkNativeModule>("ExpoNetwork");
    if (!native) return null; // not linked into this build yet -- needs a rebuild
    const ip = await native.getIpAddressAsync();
    // expo-network returns "0.0.0.0" when there's no real network interface.
    return ip && ip !== "0.0.0.0" ? ip : null;
  } catch {
    return null;
  }
}

// react-native-wifi-reborn uses the older NativeModules.WifiManager lookup
// (not expo-modules-core), which resolves to `undefined` rather than
// throwing when unlinked -- the try/catch below is enough to catch the
// resulting "undefined is not an object" on an un-rebuilt dev client.
//
// Reading the current SSID also needs ACCESS_FINE_LOCATION on Android (same
// OS rule as BLE scanning) and the WiFi-info entitlement on iOS -- both are
// wired up via the react-native-wifi-reborn config plugin in app.json.
export async function getCurrentWifiSsid(): Promise<string | null> {
  if (Platform.OS === "android") {
    const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION, {
      title: "Location permission needed",
      message: "Android requires location permission to read the current Wi-Fi network name.",
      buttonPositive: "Allow",
    });
    if (granted !== PermissionsAndroid.RESULTS.GRANTED) return null;
  }

  try {
    const ssid = await WifiManager.getCurrentWifiSSID();
    // Android can return this literal placeholder when permission/location
    // services aren't fully available yet, rather than throwing.
    if (!ssid || ssid === "<unknown ssid>") return null;
    return ssid;
  } catch {
    return null;
  }
}
