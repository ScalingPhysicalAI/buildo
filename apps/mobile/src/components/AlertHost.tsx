import { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { registerAlertHost, type AlertButtonSpec } from "../lib/alert";
import { colors, fonts, radii, spacing } from "../theme";

interface AlertState {
  title: string;
  message?: string;
  buttons: AlertButtonSpec[];
}

export function AlertHost() {
  const [state, setState] = useState<AlertState | null>(null);

  useEffect(() => {
    registerAlertHost((title, message, buttons) => {
      setState({ title, message, buttons: buttons && buttons.length > 0 ? buttons : [{ text: "OK" }] });
    });
    return () => registerAlertHost(null);
  }, []);

  function handlePress(button: AlertButtonSpec) {
    setState(null);
    button.onPress?.();
  }

  return (
    <Modal visible={!!state} transparent animationType="fade" onRequestClose={() => setState(null)}>
      <Pressable style={styles.backdrop} onPress={() => setState(null)}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>{state?.title}</Text>
          {state?.message ? <Text style={styles.message}>{state.message}</Text> : null}

          <View style={styles.buttonStack}>
            {state?.buttons.map((button, i) => {
              const variant = button.style ?? "default";
              return (
                <Pressable
                  key={`${button.text}-${i}`}
                  onPress={() => handlePress(button)}
                  style={({ pressed }) => [
                    styles.button,
                    variant === "destructive" && styles.buttonDestructive,
                    variant === "cancel" && styles.buttonCancel,
                    pressed && styles.buttonPressed,
                  ]}
                >
                  <Text
                    style={[
                      styles.buttonText,
                      variant === "destructive" && styles.buttonTextDestructive,
                      variant === "cancel" && styles.buttonTextCancel,
                    ]}
                  >
                    {button.text}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(26,23,18,0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  title: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 17,
    color: colors.black,
    textAlign: "center",
  },
  message: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: "center",
    marginTop: spacing.xs,
    lineHeight: 20,
  },
  buttonStack: {
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  button: {
    backgroundColor: colors.black,
    borderRadius: radii.pill,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonCancel: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
  },
  buttonDestructive: {
    backgroundColor: colors.error,
  },
  buttonText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
    color: colors.white,
  },
  buttonTextCancel: {
    color: colors.textPrimary,
  },
  buttonTextDestructive: {
    color: colors.white,
  },
});
