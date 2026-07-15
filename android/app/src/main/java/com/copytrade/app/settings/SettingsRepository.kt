package com.copytrade.app.settings

import android.content.Context
import android.content.SharedPreferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.copytrade.app.ui.strings.AppLanguage
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore(name = "copytrade_settings")

/**
 * Server URL and language live in plain DataStore preferences; the bearer
 * token is sensitive and lives in EncryptedSharedPreferences (Tink-backed)
 * so it's never written to disk in plaintext or exposed to backups.
 */
class SettingsRepository(private val context: Context) {

    private val serverUrlKey = stringPreferencesKey("server_url")
    private val languageKey = stringPreferencesKey("language")
    private val futuresOpenTypeKey = stringPreferencesKey("futures_open_type")
    private val futuresSizingModeKey = stringPreferencesKey("futures_sizing_mode")
    private val futuresLeverageKey = stringPreferencesKey("futures_leverage")
    private val futuresSideKey = stringPreferencesKey("futures_side")
    private val futuresSymbolKey = stringPreferencesKey("futures_symbol")

    private val encryptedPrefs: SharedPreferences by lazy {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            "copytrade_secure_prefs",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    val serverUrl: Flow<String?> = context.dataStore.data.map { it[serverUrlKey] }
    val language: Flow<AppLanguage> = context.dataStore.data.map { prefs ->
        when (prefs[languageKey]) {
            "TAGLISH" -> AppLanguage.TAGLISH
            else -> AppLanguage.ENGLISH
        }
    }

    val authToken: String?
        get() = encryptedPrefs.getString(KEY_TOKEN, null)

    /** Last-used futures trading form selections, so isolated/cross, USD/percent sizing,
     *  leverage, and side survive an app restart instead of resetting to defaults each time. */
    val futuresOpenType: Flow<String> = context.dataStore.data.map { it[futuresOpenTypeKey] ?: "isolated" }
    val futuresSizingMode: Flow<String> = context.dataStore.data.map { it[futuresSizingModeKey] ?: "usd" }
    val futuresLeverage: Flow<String> = context.dataStore.data.map { it[futuresLeverageKey] ?: "5" }
    val futuresSide: Flow<String> = context.dataStore.data.map { it[futuresSideKey] ?: "long" }
    val futuresSymbol: Flow<String> = context.dataStore.data.map { it[futuresSymbolKey] ?: "" }

    suspend fun setServerUrl(url: String) {
        context.dataStore.edit { it[serverUrlKey] = url }
    }

    suspend fun setLanguage(language: AppLanguage) {
        context.dataStore.edit { it[languageKey] = language.name }
    }

    suspend fun setFuturesOpenType(openType: String) {
        context.dataStore.edit { it[futuresOpenTypeKey] = openType }
    }

    suspend fun setFuturesSizingMode(mode: String) {
        context.dataStore.edit { it[futuresSizingModeKey] = mode }
    }

    suspend fun setFuturesLeverage(leverage: String) {
        context.dataStore.edit { it[futuresLeverageKey] = leverage }
    }

    suspend fun setFuturesSide(side: String) {
        context.dataStore.edit { it[futuresSideKey] = side }
    }

    suspend fun setFuturesSymbol(symbol: String) {
        context.dataStore.edit { it[futuresSymbolKey] = symbol }
    }

    fun setAuthToken(token: String) {
        encryptedPrefs.edit().putString(KEY_TOKEN, token).apply()
    }

    fun clearAuthToken() {
        encryptedPrefs.edit().remove(KEY_TOKEN).apply()
    }

    suspend fun isConfigured(): Boolean {
        return serverUrl.first() != null && authToken != null
    }

    companion object {
        private const val KEY_TOKEN = "auth_token"
    }
}
