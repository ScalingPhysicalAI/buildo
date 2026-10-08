import ExpoModulesCore

// No iOS equivalent exists -- Apple gives apps no API to stand up their own
// WiFi AP (Personal Hotspot is user-controlled only). Every method rejects
// or returns false so callers fail loudly instead of hanging.
public class LocalHotspotModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LocalHotspot")

    AsyncFunction("startHotspot") { () -> [String: String] in
      throw UnsupportedPlatformException()
    }

    AsyncFunction("stopHotspot") { () -> Void in }

    Function("isSupported") { () -> Bool in false }
  }
}

internal final class UnsupportedPlatformException: Exception {
  override var reason: String {
    "Local hotspot is Android-only; not supported on this platform."
  }
}
