package com.copytrade.app.ui.setup

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.copytrade.app.CopyTradeApp
import com.copytrade.app.data.remote.buildApiService
import com.copytrade.app.data.remote.toUserMessage
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

enum class SetupMode { LOGIN, SIGN_UP, TOKEN }

sealed interface AuthState {
    data object Idle : AuthState
    data object Submitting : AuthState
    data class Failure(val message: String) : AuthState
}

class SetupViewModel(private val app: CopyTradeApp) : ViewModel() {

    var serverUrl = MutableStateFlow("")
        private set
    var token = MutableStateFlow("")
        private set
    var email = MutableStateFlow("")
        private set
    var password = MutableStateFlow("")
        private set

    private val _mode = MutableStateFlow(SetupMode.LOGIN)
    val mode: StateFlow<SetupMode> = _mode.asStateFlow()

    private val _testState = MutableStateFlow<ConnectionTestState>(ConnectionTestState.Idle)
    val testState: StateFlow<ConnectionTestState> = _testState.asStateFlow()

    private val _authState = MutableStateFlow<AuthState>(AuthState.Idle)
    val authState: StateFlow<AuthState> = _authState.asStateFlow()

    fun onModeChanged(value: SetupMode) {
        _mode.value = value
        _authState.value = AuthState.Idle
        _testState.value = ConnectionTestState.Idle
    }

    fun onServerUrlChanged(value: String) {
        serverUrl.value = value
        _testState.value = ConnectionTestState.Idle
    }

    fun onTokenChanged(value: String) {
        token.value = value
        _testState.value = ConnectionTestState.Idle
    }

    fun onEmailChanged(value: String) {
        email.value = value
        _authState.value = AuthState.Idle
    }

    fun onPasswordChanged(value: String) {
        password.value = value
        _authState.value = AuthState.Idle
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
            finishSetup(onDone)
        }
    }

    /** Shared by log-in and sign-up: both end with a per-user apiToken saved as the bearer token. */
    fun submitAuth(onDone: () -> Unit) {
        viewModelScope.launch {
            _authState.value = AuthState.Submitting
            try {
                val url = serverUrl.value.trim()
                app.settingsRepository.setServerUrl(url)
                val repo = app.repositoryFor(url)
                val user = if (_mode.value == SetupMode.SIGN_UP) {
                    repo.register(email.value.trim(), password.value)
                } else {
                    repo.login(email.value.trim(), password.value)
                }
                app.settingsRepository.setAuthToken(user.apiToken)
                _authState.value = AuthState.Idle
                finishSetup(onDone)
            } catch (e: Exception) {
                _authState.value = AuthState.Failure(e.toUserMessage())
            }
        }
    }

    private suspend fun finishSetup(onDone: () -> Unit) {
        if (app.settingsRepository.notificationsEnabled.first()) {
            SignalPollingService.start(app)
        }
        onDone()
    }
}
