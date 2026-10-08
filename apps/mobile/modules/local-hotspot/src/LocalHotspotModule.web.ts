import { registerWebModule, NativeModule } from "expo";

import type { LocalHotspotReservation } from "./LocalHotspot.types";

// Local-only hotspot has no web/iOS equivalent -- there is no public API on
// either platform for an app to stand up its own WiFi AP. Every method just
// rejects clearly so callers fail loudly instead of hanging.
class LocalHotspotModule extends NativeModule<{}> {
  async startHotspot(): Promise<LocalHotspotReservation> {
    throw new Error("Local hotspot is Android-only; not supported on this platform.");
  }

  async stopHotspot(): Promise<void> {}

  isSupported(): boolean {
    return false;
  }
}

export default registerWebModule(LocalHotspotModule, "LocalHotspotModule");
