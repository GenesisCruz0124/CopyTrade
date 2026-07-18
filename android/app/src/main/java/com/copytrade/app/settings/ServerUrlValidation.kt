package com.copytrade.app.settings

import com.copytrade.app.BuildConfig

/**
 * Release builds must connect over HTTPS — the app talks to MEXC keys and
 * passwords over this connection, and usesCleartextTraffic is disabled in the
 * release manifest, so a plain http:// URL would just fail with a low-level
 * network exception. Validating here first gives a clear, actionable message
 * instead. Debug builds allow http:// for local/emulator testing, matching
 * the debug-only manifest override (src/debug/AndroidManifest.xml).
 */
fun isServerUrlSecure(url: String): Boolean {
    if (BuildConfig.DEBUG) return true
    return url.trim().startsWith("https://", ignoreCase = true)
}
