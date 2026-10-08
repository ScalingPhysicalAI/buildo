// Hands the phone's freshly-created hotspot credentials to the glasses over
// BLE, so the board can join that WiFi network and proceed exactly as
// "Glasses Integration: Packet Spec" already describes (TCP client to the
// phone's 5005/5006 listeners). The scan/connect/write mechanics here are
// real and self-contained; the actual service/characteristic UUIDs and
// device name come from ble-contract.ts and are still placeholders -- see
// assertBleContractConfigured().
import { PermissionsAndroid, Platform } from "react-native";
import { BleError, BleManager, type Device } from "react-native-ble-plx";

import { assertBleContractConfigured, GLASSES_BLE_CONTRACT } from "./ble-contract";
import type { LocalHotspotReservation } from "./hotspot";

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

function utf8ToBase64(value: string): string {
  return bytesToBase64(new TextEncoder().encode(value));
}

export class BlePermissionDeniedError extends Error {
  constructor() {
    super("Bluetooth/location permissions are required to pair the glasses.");
    this.name = "BlePermissionDeniedError";
  }
}

export class GlassesNotFoundError extends Error {
  constructor() {
    super("Timed out looking for the glasses over Bluetooth.");
    this.name = "GlassesNotFoundError";
  }
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

export class GlassesBleProvisioner {
  private manager = new BleManager();

  async findGlasses(timeoutMs = 10000): Promise<Device> {
    return new Promise((resolve, reject) => {
      let settled = false;

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        this.manager.stopDeviceScan();
        clearTimeout(timer);
        fn();
      };

      const timer = setTimeout(() => finish(() => reject(new GlassesNotFoundError())), timeoutMs);

      this.manager.startDeviceScan([GLASSES_BLE_CONTRACT.serviceUuid], null, (error, device) => {
        if (error) {
          finish(() => reject(error));
          return;
        }
        const name = device?.name ?? device?.localName ?? "";
        if (device && name.toLowerCase().includes(GLASSES_BLE_CONTRACT.deviceNamePrefix.toLowerCase())) {
          finish(() => resolve(device));
        }
      });
    });
  }

  async provision(hotspot: Pick<LocalHotspotReservation, "ssid" | "password">): Promise<void> {
    assertBleContractConfigured();

    const granted = await requestBlePermissions();
    if (!granted) throw new BlePermissionDeniedError();

    const device = await this.findGlasses();
    const connected = await device.connect();
    await connected.discoverAllServicesAndCharacteristics();

    const payload = utf8ToBase64(JSON.stringify({ ssid: hotspot.ssid, password: hotspot.password }));

    try {
      await connected.writeCharacteristicWithResponseForService(
        GLASSES_BLE_CONTRACT.serviceUuid,
        GLASSES_BLE_CONTRACT.wifiCredentialsCharacteristicUuid,
        payload
      );
    } finally {
      // The board takes it from here (joins the WiFi, opens TCP) -- nothing
      // more to say to it over BLE for this flow.
      await connected.cancelConnection().catch(() => undefined);
    }
  }

  destroy() {
    this.manager.destroy();
  }
}

export { BleError };
