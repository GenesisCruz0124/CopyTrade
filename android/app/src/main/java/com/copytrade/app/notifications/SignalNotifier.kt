package com.copytrade.app.notifications

import android.Manifest
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.copytrade.app.CopyTradeApp
import com.copytrade.app.MainActivity
import com.copytrade.app.R
import com.copytrade.app.data.remote.dto.CopySignalDto
import com.copytrade.app.ui.navigation.Screen
import kotlinx.coroutines.flow.first
import java.util.Locale

const val COPY_SIGNALS_NOTIFICATION_CHANNEL_ID = "copy_signals"

/** Intent extra carrying the in-app route to open when a notification is tapped. */
const val EXTRA_NAV_ROUTE = "nav_route"

/** Checks for new PENDING copy signals not yet seen and raises a system notification
 *  for each one. Called on a loop by SignalPollingService, which keeps this running
 *  even while the app is closed — a plain suspend function rather than a
 *  ViewModel/Composable so the service can drive it directly. */
suspend fun pollForNewSignals(app: CopyTradeApp) {
    val settings = app.settingsRepository
    if (!settings.isConfigured() || !settings.notificationsEnabled.first()) return

    val url = settings.serverUrl.first() ?: return
    val pending = try {
        app.repositoryFor(url).getCopySignals("PENDING")
    } catch (e: Exception) {
        return
    }

    val notifiedIds = settings.notifiedSignalIds.first()
    val newSignals = pending.filter { it.id !in notifiedIds }
    newSignals.forEach { notifyNewSignal(app, it) }

    settings.setNotifiedSignalIds(pending.map { it.id }.toSet())
}

private fun buildSignalNotification(context: Context, signal: CopySignalDto): android.app.Notification {
    val openAppIntent = Intent(context, MainActivity::class.java).apply {
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        // Tapping the notification should land on the Copy signals page.
        putExtra(EXTRA_NAV_ROUTE, Screen.CopySignals.route)
    }
    val pendingIntent = PendingIntent.getActivity(
        context,
        signal.id.hashCode(),
        openAppIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    val symbol = signal.symbol ?: "?"
    val side = signal.side?.uppercase(Locale.US) ?: "?"
    val body = buildString {
        append("$symbol · $side")
        signal.leverage?.let { append(" · ${it.toInt()}x") }
    }

    return NotificationCompat.Builder(context, COPY_SIGNALS_NOTIFICATION_CHANNEL_ID)
        .setSmallIcon(R.drawable.ic_launcher_foreground)
        .setContentTitle("New Discord signal")
        .setContentText(body)
        .setPriority(NotificationCompat.PRIORITY_HIGH)
        .setAutoCancel(true)
        .setContentIntent(pendingIntent)
        .build()
}

/** Shows a system notification for [signal]. No-op if the POST_NOTIFICATIONS permission hasn't been granted. */
fun notifyNewSignal(context: Context, signal: CopySignalDto) {
    if (ActivityCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
        return
    }
    NotificationManagerCompat.from(context).notify(signal.id.hashCode(), buildSignalNotification(context, signal))
}
