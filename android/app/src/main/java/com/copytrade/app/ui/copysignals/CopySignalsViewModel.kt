package com.copytrade.app.ui.copysignals

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.copytrade.app.CopyTradeApp
import com.copytrade.app.data.remote.toUserMessage
import com.copytrade.app.data.remote.dto.CopySignalDto
import com.copytrade.app.ui.futures.FuturesPrefill
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

data class CopySignalsUiState(
    val signals: List<CopySignalDto> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null
)

class CopySignalsViewModel(private val app: CopyTradeApp) : ViewModel() {
    private val _uiState = MutableStateFlow(CopySignalsUiState())
    val uiState: StateFlow<CopySignalsUiState> = _uiState.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            try {
                val url = app.settingsRepository.serverUrl.first() ?: return@launch
                val repo = app.repositoryFor(url)
                val signals = repo.getCopySignals("PENDING")
                _uiState.value = _uiState.value.copy(signals = signals, isLoading = false)
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(isLoading = false, error = e.toUserMessage())
            }
        }
    }

    /**
     * Whether a signal can be copied into the Futures form: it must have a
     * symbol and side, and must not have already been invalidated (price already
     * through its SL/TP). "unknown"/"valid"/null price checks are all allowed.
     */
    fun canCopyToFutures(signal: CopySignalDto): Boolean {
        if (signal.symbol.isNullOrBlank() || signal.side.isNullOrBlank()) return false
        return signal.priceCheck != "tp_hit" && signal.priceCheck != "sl_hit"
    }

    /**
     * Persist the signal's parameters as a one-shot Futures prefill so the
     * Futures screen opens pre-populated. Does NOT execute anything — the user
     * sets size/risk and places the order themselves. Returns true if the
     * prefill was stored (caller then navigates to Futures).
     */
    suspend fun prepareFuturesHandoff(signal: CopySignalDto): Boolean {
        if (!canCopyToFutures(signal)) return false
        val prefill = FuturesPrefill(
            symbol = signal.symbol!!,
            side = signal.side!!,
            leverage = signal.leverage?.toInt(),
            entryPrice = signal.entryPrice,
            stopLoss = signal.stopLoss,
            takeProfit = signal.takeProfit
        )
        app.settingsRepository.setFuturesPrefill(prefill.toJson())
        return true
    }

    fun reject(id: String) {
        viewModelScope.launch {
            try {
                val url = app.settingsRepository.serverUrl.first() ?: return@launch
                app.repositoryFor(url).rejectCopySignal(id)
                refresh()
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(error = e.toUserMessage())
            }
        }
    }
}
