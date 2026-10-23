import { NativeModule, requireNativeModule } from "expo";

import type { LocalHotspotReservation } from "./LocalHotspot.types";

declare class LocalHotspotModule extends NativeModule<{}> {
  startHotspot(): Promise<LocalHotspotReservation>;
  stopHotspot(): Promise<void>;
  isSupported(): boolean;
  isLocationEnabled(): boolean;
}

export default requireNativeModule<LocalHotspotModule>("LocalHotspot");
