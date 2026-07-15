package com.copytrade.app.notifications

import android.Manifest
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.compose.runtime.Composable
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.copytrade.app.MainActivity
import com.copytrade.app.R
import com.copytrade.app.data.remote.dto.CopySignalDto
import com.copytrade.app.ui.appViewModel
import com.copytrade.app.ui.components.PollWhileForeground
import java.util.Locale

const val COPY_SIGNALS_NOTIFICATION_CHANNEL_ID = "copy_signals"

/** Polls for new PENDING copy signals every 10s, independent of the current screen, and raises a system notification for each one not yet seen. */
@Composable
fun SignalNotificationWatcher() {
    val viewModel = appViewModel { SignalNotificationViewModel(it) }
    PollWhileForeground { viewModel.pollForNewSignals() }
}

private fun buildSignalNotification(context: Context, signal: CopySignalDto): android.app.Notification {
    val openAppIntent = Intent(context, MainActivity::class.java).apply {
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
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
