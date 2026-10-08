package expo.modules.localhotspot

import android.content.Context
import android.location.LocationManager
import android.net.wifi.WifiManager
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.net.NetworkInterface
import java.util.Collections

// Android's local-only hotspot is the API meant for exactly this case: an app
// creating a short-lived, no-internet WiFi AP for a peer device to join (the
// same mechanism backing things like "connect to my wireless camera"). It is
// NOT the user-facing Personal Hotspot/tethering feature.
//
// Requires CHANGE_WIFI_STATE + ACCESS_WIFI_STATE (manifest) and
// ACCESS_FINE_LOCATION (runtime) -- the JS side is expected to have already
// requested ACCESS_FINE_LOCATION via PermissionsAndroid before calling
// startHotspot(); this module surfaces ERR_PERMISSION if it hasn't.
//
// Android only ever allows one LocalOnlyHotspot reservation system-wide at a
// time.
class LocalHotspotModule : Module() {
  private var reservation: WifiManager.LocalOnlyHotspotReservation? = null

  override fun definition() = ModuleDefinition {
    Name("LocalHotspot")

    AsyncFunction("startHotspot") { promise: expo.modules.kotlin.Promise ->
      startHotspot(promise)
    }

    AsyncFunction("stopHotspot") {
      reservation?.close()
      reservation = null
    }

    Function("isSupported") { true }
  }

  private fun startHotspot(promise: expo.modules.kotlin.Promise) {
    val context = appContext.reactContext?.applicationContext
    val wifiManager = context?.getSystemService(Context.WIFI_SERVICE) as? WifiManager

    if (wifiManager == null) {
      promise.reject("ERR_NO_WIFI_MANAGER", "WifiManager is unavailable on this device", null)
      return
    }

    // startLocalOnlyHotspot() throws SecurityException if system Location
    // Services is off -- even when ACCESS_FINE_LOCATION is granted. This is
    // the actual cause behind most "permission" failures users report after
    // already granting the app permission, so it's checked and reported
    // distinctly instead of lumping it in with a real permission denial.
    if (!isLocationServicesEnabled(context)) {
      promise.reject(
        "ERR_LOCATION_SERVICES_DISABLED",
        "Turn on Location in your phone's system settings (not just the app permission) -- Android requires it to be on to create a hotspot.",
        null
      )
      return
    }

    try {
      wifiManager.startLocalOnlyHotspot(
        object : WifiManager.LocalOnlyHotspotCallback() {
          override fun onStarted(res: WifiManager.LocalOnlyHotspotReservation) {
            reservation = res

            @Suppress("DEPRECATION")
            val config = res.wifiConfiguration
            val ssid = config?.SSID?.trim('"') ?: ""
            val password = config?.preSharedKey?.trim('"') ?: ""

            promise.resolve(
              mapOf(
                "ssid" to ssid,
                "password" to password,
                "gatewayIp" to findGatewayIp()
              )
            )
          }

          override fun onStopped() {
            reservation = null
          }

          override fun onFailed(reason: Int) {
            reservation = null
            promise.reject("ERR_HOTSPOT_FAILED", "startLocalOnlyHotspot failed, reason=$reason", null)
          }
        },
        null
      )
    } catch (e: SecurityException) {
      promise.reject("ERR_PERMISSION", "ACCESS_FINE_LOCATION permission is required before starting the hotspot", e)
    }
  }

  private fun isLocationServicesEnabled(context: Context?): Boolean {
    if (context == null) return false
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      val locationManager = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
      locationManager?.isLocationEnabled ?: false
    } else {
      @Suppress("DEPRECATION")
      val mode = Settings.Secure.getInt(context.contentResolver, Settings.Secure.LOCATION_MODE, Settings.Secure.LOCATION_MODE_OFF)
      mode != Settings.Secure.LOCATION_MODE_OFF
    }
  }

  // LocalOnlyHotspot has no official "get my gateway IP" accessor. The
  // interface it creates is conventionally 192.168.49.1 (the same range
  // WiFi Direct uses), but that has drifted on some OEM builds, so this
  // looks for the actual AP/P2P interface first and only falls back to the
  // documented default if nothing matches.
  private fun findGatewayIp(): String {
    val apInterfacePrefixes = listOf("ap", "wlan1", "swlan")
    try {
      for (iface in Collections.list(NetworkInterface.getNetworkInterfaces())) {
        val name = iface.name.lowercase()
        if (apInterfacePrefixes.none { name.startsWith(it) }) continue
        for (addr in Collections.list(iface.inetAddresses)) {
          if (!addr.isLoopbackAddress && addr.hostAddress?.contains(":") == false) {
            return addr.hostAddress ?: DEFAULT_GATEWAY_IP
          }
        }
      }
    } catch (_: Exception) {
      // fall through to default
    }
    return DEFAULT_GATEWAY_IP
  }

  companion object {
    private const val DEFAULT_GATEWAY_IP = "192.168.49.1"
  }
}
