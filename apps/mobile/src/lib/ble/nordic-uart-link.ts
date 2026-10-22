// Shared BLE transport for every Buildo capture board (glasses master,
// glove). Both boards expose the same Nordic UART Service and the same
// wire convention -- one JSON object + "\n" per message, in both
// directions, chunked across notify/write packets with no extra framing.
// See PROTOCOL_GLASSES.md "BLE: setup and Wi-Fi state" and
// PROTOCOL_GLOVE.md §2. These UUIDs are the real ones from both specs, not
// placeholders.
import { PermissionsAndroid, Platform } from "react-native";
import { BleError, BleManager, type Device, type Subscription } from "react-native-ble-plx";

export type { Device };

export const NORDIC_UART_SERVICE_UUID = "6E400001-B5A3-F393-E0A9-E50E24DCCA9E";
export const NORDIC_UART_RX_UUID = "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"; // app -> board
export const NORDIC_UART_TX_UUID = "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"; // board -> app

const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function bytesToBase64(bytes: Uint8Array): string {
  let result = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    const triplet = (b0 << 16) | ((b1 ?? 0) << 8) | (b2 ?? 0);
    result += BASE64_CHARS[(triplet >> 18) & 0x3f];
    result += BASE64_CHARS[(triplet >> 12) & 0x3f];
    result += b1 !== undefined ? BASE64_CHARS[(triplet >> 6) & 0x3f] : "=";
    result += b2 !== undefined ? BASE64_CHARS[triplet & 0x3f] : "=";
  }
  return result;
}

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/=+$/, "");
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of clean) {
    const index = BASE64_CHARS.indexOf(char);
    if (index === -1) continue;
    buffer = (buffer << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}

function base64ToUtf8(value: string): string {
  return new TextDecoder().decode(base64ToBytes(value));
}

export class BlePermissionDeniedError extends Error {
  constructor() {
    super("Bluetooth/location permissions are required to pair over BLE.");
    this.name = "BlePermissionDeniedError";
  }
}

export class DeviceNotFoundError extends Error {
  constructor(name: string) {
    super(`Timed out looking for "${name}" over Bluetooth.`);
    this.name = "DeviceNotFoundError";
  }
}

// Same recognition rule ble_client.py uses for "is this one of the Niclas":
// name starts with "Glasses-" (covers both Glasses-L and Glasses-R). Shared
// here so both the Debug screen's device list and the Gadgets screen's own
// scan dropdown sort/flag candidates the exact same way.
export function isLikelyGlasses(device: Device): boolean {
  const name = device.name ?? device.localName ?? "";
  return name.startsWith("Glasses-");
}

export async function requestBlePermissions(): Promise<boolean> {
  if (Platform.OS !== "android") return true;

  const results = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  ]);

  return Object.values(results).every((result) => result === PermissionsAndroid.RESULTS.GRANTED);
}

// One board's BLE connection: scan by exact advertised name, connect,
// subscribe to TX, and expose a simple send()/onMessage() pair over the
// JSON-lines protocol. No per-board command knowledge lives here -- that's
// glasses-link.ts / a future glove-link.ts, built on top of this.
export class NordicUartLink {
  private manager: BleManager;
  private device: Device | null = null;
  private notifySub: Subscription | null = null;
  private rxBuffer = "";
  private messageListeners = new Set<(message: Record<string, unknown>) => void>();
  private disconnectListeners = new Set<() => void>();
  private intentionalDisconnect = false;

  constructor(manager?: BleManager) {
    this.manager = manager ?? new BleManager();
  }

  // Unfiltered scan -- lists every nearby BLE device, the same way a
  // generic scanner (nRF Connect, etc.) does. Prefer this over
  // connectByName() when the board doesn't show up there: many boards only
  // expose their GATT service UUID *after* a connection, not inside the
  // advertisement packet itself, which makes them invisible to a
  // service-filtered scan like connectByName()'s even though they're right
  // there. Calls `onDevice` for every advertisement seen (including repeats
  // -- dedup by `id` is the caller's job); call stopScan() to end it.
  async startScan(onDevice: (device: Device) => void): Promise<void> {
    const granted = await requestBlePermissions();
    if (!granted) throw new BlePermissionDeniedError();
    this.manager.startDeviceScan(null, null, (error, device) => {
      if (error || !device) return;
      onDevice(device);
    });
  }

  stopScan(): void {
    this.manager.stopDeviceScan();
  }

  // Connects to an already-discovered Device (e.g. one picked by hand from
  // startScan()'s results) and subscribes to its TX characteristic. Throws
  // if the device doesn't actually expose the Nordic UART Service -- a
  // real possibility once you're picking from an unfiltered list instead of
  // one pre-matched by name.
  async connectToDevice(device: Device): Promise<void> {
    let connected = await device.connect();
    await connected.discoverAllServicesAndCharacteristics();

    // 247 is Nordic's own recommended MTU for an nRF-based board (this is a
    // Nordic UART Service), giving ~244 usable bytes/packet instead of the
    // BLE default 23. Android-only -- iOS negotiates its own and this is a
    // no-op there, which is fine: send() below chunks to whatever
    // device.mtu actually ends up being either way, same as the reference
    // Python client (ble_client.py) does.
    try {
      connected = await connected.requestMTU(247);
    } catch {
      // iOS, or the board doesn't support a larger MTU -- send() falls
      // back to chunking at the default.
    }
    this.device = connected;
    this.intentionalDisconnect = false;

    // Fires for ANY disconnect -- range loss, the board power-cycling, the
    // board switching Wi-Fi on/off (which doesn't touch an already-connected
    // phone per PROTOCOL_GLASSES.md, but a real drop is still possible) --
    // not just ones we asked for. disconnect() below sets the flag first so
    // an intentional one doesn't also look like a connection we need to
    // recover from.
    connected.onDisconnected(() => {
      this.device = null;
      this.notifySub?.remove();
      this.notifySub = null;
      if (!this.intentionalDisconnect) {
        this.disconnectListeners.forEach((listener) => listener());
      }
      this.intentionalDisconnect = false;
    });

    this.notifySub = connected.monitorCharacteristicForService(
      NORDIC_UART_SERVICE_UUID,
      NORDIC_UART_TX_UUID,
      (error, characteristic) => {
        if (error || !characteristic?.value) return;
        this.rxBuffer += base64ToUtf8(characteristic.value);
        this.drainBuffer();
      }
    );
  }

  async connectByName(name: string, timeoutMs = 10000): Promise<void> {
    const granted = await requestBlePermissions();
    if (!granted) throw new BlePermissionDeniedError();

    const found = await this.scanForName(name, timeoutMs);
    await this.connectToDevice(found);
  }

  private scanForName(name: string, timeoutMs: number): Promise<Device> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        this.manager.stopDeviceScan();
        clearTimeout(timer);
        fn();
      };
      const timer = setTimeout(() => finish(() => reject(new DeviceNotFoundError(name))), timeoutMs);

      // Unfiltered, matched by name in code -- NOT filtered by service UUID.
      // This board doesn't advertise its GATT service UUID in the
      // advertisement packet (see startScan()'s own comment above), which
      // made a service-UUID-filtered scan simply never find it. Confirmed
      // directly: the Advanced section's manual "scan nearby, tap the
      // device" flow already does an unfiltered scan and connects reliably
      // every time, while this filtered one was the one actually failing.
      this.manager.startDeviceScan(null, null, (error, device) => {
        if (error) {
          finish(() => reject(error));
          return;
        }
        if (device && (device.name === name || device.localName === name)) {
          finish(() => resolve(device));
        }
      });
    });
  }

  private drainBuffer() {
    let newlineIndex: number;
    while ((newlineIndex = this.rxBuffer.indexOf("\n")) !== -1) {
      const line = this.rxBuffer.slice(0, newlineIndex);
      this.rxBuffer = this.rxBuffer.slice(newlineIndex + 1);
      if (!line.trim()) continue;
      try {
        const message = JSON.parse(line) as Record<string, unknown>;
        this.messageListeners.forEach((listener) => listener(message));
      } catch {
        // Per both specs: a line that doesn't parse is silently dropped,
        // not a fatal error -- the board may be mid-chunk or sending noise.
      }
    }
  }

  onMessage(listener: (message: Record<string, unknown>) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  // Fires only for a disconnect this side didn't ask for -- see the
  // intentionalDisconnect flag in connectToDevice()/disconnect().
  onDisconnect(listener: () => void): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  // Chunks to the negotiated MTU, matching the reference Python client
  // (ble_client.py: `size = max(20, (c.mtu_size or 23) - 3)`). The default
  // BLE MTU is only 23 bytes -- a single unchunked write of a `wifi`
  // command (ssid+key) is already bigger than that, so without this a
  // write can silently truncate or fail depending on the BLE stack. Splits
  // at the raw byte level (never mid-UTF8-character), same as the receive
  // side already reassembles chunks before decoding.
  async send(payload: Record<string, unknown>): Promise<void> {
    if (!this.device) throw new Error("NordicUartLink: not connected");
    const bytes = new TextEncoder().encode(`${JSON.stringify(payload)}\n`);
    const chunkSize = Math.max(20, (this.device.mtu || 23) - 3);

    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.slice(i, i + chunkSize);
      await this.device.writeCharacteristicWithResponseForService(
        NORDIC_UART_SERVICE_UUID,
        NORDIC_UART_RX_UUID,
        bytesToBase64(chunk)
      );
    }
  }

  get isConnected(): boolean {
    return this.device !== null;
  }

  async disconnect(): Promise<void> {
    this.intentionalDisconnect = true;
    this.notifySub?.remove();
    this.notifySub = null;
    await this.device?.cancelConnection().catch(() => undefined);
    this.device = null;
    this.rxBuffer = "";
  }

  destroy() {
    this.notifySub?.remove();
    this.manager.destroy();
  }
}

export { BleError };
