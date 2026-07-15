package com.copytrade.app.ui.futures

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.copytrade.app.CopyTradeApp
import com.copytrade.app.data.remote.dto.FuturesBalanceDto
import com.copytrade.app.data.remote.dto.FuturesPositionDto
import com.copytrade.app.data.remote.dto.FuturesSymbolDto
import com.copytrade.app.data.remote.dto.OpenFuturesPositionRequest
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

enum class SizingMode { USD, PERCENT }

data class FuturesUiState(
    val mode: String = "paper",
    val symbols: List<FuturesSymbolDto> = emptyList(),
    val symbolQuery: String = "",
    val selectedSymbol: String = "",
    val side: String = "long",
    val leverage: String = "5",
    val openType: String = "isolated",
    val sizingMode: SizingMode = SizingMode.USD,
    val amountUsd: String = "",
    val percentOfBalance: String = "",
    val takeProfitPercent: String = "",
    val stopLossPercent: String = "",
    val balance: FuturesBalanceDto? = null,
    val positions: List<FuturesPositionDto> = emptyList(),
    val isSubmitting: Boolean = false,
    val isLoading: Boolean = false,
    val confirmLive: Boolean = false,
    val error: String? = null,
    val notConfigured: Boolean = false,
    val opened: Boolean = false
)

class FuturesViewModel(private val app: CopyTradeApp) : ViewModel() {
    private val _uiState = MutableStateFlow(FuturesUiState())
    val uiState: StateFlow<FuturesUiState> = _uiState.asStateFlow()

    init {
        loadSymbols()
        refresh()
    }

    private fun loadSymbols() {
        viewModelScope.launch {
            try {
                val url = app.settingsRepository.serverUrl.first() ?: return@launch
                val symbols = app.repositoryFor(url).getFuturesSymbols()
                _uiState.value = _uiState.value.copy(symbols = symbols, notConfigured = symbols.isEmpty())
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(error = e.message)
            }
        }
    }

    fun refresh() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true)
            try {
                val url = app.settingsRepository.serverUrl.first() ?: return@launch
                val repo = app.repositoryFor(url)
                val status = repo.getStatus()
                val balance = runCatching { repo.getFuturesBalance() }.getOrNull()
                val positions = runCatching { repo.getFuturesPositions() }.getOrDefault(emptyList())
                _uiState.value = _uiState.value.copy(
                    mode = status.mode,
                    balance = balance,
                    positions = positions,
                    isLoading = false
                )
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(isLoading = false, error = e.message)
            }
        }
    }

    fun setSymbolQuery(query: String) {
        _uiState.value = _uiState.value.copy(symbolQuery = query)
    }

    fun selectSymbol(symbol: String) {
        _uiState.value = _uiState.value.copy(selectedSymbol = symbol, symbolQuery = symbol)
    }

    fun setSide(side: String) {
        _uiState.value = _uiState.value.copy(side = side)
    }

    fun setLeverage(v: String) {
        _uiState.value = _uiState.value.copy(leverage = v)
    }

    fun setOpenType(v: String) {
        _uiState.value = _uiState.value.copy(openType = v)
    }

    fun setSizingMode(mode: SizingMode) {
        _uiState.value = _uiState.value.copy(sizingMode = mode)
    }

    fun setAmountUsd(v: String) {
        _uiState.value = _uiState.value.copy(amountUsd = v)
    }

    fun setPercentOfBalance(v: String) {
        _uiState.value = _uiState.value.copy(percentOfBalance = v)
    }

    fun setTakeProfitPercent(v: String) {
        _uiState.value = _uiState.value.copy(takeProfitPercent = v)
    }

    fun setStopLossPercent(v: String) {
        _uiState.value = _uiState.value.copy(stopLossPercent = v)
    }

    fun setConfirmLive(v: Boolean) {
        _uiState.value = _uiState.value.copy(confirmLive = v)
    }

    fun openPosition() {
        val state = _uiState.value
        if (state.selectedSymbol.isBlank()) {
            _uiState.value = state.copy(error = "Select a token pair first")
            return
        }
        val leverage = state.leverage.toDoubleOrNull()
        if (leverage == null || leverage <= 0) {
            _uiState.value = state.copy(error = "Enter a valid leverage")
            return
        }
        val amountUsd = state.amountUsd.toDoubleOrNull()
        val percent = state.percentOfBalance.toDoubleOrNull()
        if (state.sizingMode == SizingMode.USD && (amountUsd == null || amountUsd <= 0)) {
            _uiState.value = state.copy(error = "Enter a valid USD amount")
            return
        }
        if (state.sizingMode == SizingMode.PERCENT && (percent == null || percent <= 0 || percent > 100)) {
            _uiState.value = state.copy(error = "Enter a valid percentage (1-100)")
            return
        }

        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isSubmitting = true, error = null, opened = false)
            try {
                val url = app.settingsRepository.serverUrl.first() ?: return@launch
                val request = OpenFuturesPositionRequest(
                    symbol = state.selectedSymbol,
                    side = state.side,
                    leverage = leverage,
                    openType = state.openType,
                    amountUsd = if (state.sizingMode == SizingMode.USD) amountUsd else null,
                    percentOfBalance = if (state.sizingMode == SizingMode.PERCENT) percent else null,
                    takeProfitPercent = state.takeProfitPercent.toDoubleOrNull(),
                    stopLossPercent = state.stopLossPercent.toDoubleOrNull(),
                    confirmLive = state.confirmLive
                )
                app.repositoryFor(url).openFuturesPosition(request)
                _uiState.value = _uiState.value.copy(isSubmitting = false, opened = true)
                refresh()
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(isSubmitting = false, error = e.message)
            }
        }
    }

    fun closePosition(id: String) {
        viewModelScope.launch {
            try {
                val url = app.settingsRepository.serverUrl.first() ?: return@launch
                app.repositoryFor(url).closeFuturesPosition(id)
                refresh()
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(error = e.message)
            }
        }
    }

    fun consumeOpened() {
        _uiState.value = _uiState.value.copy(opened = false)
    }
}
