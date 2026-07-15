package com.copytrade.app.ui.signals

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.copytrade.app.CopyTradeApp
import com.copytrade.app.data.remote.dto.SignalDto
import com.copytrade.app.data.remote.toUserMessage
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

/** Kline intervals the engine accepts, offered as selectable chips. */
val SIGNAL_INTERVALS = listOf("5m", "15m", "1h", "4h")

data class SignalsUiState(
    val mode: String = "paper",
    val symbolQuery: String = "",
    val interval: String = "15m",
    val signal: SignalDto? = null,
    val isLoading: Boolean = false,
    val error: String? = null
)

class SignalsViewModel(private val app: CopyTradeApp) : ViewModel() {
    private val _uiState = MutableStateFlow(SignalsUiState())
    val uiState: StateFlow<SignalsUiState> = _uiState.asStateFlow()

    init {
        // Seed the pair from the last futures symbol so the two screens feel linked.
        viewModelScope.launch {
            val symbol = app.settingsRepository.futuresSymbol.first()
            if (symbol.isNotBlank()) {
                _uiState.value = _uiState.value.copy(symbolQuery = symbol)
            }
        }
    }

    fun setSymbolQuery(query: String) {
        _uiState.value = _uiState.value.copy(symbolQuery = query.uppercase().trim())
    }

    fun setInterval(interval: String) {
        _uiState.value = _uiState.value.copy(interval = interval)
        if (_uiState.value.symbolQuery.isNotBlank()) analyze()
    }

    fun analyze() {
        val symbol = _uiState.value.symbolQuery.trim().uppercase()
        val interval = _uiState.value.interval
        if (symbol.isBlank()) {
            _uiState.value = _uiState.value.copy(error = "Enter a coin pair, e.g. BTCUSDT")
            return
        }
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            try {
                val url = app.settingsRepository.serverUrl.first() ?: return@launch
                val signal = app.repositoryFor(url).getSignal(symbol, interval)
                _uiState.value = _uiState.value.copy(isLoading = false, signal = signal, error = null)
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(isLoading = false, error = e.toUserMessage())
            }
        }
    }

    /**
     * Persist the analyzed pair and direction so the Futures screen picks them up
     * on open. Returns the side ("long"/"short") to hand off, or null if the
     * current signal is NEUTRAL (nothing to trade).
     */
    suspend fun prepareTradeHandoff(): Boolean {
        val signal = _uiState.value.signal ?: return false
        val side = when (signal.signal) {
            "LONG" -> "long"
            "SHORT" -> "short"
            else -> return false
        }
        app.settingsRepository.setFuturesSymbol(signal.symbol)
        app.settingsRepository.setFuturesSide(side)
        return true
    }
}
