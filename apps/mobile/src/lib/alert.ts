// A themed drop-in replacement for React Native's own Alert.alert, which
// renders an unstylable native OS dialog -- wrong font, wrong colors, looks
// nothing like the rest of the app. Same call signature as the real thing
// (title, message?, buttons?), so every call site just swaps its import
// from "react-native" to here; nothing else about the call changes.

export interface AlertButtonSpec {
  text: string;
  style?: "default" | "cancel" | "destructive";
  onPress?: () => void;
}

type Listener = (title: string, message?: string, buttons?: AlertButtonSpec[]) => void;

let listener: Listener | null = null;

export function registerAlertHost(fn: Listener | null) {
  listener = fn;
}

export const Alert = {
  alert(title: string, message?: string, buttons?: AlertButtonSpec[]) {
    if (!listener) {
      console.warn("[alert] AlertHost isn't mounted yet:", title);
      return;
    }
    listener(title, message, buttons);
  },
};
