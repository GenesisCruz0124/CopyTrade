package com.copytrade.app.notifications

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.copytrade.app.CopyTradeApp
import com.copytrade.app.MainActivity
import com.copytrade.app.R
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

const val SIGNAL_POLLING_NOTIFICATION_CHANNEL_ID = "signal_polling_status"
private const val STATUS_NOTIFICATION_ID = 1001
private const val POLL_INTERVAL_MS = 10_000L

/**
 * Foreground service that keeps polling for new Discord copy signals even while
 * the app is closed or backgrounded — PollWhileForeground-driven polling (used
 * elsewhere in the app) stops the moment the app leaves the STARTED lifecycle
 * state, which is why notifications previously only fired while the app was open.
 * Shows a low-importance, silent, persistent notification while active, as
 * Android requires for any foreground service.
 */
class SignalPollingService : Service() {
    private val scope = CoroutineScope(Dispatchers.IO + Job())

    override fun onCreate() {
        super.onCreate()
        startForeground(STATUS_NOTIFICATION_ID, buildStatusNotification())
        scope.launch {
            val app = application as CopyTradeApp
            while (true) {
                val settings = app.settingsRepository
                if (!settings.isConfigured() || !settings.notificationsEnabled.first()) {
                    stopSelf()
                    return@launch
                }
                pollForNewSignals(app)
                delay(POLL_INTERVAL_MS)
            }
        }
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun buildStatusNotification(): Notification {
        val openAppIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            openAppIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, SIGNAL_POLLING_NOTIFICATION_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle("CopyTrade")
            .setContentText("Watching for new Discord signals")
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setContentIntent(pendingIntent)
            .build()
    }

    companion object {
        /** No-op if already running — Android coalesces repeated start calls to the same service. */
        fun start(context: Context) {
            ContextCompat.startForegroundService(context, Intent(context, SignalPollingService::class.java))
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, SignalPollingService::class.java))
        }
    }
}
