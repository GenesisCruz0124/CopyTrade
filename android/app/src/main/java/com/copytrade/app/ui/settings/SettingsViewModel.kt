package com.copytrade.app.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.copytrade.app.CopyTradeApp
import com.copytrade.app.ui.strings.AppLanguage
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

data class SettingsUiState(
    val serverUrl: String = "",
    val language: AppLanguage = AppLanguage.ENGLISH
)

class SettingsViewModel(private val app: CopyTradeApp) : ViewModel() {
    private val _uiState = MutableStateFlow(SettingsUiState())
    val uiState: StateFlow<SettingsUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            val url = app.settingsRepository.serverUrl.first() ?: ""
            val lang = app.settingsRepository.language.first()
            _uiState.value = SettingsUiState(serverUrl = url, language = lang)
        }
    }

    fun setLanguage(language: AppLanguage) {
        viewModelScope.launch {
            app.settingsRepository.setLanguage(language)
            _uiState.value = _uiState.value.copy(language = language)
        }
    }

    fun updateServerUrl(url: String) {
        viewModelScope.launch {
            app.settingsRepository.setServerUrl(url)
            _uiState.value = _uiState.value.copy(serverUrl = url)
        }
    }

    fun disconnect(onDisconnected: () -> Unit) {
        app.settingsRepository.clearAuthToken()
        onDisconnected()
    }
}
