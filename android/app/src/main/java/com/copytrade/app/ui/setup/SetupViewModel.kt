package com.copytrade.app.ui.setup

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.copytrade.app.CopyTradeApp
import com.copytrade.app.data.remote.buildApiService
import com.copytrade.app.notifications.SignalPollingService
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

sealed interface ConnectionTestState {
    data object Idle : ConnectionTestState
    data object Testing : ConnectionTestState
    data object Success : ConnectionTestState
    data object Failure : ConnectionTestState
}

class SetupViewModel(private val app: CopyTradeApp) : ViewModel() {

    var serverUrl = MutableStateFlow("")
        private set
    var token = MutableStateFlow("")
        private set

    private val _testState = MutableStateFlow<ConnectionTestState>(ConnectionTestState.Idle)
    val testState: StateFlow<ConnectionTestState> = _testState.asStateFlow()

    fun onServerUrlChanged(value: String) {
        serverUrl.value = value
        _testState.value = ConnectionTestState.Idle
    }

    fun onTokenChanged(value: String) {
        token.value = value
        _testState.value = ConnectionTestState.Idle
    }

    fun testConnection() {
        viewModelScope.launch {
            _testState.value = ConnectionTestState.Testing
            _testState.value = try {
                app.settingsRepository.setAuthToken(token.value.trim())
                val api = buildApiService(serverUrl.value.trim(), app.settingsRepository)
                api.getStatus()
                ConnectionTestState.Success
            } catch (e: Exception) {
                ConnectionTestState.Failure
            }
        }
    }

    fun saveAndContinue(onDone: () -> Unit) {
        viewModelScope.launch {
            app.settingsRepository.setServerUrl(serverUrl.value.trim())
            app.settingsRepository.setAuthToken(token.value.trim())
            if (app.settingsRepository.notificationsEnabled.first()) {
                SignalPollingService.start(app)
            }
            onDone()
        }
    }
}
