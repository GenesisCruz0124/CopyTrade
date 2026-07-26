package com.copytrade.app.ui.signals

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.copytrade.app.CopyTradeApp
import com.copytrade.app.data.remote.dto.KlineDto
import com.copytrade.app.data.remote.dto.SignalDto
import com.copytrade.app.data.remote.dto.SpotSymbolDto
import com.copytrade.app.data.remote.toUserMessage
import com.copytrade.app.ui.futures.FuturesPrefill
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
    val selectedSymbol: String = "",
    val symbols: List<SpotSymbolDto> = emptyList(),
    val currentPrice: Double? = null,
    val klines: List<KlineDto> = emptyList(),
    val interval: String = "15m",
    val signal: SignalDto? = null,
    val isLoading: Boolean = false,
    val error: String? = null,
    val symbolsLoadFailed: Boolean = false
)

class SignalsViewModel(private val app: CopyTradeApp) : ViewModel() {
    private val _uiState = MutableStateFlow(SignalsUiState())
    val uiState: StateFlow<SignalsUiState> = _uiState.asStateFlow()

    init {
        loadSymbols()
        // Seed the pair from the last futures symbol so the two screens feel linked.
        // The futures symbol uses "_" (e.g. BTC_USDT) while spot pairs don't, so strip it.
        viewModelScope.launch {
            val symbol = app.settingsRepository.futuresSymbol.first().replace("_", "")
            if (symbol.isNotBlank()) selectSymbol(symbol)
        }
    }

    private fun loadSymbols() {
        viewModelScope.launch {
            try {
                val url = app.settingsRepository.serverUrl.first() ?: return@launch
                val symbols = app.repositoryFor(url).getSymbols()
                _uiState.value = _uiState.value.copy(symbols = symbols, symbolsLoadFailed = false)
            } catch (_: Exception) {
                // Typing a pair manually still works without the picker list — this only
                // flags it so the screen can explain why no suggestions ever show up,
                // instead of the dropdown silently never appearing for no visible reason.
                _uiState.value = _uiState.value.copy(symbolsLoadFailed = true)
            }
        }
    }

    fun setSymbolQuery(query: String) {
        _uiState.value = _uiState.value.copy(symbolQuery = query.uppercase().trim())
    }

    fun selectSymbol(symbol: String) {
        _uiState.value = _uiState.value.copy(
            symbolQuery = symbol,
            selectedSymbol = symbol,
            currentPrice = null,
            klines = emptyList()
        )
        refreshPrice()
        refreshKlines()
    }

    private fun refreshPrice() {
        val symbol = _uiState.value.selectedSymbol
        if (symbol.isBlank()) return
        viewModelScope.launch {
            try {
                val url = app.settingsRepository.serverUrl.first() ?: return@launch
                val price = app.repositoryFor(url).getPrice(symbol)
                if (_uiState.value.selectedSymbol == symbol) {
                    _uiState.value = _uiState.value.copy(currentPrice = price)
                }
            } catch (_: Exception) {
                // Best-effort — the price ticker isn't critical enough to surface as an error.
            }
        }
    }

    private fun refreshKlines() {
        val symbol = _uiState.value.selectedSymbol
        if (symbol.isBlank()) return
        viewModelScope.launch {
            try {
                val url = app.settingsRepository.serverUrl.first() ?: return@launch
                val klines = app.repositoryFor(url).getKlines(symbol, _uiState.value.interval)
                if (_uiState.value.selectedSymbol == symbol) {
                    _uiState.value = _uiState.value.copy(klines = klines)
                }
            } catch (_: Exception) {
                // Best-effort — the chart isn't critical enough to surface as an error.
            }
        }
    }

    fun setInterval(interval: String) {
        _uiState.value = _uiState.value.copy(interval = interval)
        refreshKlines()
        if (_uiState.value.symbolQuery.isNotBlank()) analyze()
    }

    fun analyze() {
        val symbol = _uiState.value.symbolQuery.trim().uppercase()
        val interval = _uiState.value.interval
        if (symbol.isBlank()) {
            _uiState.value = _uiState.value.copy(error = "Enter a coin pair, e.g. BTCUSDT")
            return
        }
        if (_uiState.value.selectedSymbol != symbol) selectSymbol(symbol)
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
     * Persist the analyzed pair, direction, and suggested entry/SL/TP as a one-shot
     * Futures prefill so the Futures screen opens pre-populated — the same hand-off
     * Copy signals uses. Does NOT execute anything. Returns false if the current
     * signal is NEUTRAL (nothing to trade).
     *
     * [riskUsdAmount] powers the "$N risk trade" quick action: when set, the Futures
     * form derives the position size so the trade risks exactly that many dollars if
     * the stop-loss hits, instead of leaving size for the user to fill in.
     */
    suspend fun prepareTradeHandoff(riskUsdAmount: Double? = null): Boolean {
        val signal = _uiState.value.signal ?: return false
        val side = when (signal.signal) {
            "LONG" -> "long"
            "SHORT" -> "short"
            else -> return false
        }
        // Spot symbols have no separator (BTCUSDT); futures pairs need one (BTC_USDT).
        // /symbols is filtered to USDT quotes, so this suffix swap always applies.
        val futuresSymbol = signal.symbol.removeSuffix("USDT") + "_USDT"
        val prefill = FuturesPrefill(
            symbol = futuresSymbol,
            side = side,
            entryPrice = signal.suggestedEntry,
            stopLoss = signal.stopLoss,
            takeProfit = signal.takeProfit,
            riskUsdAmount = riskUsdAmount
        )
        app.settingsRepository.setFuturesPrefill(prefill.toJson())
        return true
    }
}
