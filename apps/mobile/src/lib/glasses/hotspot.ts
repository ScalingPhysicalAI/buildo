// App-level wrapper around the native LocalHotspot module: owns the runtime
// permission prompts startLocalOnlyHotspot() needs and the Android-only
// platform guard, so callers just get a clean typed promise.
//
// Two different permissions gate this depending on target SDK, and this app
// targets API 33+ (Expo SDK 57): apps targeting Android 13+ must hold
// NEARBY_WIFI_DEVICES for startLocalOnlyHotspot() -- ACCESS_FINE_LOCATION
// alone, even fully granted, is no longer enough and throws a
// SecurityException from the native call that looks identical to a missing
// permission. Both are requested here; FINE_LOCATION still matters on
// pre-13 devices and is already needed elsewhere (BLE scanning, SSID read).
import { PermissionsAndroid, Platform } from "react-native";

import LocalHotspot from "../../../modules/local-hotspot/src/LocalHotspotModule";
import type { LocalHotspotReservation } from "../../../modules/local-hotspot/src/LocalHotspot.types";

export type { LocalHotspotReservation };

export class HotspotUnsupportedError extends Error {
  constructor() {
    super("Local hotspot is only supported on Android.");
    this.name = "HotspotUnsupportedError";
  }
}

export class HotspotPermissionDeniedError extends Error {
  constructor(missing: string[]) {
    super(`${missing.join(" and ")} permission${missing.length > 1 ? "s are" : " is"} required to start the hotspot.`);
    this.name = "HotspotPermissionDeniedError";
  }
}

// Android requires system Location Services to be ON (not just the app's
// ACCESS_FINE_LOCATION permission granted) before startLocalOnlyHotspot()
// will succeed -- this is the actual cause behind most "permission" errors
// once the app permission has already been granted.
export class HotspotLocationServicesDisabledError extends Error {
  constructor() {
    super("Turn on Location in your phone's system settings -- Android requires it to be on to create a hotspot.");
    this.name = "HotspotLocationServicesDisabledError";
  }
}

async function requestHotspotPermissions(): Promise<void> {
  const results = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    // Only exists from API 33 (Android 13) -- requesting it on older devices
    // is a no-op that resolves granted, since the OS has no such permission
    // to withhold.
    PermissionsAndroid.PERMISSIONS.NEARBY_WIFI_DEVICES,
  ]);

  const missing = Object.entries(results)
    .filter(([, result]) => result !== PermissionsAndroid.RESULTS.GRANTED)
    .map(([permission]) => (permission.endsWith("NEARBY_WIFI_DEVICES") ? "Nearby devices" : "Location"));
  if (missing.length > 0) {
    throw new HotspotPermissionDeniedError(missing);
  }
}

function errorCode(error: unknown): string | undefined {
  return (error as { code?: string } | null)?.code;
}

export async function startHotspot(): Promise<LocalHotspotReservation> {
  if (Platform.OS !== "android") {
    throw new HotspotUnsupportedError();
  }

  // Call the native side first and only prompt for permissions if IT says
  // one's missing, instead of gating on our own `requestMultiple()` result
  // beforehand. Android's permission state for a just-toggled-in-Settings
  // permission has been observed not to apply to an already-running process
  // until something re-checks it natively -- `requestMultiple()` can report
  // "granted" or "denied" from a stale view in that window, which previously
  // blocked this function even though the real `startLocalOnlyHotspot()`
  // call underneath would have been the accurate source of truth either way.
  try {
    return await LocalHotspot.startHotspot();
  } catch (error) {
    const code = errorCode(error);
    if (code === "ERR_LOCATION_SERVICES_DISABLED") {
      throw new HotspotLocationServicesDisabledError();
    }
    if (code !== "ERR_PERMISSION") throw error;
  }

  await requestHotspotPermissions();

  // Permissions are confirmed granted now -- retry once. If this still
  // throws ERR_PERMISSION, something beyond a simple runtime-permission
  // grant is wrong (e.g. the installed build predates the manifest change
  // and needs `expo prebuild --clean` + a fresh install, not just a reload).
  try {
    return await LocalHotspot.startHotspot();
  } catch (error) {
    const code = errorCode(error);
    if (code === "ERR_LOCATION_SERVICES_DISABLED") {
      throw new HotspotLocationServicesDisabledError();
    }
    if (code === "ERR_PERMISSION") {
      throw new Error(
        "Still rejected after permissions were confirmed granted -- fully close and reopen the app (not just background it), " +
          "or reinstall if you changed app.json's permissions since the last native build."
      );
    }
    throw error;
  }
}

export async function stopHotspot(): Promise<void> {
  if (Platform.OS !== "android") return;
  await LocalHotspot.stopHotspot();
}
