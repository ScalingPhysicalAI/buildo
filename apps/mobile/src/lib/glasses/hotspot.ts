// App-level wrapper around the native LocalHotspot module: owns the
// ACCESS_FINE_LOCATION permission prompt (required by Android before
// startLocalOnlyHotspot() will succeed) and the Android-only platform guard,
// so callers just get a clean typed promise.
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
  constructor() {
    super("Location permission is required to start the hotspot.");
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

export async function startHotspot(): Promise<LocalHotspotReservation> {
  if (Platform.OS !== "android") {
    throw new HotspotUnsupportedError();
  }

  const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION, {
    title: "Location permission needed",
    message: "Android requires location permission to create a WiFi hotspot for your glasses to join.",
    buttonPositive: "Allow",
  });

  if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
    throw new HotspotPermissionDeniedError();
  }

  try {
    return await LocalHotspot.startHotspot();
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code === "ERR_LOCATION_SERVICES_DISABLED") {
      throw new HotspotLocationServicesDisabledError();
    }
    throw error;
  }
}

export async function stopHotspot(): Promise<void> {
  if (Platform.OS !== "android") return;
  await LocalHotspot.stopHotspot();
}
