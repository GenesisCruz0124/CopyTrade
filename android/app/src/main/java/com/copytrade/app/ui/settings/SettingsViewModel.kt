package com.copytrade.app.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.copytrade.app.CopyTradeApp
import com.copytrade.app.notifications.SignalPollingService
import com.copytrade.app.settings.isServerUrlSecure
import com.copytrade.app.ui.strings.AppLanguage
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

data class SettingsUiState(
    val serverUrl: String = "",
    val language: AppLanguage = AppLanguage.ENGLISH,
    val notificationsEnabled: Boolean = true,
    val insecureUrlError: Boolean = false
)

class SettingsViewModel(private val app: CopyTradeApp) : ViewModel() {
    private val _uiState = MutableStateFlow(SettingsUiState())
    val uiState: StateFlow<SettingsUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            val url = app.settingsRepository.serverUrl.first() ?: ""
            val lang = app.settingsRepository.language.first()
            val notificationsEnabled = app.settingsRepository.notificationsEnabled.first()
            _uiState.value = SettingsUiState(serverUrl = url, language = lang, notificationsEnabled = notificationsEnabled)
        }
    }

    fun setLanguage(language: AppLanguage) {
        viewModelScope.launch {
            app.settingsRepository.setLanguage(language)
            _uiState.value = _uiState.value.copy(language = language)
        }
    }

    fun setNotificationsEnabled(enabled: Boolean) {
        viewModelScope.launch {
            app.settingsRepository.setNotificationsEnabled(enabled)
            _uiState.value = _uiState.value.copy(notificationsEnabled = enabled)
            if (enabled) SignalPollingService.start(app) else SignalPollingService.stop(app)
        }
    }

    fun updateServerUrl(url: String) {
        if (!isServerUrlSecure(url)) {
            _uiState.value = _uiState.value.copy(serverUrl = url, insecureUrlError = true)
            return
        }
        viewModelScope.launch {
            app.settingsRepository.setServerUrl(url)
            _uiState.value = _uiState.value.copy(serverUrl = url, insecureUrlError = false)
        }
    }

    fun disconnect(onDisconnected: () -> Unit) {
        app.settingsRepository.clearAuthToken()
        SignalPollingService.stop(app)
        onDisconnected()
    }
}
