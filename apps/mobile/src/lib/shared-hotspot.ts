// Android only ever allows one LocalOnlyHotspot reservation system-wide
// (confirmed from LocalHotspotModule.kt's own comment), and the native
// module explicitly closes any existing reservation and mints a brand new
// SSID/password every time startHotspot() is called. If glasses and gloves
// each called that directly, whichever one joined second would silently
// kick the other off its own hotspot mid-recording. This reference-counts
// acquire/release so the first caller in a window actually starts it, later
// overlapping callers reuse the same reservation, and it's only actually
// torn down once every caller has released it. Used alone (just one
// caller, ever), this behaves identically to calling startHotspot()/
// stopHotspot() directly -- same fresh-reservation-per-call, same teardown.
import { startHotspot, stopHotspot, type LocalHotspotReservation } from "./glasses/hotspot";

let activeReservation: LocalHotspotReservation | null = null;
let starting: Promise<LocalHotspotReservation> | null = null;
let refCount = 0;

export async function acquireHotspot(): Promise<LocalHotspotReservation> {
  if (activeReservation) {
    refCount++;
    return activeReservation;
  }
  if (starting) {
    refCount++;
    return starting;
  }

  refCount++;
  starting = startHotspot()
    .then((reservation) => {
      activeReservation = reservation;
      starting = null;
      return reservation;
    })
    .catch((err) => {
      starting = null;
      refCount = Math.max(0, refCount - 1);
      throw err;
    });
  return starting;
}

export async function releaseHotspot(): Promise<void> {
  refCount = Math.max(0, refCount - 1);
  if (refCount > 0) return;
  if (!activeReservation) return;
  activeReservation = null;
  await stopHotspot();
}
