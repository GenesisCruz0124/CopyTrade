package com.copytrade.app.ui.account

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.copytrade.app.CopyTradeApp
import com.copytrade.app.data.remote.dto.ExchangeKeysRequest
import com.copytrade.app.data.remote.dto.TradingModeRequest
import com.copytrade.app.data.remote.dto.UserDto
import com.copytrade.app.data.remote.toUserMessage
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

data class AccountUiState(
    val isLoading: Boolean = true,
    /** Null after loading = connected with the legacy/admin token, not a per-user account. */
    val user: UserDto? = null,
    val mexcApiKey: String = "",
    val mexcApiSecret: String = "",
    val mexcFuturesAccessKey: String = "",
    val mexcFuturesSecretKey: String = "",
    val isSavingKeys: Boolean = false,
    val isUpdatingMode: Boolean = false,
    val error: String? = null,
    val keysSaved: Boolean = false
)

class AccountViewModel(private val app: CopyTradeApp) : ViewModel() {
    private val _uiState = MutableStateFlow(AccountUiState())
    val uiState: StateFlow<AccountUiState> = _uiState.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            try {
                val url = app.settingsRepository.serverUrl.first() ?: return@launch
                val user = app.repositoryFor(url).getMe()
                _uiState.value = _uiState.value.copy(isLoading = false, user = user)
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(isLoading = false, error = e.toUserMessage())
            }
        }
    }

    fun onMexcApiKeyChanged(value: String) {
        _uiState.value = _uiState.value.copy(mexcApiKey = value, keysSaved = false)
    }

    fun onMexcApiSecretChanged(value: String) {
        _uiState.value = _uiState.value.copy(mexcApiSecret = value, keysSaved = false)
    }

    fun onMexcFuturesAccessKeyChanged(value: String) {
        _uiState.value = _uiState.value.copy(mexcFuturesAccessKey = value, keysSaved = false)
    }

    fun onMexcFuturesSecretKeyChanged(value: String) {
        _uiState.value = _uiState.value.copy(mexcFuturesSecretKey = value, keysSaved = false)
    }

    /** Blank fields are left at their (omitted) default — the engine keeps the existing key for those. */
    fun saveKeys() {
        viewModelScope.launch {
            val state = _uiState.value
            _uiState.value = state.copy(isSavingKeys = true, error = null)
            try {
                val url = app.settingsRepository.serverUrl.first() ?: return@launch
                val user = app.repositoryFor(url).updateExchangeKeys(
                    ExchangeKeysRequest(
                        mexcApiKey = state.mexcApiKey.trim().ifBlank { null },
                        mexcApiSecret = state.mexcApiSecret.trim().ifBlank { null },
                        mexcFuturesAccessKey = state.mexcFuturesAccessKey.trim().ifBlank { null },
                        mexcFuturesSecretKey = state.mexcFuturesSecretKey.trim().ifBlank { null }
                    )
                )
                _uiState.value = _uiState.value.copy(
                    isSavingKeys = false,
                    user = user,
                    mexcApiKey = "",
                    mexcApiSecret = "",
                    mexcFuturesAccessKey = "",
                    mexcFuturesSecretKey = "",
                    keysSaved = true
                )
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(isSavingKeys = false, error = e.toUserMessage())
            }
        }
    }

    fun setTradingMode(live: Boolean) = updateMode(TradingModeRequest(tradingMode = if (live) "live" else "paper"))

    fun setFuturesTradingMode(live: Boolean) =
        updateMode(TradingModeRequest(futuresTradingMode = if (live) "live" else "paper"))

    private fun updateMode(request: TradingModeRequest) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isUpdatingMode = true, error = null)
            try {
                val url = app.settingsRepository.serverUrl.first() ?: return@launch
                val user = app.repositoryFor(url).updateTradingMode(request)
                _uiState.value = _uiState.value.copy(isUpdatingMode = false, user = user)
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(isUpdatingMode = false, error = e.toUserMessage())
            }
        }
    }
}
