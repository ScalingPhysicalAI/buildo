// The handful of values that come from the board's BLE firmware, not from
// app code. Everything here is a placeholder until zaid confirms the real
// GATT layout -- deliberately centralized so there's exactly one place to
// update, and a loud runtime failure instead of a silent wrong connection if
// someone wires up ble-provisioning.ts before these are real.
export const GLASSES_BLE_CONTRACT = {
  // Service UUID the board advertises / exposes for WiFi provisioning.
  serviceUuid: "00000000-0000-0000-0000-000000000000",
  // Characteristic the app writes {ssid, password} to.
  wifiCredentialsCharacteristicUuid: "00000000-0000-0000-0000-000000000000",
  // Prefix/substring to match against the advertised device name while scanning.
  deviceNamePrefix: "REPLACE_ME",
  // How the app should encode the credentials payload before writing it.
  payloadEncoding: "json-utf8" as const,
};

const PLACEHOLDER_UUID = "00000000-0000-0000-0000-000000000000";

export function assertBleContractConfigured(): void {
  if (
    GLASSES_BLE_CONTRACT.serviceUuid === PLACEHOLDER_UUID ||
    GLASSES_BLE_CONTRACT.wifiCredentialsCharacteristicUuid === PLACEHOLDER_UUID ||
    GLASSES_BLE_CONTRACT.deviceNamePrefix === "REPLACE_ME"
  ) {
    throw new Error(
      "GLASSES_BLE_CONTRACT is still a placeholder -- fill in the real service/characteristic UUIDs " +
        "and device name from the board's BLE firmware (src/lib/glasses/ble-contract.ts) before pairing."
    );
  }
}
