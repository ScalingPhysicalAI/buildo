// react-native-ble-plx's BleManager is a true singleton (confirmed from its
// own source: `static sharedInstance`, constructor returns it if it already
// exists) -- every device link in the app shares the one native BLE
// central. startDeviceScan()/stopDeviceScan() act on that single shared
// scan session: calling stopDeviceScan() from one link while another link's
// scan is still in flight kills that other scan too, silently (confirmed
// from BleManager.js: `_scanEventSubscription` is one field on the shared
// instance, overwritten -- not queued -- by whichever startDeviceScan()
// call happened last). This serializes scans across every link so that
// never happens: a second scan simply waits for the first to finish.
let queue: Promise<unknown> = Promise.resolve();

export function withScanLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}
