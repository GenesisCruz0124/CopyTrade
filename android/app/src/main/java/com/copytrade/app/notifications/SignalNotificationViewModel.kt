package com.copytrade.app.notifications

import androidx.lifecycle.ViewModel
import com.copytrade.app.CopyTradeApp
import kotlinx.coroutines.flow.first

class SignalNotificationViewModel(private val app: CopyTradeApp) : ViewModel() {

    suspend fun pollForNewSignals() {
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
}
