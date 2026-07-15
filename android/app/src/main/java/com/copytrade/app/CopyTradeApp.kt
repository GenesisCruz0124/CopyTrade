package com.copytrade.app

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import androidx.room.Room
import com.copytrade.app.data.local.AppDatabase
import com.copytrade.app.data.remote.ApiService
import com.copytrade.app.data.remote.buildApiService
import com.copytrade.app.data.repository.EngineRepository
import com.copytrade.app.notifications.COPY_SIGNALS_NOTIFICATION_CHANNEL_ID
import com.copytrade.app.settings.SettingsRepository
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking

/**
 * Simple hand-rolled service locator (no DI framework) exposing the
 * database, settings, and a repository that gets rebuilt whenever the
 * configured server URL changes.
 */
class CopyTradeApp : Application() {

    lateinit var database: AppDatabase
        private set
    lateinit var settingsRepository: SettingsRepository
        private set

    private var cachedRepository: EngineRepository? = null
    private var cachedBaseUrl: String? = null

    override fun onCreate() {
        super.onCreate()
        database = Room.databaseBuilder(this, AppDatabase::class.java, "copytrade.db").build()
        settingsRepository = SettingsRepository(this)
        createCopySignalsNotificationChannel()
    }

    private fun createCopySignalsNotificationChannel() {
        val channel = NotificationChannel(
            COPY_SIGNALS_NOTIFICATION_CHANNEL_ID,
            "Copy Signals",
            NotificationManager.IMPORTANCE_HIGH
        )
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    /** Rebuilds the Retrofit-backed repository if the server URL changed since the last call. */
    fun repositoryFor(baseUrl: String): EngineRepository {
        val cached = cachedRepository
        if (cached != null && cachedBaseUrl == baseUrl) return cached

        val api: ApiService = buildApiService(baseUrl, settingsRepository)
        val repository = EngineRepository(
            api = api,
            botDao = database.botDao(),
            fillDao = database.fillDao(),
            pnlDao = database.pnlDao(),
            eventDao = database.eventDao()
        )
        cachedRepository = repository
        cachedBaseUrl = baseUrl
        return repository
    }

    fun currentRepositoryBlocking(): EngineRepository? {
        val url = runBlocking { settingsRepository.serverUrl.first() } ?: return null
        return repositoryFor(url)
    }
}
