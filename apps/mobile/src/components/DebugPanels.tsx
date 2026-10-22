// Section/Row used by the Debug screen's diagnostic panels, extracted out
// so the Skills recording screen can show the exact same "Live video"/"Live
// state" blocks -- not a re-typed copy that can drift, the same component.
import { StyleSheet, Text, View } from "react-native";

import { Card } from "./Card";
import type { SessionState } from "../lib/glasses/glasses-session";
import { colors, fonts, spacing } from "../theme";

export const STATE_LABEL: Record<SessionState, string> = {
  idle: "Not started",
  connecting_ble: "Connecting over Bluetooth…",
  ble_ready: "Connected (Bluetooth only, idle)",
  ble_disconnected: "Disconnected (manual) -- press Connect BLE",
  starting_wifi: "Starting Wi-Fi…",
  recording: "Recording (Wi-Fi active)",
  stopping: "Stopping…",
};

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </Card>
  );
}

export function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text selectable style={styles.rowValue}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: spacing.md,
  },
  sectionTitle: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
    color: colors.textPrimary,
    marginBottom: 4,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  rowLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.textMuted,
  },
  rowValue: {
    flex: 1,
    textAlign: "right",
    fontFamily: fonts.technical,
    fontSize: 12,
    color: colors.textPrimary,
  },
});
