package com.copytrade.app.ui.futures

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.copytrade.app.CopyTradeApp
import com.copytrade.app.data.remote.toUserMessage
import com.copytrade.app.data.remote.dto.FuturesBalanceDto
import com.copytrade.app.data.remote.dto.FuturesPositionDto
import com.copytrade.app.data.remote.dto.FuturesSymbolDto
import com.copytrade.app.data.remote.dto.KlineDto
import com.copytrade.app.data.remote.dto.OpenFuturesPositionRequest
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

enum class SizingMode { USD, PERCENT }
enum class SlInputMode { PERCENT, PRICE }
enum class TpInputMode { PERCENT, PRICE }
enum class OrderTypeMode { MARKET, LIMIT }

private fun SizingMode.toPrefValue() = if (this == SizingMode.USD) "usd" else "percent"
private fun String.toSizingMode() = if (this == "percent") SizingMode.PERCENT else SizingMode.USD

private fun formatPercent(v: Double): String {
    val rounded = String.format(java.util.Locale.US, "%.4f", v).trimEnd('0').trimEnd('.')
    return rounded.ifEmpty { "0" }
}

private fun formatAmount(v: Double): String = String.format(java.util.Locale.US, "%.2f", v)

/** Plain decimal string for a price input field — no scientific notation, no trailing zeros. */
private fun Double.toPriceInput(): String =
    java.math.BigDecimal.valueOf(this).stripTrailingZeros().toPlainString()

data class FuturesUiState(
    val mode: String = "paper",
    val symbols: List<FuturesSymbolDto> = emptyList(),
    val favorites: Set<String> = emptySet(),
    val symbolQuery: String = "",
    val selectedSymbol: String = "",
    val currentPrice: Double? = null,
    val klines: List<KlineDto> = emptyList(),
    val side: String = "long",
    val leverage: String = "5",
    val openType: String = "isolated",
    val orderType: OrderTypeMode = OrderTypeMode.MARKET,
    val limitPrice: String = "",
    val sizingMode: SizingMode = SizingMode.USD,
    val amountUsd: String = "",
    val percentOfBalance: String = "",
    val takeProfitInputMode: TpInputMode = TpInputMode.PERCENT,
    val takeProfitPercent: String = "",
    val takeProfitPriceUsd: String = "",
    val takeProfitPriceError: String? = null,
    val stopLossInputMode: SlInputMode = SlInputMode.PERCENT,
    val stopLossPercent: String = "",
    val stopLossPriceUsd: String = "",
    val stopLossPriceError: String? = null,
    val riskUsdAmount: String = "",
    val balance: FuturesBalanceDto? = null,
    val positions: List<FuturesPositionDto> = emptyList(),
    val isSubmitting: Boolean = false,
    val isLoading: Boolean = false,
    val confirmLive: Boolean = false,
    val error: String? = null,
    val notConfigured: Boolean = false,
    val opened: Boolean = false
) {
    /** Margin (USDT) implied by the current sizing inputs, or null if it can't be computed yet. */
    val impliedMarginUsdt: Double?
        get() = when (sizingMode) {
            SizingMode.USD -> amountUsd.toDoubleOrNull()
            SizingMode.PERCENT -> {
                val pct = percentOfBalance.toDoubleOrNull()
                val bal = balance?.availableBalance
                if (pct != null && bal != null) pct / 100 * bal else null
            }
        }

    /**
     * The USD you'd lose if the stop-loss hits, implied by the current size,
     * leverage, and stop-loss — the reverse of typing a risk to derive the size.
     * loss = margin × leverage × (stop-loss price move %). Null until size and a
     * stop-loss are both set.
     */
    val impliedRiskUsdt: Double?
        get() {
            val margin = impliedMarginUsdt ?: return null
            val lev = leverage.toDoubleOrNull() ?: return null
            val slPct = stopLossPercent.toDoubleOrNull() ?: return null
            if (margin <= 0 || lev <= 0 || slPct <= 0) return null
            return margin * lev * (slPct / 100)
        }
}

class FuturesViewModel(private val app: CopyTradeApp) : ViewModel() {
    private val _uiState = MutableStateFlow(FuturesUiState())
    val uiState: StateFlow<FuturesUiState> = _uiState.asStateFlow()

    init {
        loadPersistedSelections()
        loadSymbols()
        refresh()
    }

    private fun loadPersistedSelections() {
        viewModelScope.launch {
            val settings = app.settingsRepository
            val symbol = settings.futuresSymbol.first()
            _uiState.value = _uiState.value.copy(
                openType = settings.futuresOpenType.first(),
                sizingMode = settings.futuresSizingMode.first().toSizingMode(),
                leverage = settings.futuresLeverage.first(),
                side = settings.futuresSide.first(),
                selectedSymbol = symbol,
                symbolQuery = symbol,
                favorites = settings.futuresFavoriteSymbols.first()
            )
            // A one-shot prefill (e.g. handed off from an approved copy signal)
            // overrides the persisted selection with the signal's symbol/side/
            // leverage and its entry/SL/TP bracket. Size is deliberately left for
            // the user to set. Cleared after applying so it fires only once.
            val prefill = FuturesPrefill.fromJsonOrNull(settings.futuresPrefill.first())
            if (prefill != null) {
                applyPrefill(prefill)
                settings.clearFuturesPrefill()
            }
            if (_uiState.value.selectedSymbol.isNotBlank()) {
                refreshPrice()
                refreshKlines()
            }
        }
    }

    private suspend fun applyPrefill(prefill: FuturesPrefill) {
        var next = _uiState.value.copy(
            selectedSymbol = prefill.symbol,
            symbolQuery = prefill.symbol,
            side = prefill.side,
            currentPrice = null,
            klines = emptyList()
        )
        prefill.leverage?.let { next = next.copy(leverage = it.toString()) }
        // Enter at the signal's entry as a LIMIT order; the user can switch to MARKET.
        prefill.entryPrice?.let {
            next = next.copy(orderType = OrderTypeMode.LIMIT, limitPrice = it.toPriceInput())
        }
        prefill.stopLoss?.let {
            next = next.copy(
                stopLossInputMode = SlInputMode.PRICE,
                stopLossPriceUsd = it.toPriceInput(),
                stopLossPercent = ""
            )
        }
        prefill.takeProfit?.let {
            next = next.copy(
                takeProfitInputMode = TpInputMode.PRICE,
                takeProfitPriceUsd = it.toPriceInput(),
                takeProfitPercent = ""
            )
        }
        _uiState.value = next
        // Persist symbol/side/leverage so they behave like a normal manual pick.
        app.settingsRepository.setFuturesSymbol(prefill.symbol)
        app.settingsRepository.setFuturesSide(prefill.side)
        prefill.leverage?.let { app.settingsRepository.setFuturesLeverage(it.toString()) }
    }

    private fun loadSymbols() {
        viewModelScope.launch {
            try {
                val url = app.settingsRepository.serverUrl.first() ?: return@launch
                val symbols = app.repositoryFor(url).getFuturesSymbols()
                _uiState.value = _uiState.value.copy(symbols = symbols, notConfigured = symbols.isEmpty())
            } catch (e: Exception) {
                // The engine returns HTTP 400 (not a 200 with an empty list) when futures
                // trading isn't configured — treat any failure to load symbols the same way.
                _uiState.value = _uiState.value.copy(notConfigured = true, error = e.toUserMessage())
            }
        }
    }

    fun refresh() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true)
            try {
                val url = app.settingsRepository.serverUrl.first() ?: return@launch
                val repo = app.repositoryFor(url)
                // Futures has its own paper/live mode, independent of spot's — read it from
                // a futures response, not repo.getStatus() (which only reflects spot's mode).
                val balanceResponse = runCatching { repo.getFuturesBalance() }.getOrNull()
                // Keep the last known positions on a failed fetch instead of silently
                // showing an empty list — that previously made a real position look like
                // it never opened when this call alone happened to fail (e.g. rate limit).
                val positionsResult = runCatching { repo.getFuturesPositions() }
                val positions = positionsResult.getOrDefault(_uiState.value.positions)
                _uiState.value = _uiState.value.copy(
                    mode = balanceResponse?.mode ?: _uiState.value.mode,
                    balance = balanceResponse?.balance,
                    positions = positions,
                    isLoading = false,
                    error = positionsResult.exceptionOrNull()?.toUserMessage()
                )
                recomputeStopLoss()
                recomputeTakeProfit()
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(isLoading = false, error = e.toUserMessage())
            }
            refreshPrice()
            refreshKlines()
        }
    }

    private fun refreshPrice() {
        val symbol = _uiState.value.selectedSymbol
        if (symbol.isBlank()) return
        viewModelScope.launch {
            try {
                val url = app.settingsRepository.serverUrl.first() ?: return@launch
                val price = app.repositoryFor(url).getFuturesPrice(symbol)
                if (_uiState.value.selectedSymbol == symbol) {
                    _uiState.value = _uiState.value.copy(currentPrice = price)
                    recomputeStopLoss()
                    recomputeTakeProfit()
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
                val klines = app.repositoryFor(url).getFuturesKlines(symbol)
                if (_uiState.value.selectedSymbol == symbol) {
                    _uiState.value = _uiState.value.copy(klines = klines)
                }
            } catch (_: Exception) {
                // Best-effort — the chart isn't critical enough to surface as an error.
            }
        }
    }

    fun setSymbolQuery(query: String) {
        _uiState.value = _uiState.value.copy(symbolQuery = query)
    }

    fun selectSymbol(symbol: String) {
        _uiState.value = _uiState.value.copy(selectedSymbol = symbol, symbolQuery = symbol, currentPrice = null, klines = emptyList())
        viewModelScope.launch { app.settingsRepository.setFuturesSymbol(symbol) }
        refreshPrice()
        refreshKlines()
    }

    fun toggleFavorite(symbol: String) {
        val favorites = _uiState.value.favorites
        _uiState.value = _uiState.value.copy(favorites = if (symbol in favorites) favorites - symbol else favorites + symbol)
        viewModelScope.launch { app.settingsRepository.toggleFuturesFavoriteSymbol(symbol) }
    }

    fun setSide(side: String) {
        _uiState.value = _uiState.value.copy(side = side)
        viewModelScope.launch { app.settingsRepository.setFuturesSide(side) }
        recomputeStopLoss()
        recomputeTakeProfit()
    }

    fun setLeverage(v: String) {
        _uiState.value = _uiState.value.copy(leverage = v)
        viewModelScope.launch { app.settingsRepository.setFuturesLeverage(v) }
        recomputeStopLoss()
    }

    fun setOpenType(v: String) {
        _uiState.value = _uiState.value.copy(openType = v)
        viewModelScope.launch { app.settingsRepository.setFuturesOpenType(v) }
    }

    fun setOrderType(mode: OrderTypeMode) {
        _uiState.value = _uiState.value.copy(orderType = mode)
    }

    fun setLimitPrice(v: String) {
        _uiState.value = _uiState.value.copy(limitPrice = v)
    }

    fun setSizingMode(mode: SizingMode) {
        _uiState.value = _uiState.value.copy(sizingMode = mode)
        viewModelScope.launch { app.settingsRepository.setFuturesSizingMode(mode.toPrefValue()) }
        recomputeStopLoss()
    }

    fun setAmountUsd(v: String) {
        _uiState.value = _uiState.value.copy(amountUsd = v)
        recomputeStopLoss()
    }

    fun setPercentOfBalance(v: String) {
        _uiState.value = _uiState.value.copy(percentOfBalance = v)
        recomputeStopLoss()
    }

    fun setTakeProfitInputMode(mode: TpInputMode) {
        _uiState.value = _uiState.value.copy(takeProfitInputMode = mode, takeProfitPriceError = null)
        recomputeTakeProfit()
    }

    fun setTakeProfitPercent(v: String) {
        _uiState.value = _uiState.value.copy(takeProfitPercent = v)
    }

    fun setTakeProfitPriceUsd(v: String) {
        _uiState.value = _uiState.value.copy(takeProfitPriceUsd = v)
        recomputeTakeProfit()
    }

    private fun recomputeTakeProfit() {
        if (_uiState.value.takeProfitInputMode != TpInputMode.PRICE) return
        val state = _uiState.value
        val tpPrice = state.takeProfitPriceUsd.toDoubleOrNull()
        val currentPrice = state.currentPrice
        if (tpPrice == null || tpPrice <= 0 || currentPrice == null) {
            _uiState.value = state.copy(takeProfitPriceError = null)
            return
        }
        val tpPercent = if (state.side == "long") {
            (tpPrice - currentPrice) / currentPrice * 100
        } else {
            (currentPrice - tpPrice) / currentPrice * 100
        }
        if (tpPercent <= 0) {
            val sideHint = if (state.side == "long") "above" else "below"
            _uiState.value = state.copy(
                takeProfitPriceError = "Take-profit price must be $sideHint the current price",
                takeProfitPercent = ""
            )
            return
        }
        _uiState.value = state.copy(takeProfitPercent = formatPercent(tpPercent), takeProfitPriceError = null)
    }

    fun setStopLossInputMode(mode: SlInputMode) {
        _uiState.value = _uiState.value.copy(stopLossInputMode = mode, stopLossPriceError = null)
        recomputeStopLoss()
    }

    fun setStopLossPercent(v: String) {
        // A direct edit detaches from the risk-amount auto-fill until the risk amount is touched again.
        _uiState.value = _uiState.value.copy(stopLossPercent = v, riskUsdAmount = "")
    }

    fun setStopLossPriceUsd(v: String) {
        _uiState.value = _uiState.value.copy(stopLossPriceUsd = v)
        recomputeStopLoss()
    }

    /** Alternative stop-loss input: "I'm willing to lose $X" auto-fills either the
     *  Stop-loss (%) field (percent mode) or the position size (price mode). */
    fun setRiskUsdAmount(v: String) {
        _uiState.value = _uiState.value.copy(riskUsdAmount = v)
        recomputeStopLoss()
    }

    private fun recomputeStopLoss() {
        when (_uiState.value.stopLossInputMode) {
            SlInputMode.PERCENT -> recomputeStopLossPercentFromRisk()
            SlInputMode.PRICE -> recomputeFromStopLossPrice()
        }
    }

    /** Percent mode: risk amount + position size + leverage -> stop-loss %. */
    private fun recomputeStopLossPercentFromRisk() {
        val state = _uiState.value
        val riskUsd = state.riskUsdAmount.toDoubleOrNull() ?: return
        val margin = state.impliedMarginUsdt ?: return
        val leverage = state.leverage.toDoubleOrNull() ?: return
        if (riskUsd <= 0 || margin <= 0 || leverage <= 0) return
        val percent = riskUsd / (margin * leverage) * 100
        _uiState.value = _uiState.value.copy(stopLossPercent = formatPercent(percent))
    }

    /** Price mode: stop-loss price -> stop-loss %, and (if a risk amount is set) -> position size. */
    private fun recomputeFromStopLossPrice() {
        val state = _uiState.value
        val slPrice = state.stopLossPriceUsd.toDoubleOrNull()
        val currentPrice = state.currentPrice
        if (slPrice == null || slPrice <= 0 || currentPrice == null) {
            _uiState.value = state.copy(stopLossPriceError = null)
            return
        }
        val slPercent = if (state.side == "long") {
            (currentPrice - slPrice) / currentPrice * 100
        } else {
            (slPrice - currentPrice) / currentPrice * 100
        }
        if (slPercent <= 0 || slPercent >= 100) {
            val sideHint = if (state.side == "long") "below" else "above"
            _uiState.value = state.copy(
                stopLossPriceError = "Stop-loss price must be $sideHint the current price",
                stopLossPercent = ""
            )
            return
        }

        var newState = state.copy(stopLossPercent = formatPercent(slPercent), stopLossPriceError = null)
        val leverage = state.leverage.toDoubleOrNull()
        val riskUsd = state.riskUsdAmount.toDoubleOrNull()
        if (leverage != null && leverage > 0 && riskUsd != null && riskUsd > 0) {
            val marginUsdt = riskUsd / (leverage * slPercent / 100)
            newState = when (state.sizingMode) {
                SizingMode.USD -> newState.copy(amountUsd = formatAmount(marginUsdt))
                SizingMode.PERCENT -> {
                    val bal = state.balance?.availableBalance
                    if (bal != null && bal > 0) newState.copy(percentOfBalance = formatPercent(marginUsdt / bal * 100)) else newState
                }
            }
        }
        _uiState.value = newState
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
        if (state.stopLossInputMode == SlInputMode.PRICE && state.stopLossPriceUsd.isNotBlank() && state.stopLossPercent.isBlank()) {
            _uiState.value = state.copy(error = state.stopLossPriceError ?: "Fix the stop-loss price")
            return
        }
        if (state.takeProfitInputMode == TpInputMode.PRICE && state.takeProfitPriceUsd.isNotBlank() && state.takeProfitPercent.isBlank()) {
            _uiState.value = state.copy(error = state.takeProfitPriceError ?: "Fix the take-profit price")
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

        var limitPriceValue: Double? = null
        if (state.orderType == OrderTypeMode.LIMIT) {
            limitPriceValue = state.limitPrice.toDoubleOrNull()
            if (limitPriceValue == null || limitPriceValue <= 0) {
                _uiState.value = state.copy(error = "Enter a valid limit price")
                return
            }
        }

        // Validate TP/SL against a reference price before ever hitting the network — a stale or
        // absent price, or a percentage that would flip TP/SL to the wrong side, must block
        // submission instead of letting the engine reject it after the fact. For a LIMIT order the
        // real entry is the limit price, not the current market price, so that's the reference used.
        val referencePrice = if (state.orderType == OrderTypeMode.LIMIT) limitPriceValue else state.currentPrice
        if (referencePrice == null) {
            _uiState.value = state.copy(error = "Still loading the current price — try again in a moment")
            return
        }
        val tpPercent = state.takeProfitPercent.toDoubleOrNull()
        val slPercent = state.stopLossPercent.toDoubleOrNull()
        if (state.takeProfitPercent.isNotBlank() && (tpPercent == null || tpPercent <= 0)) {
            _uiState.value = state.copy(error = "Take-profit must be a positive percentage")
            return
        }
        if (state.stopLossPercent.isNotBlank() && (slPercent == null || slPercent <= 0 || slPercent >= 100)) {
            _uiState.value = state.copy(error = "Stop-loss must be a positive percentage below 100")
            return
        }
        val tpPrice = tpPercent?.let { if (state.side == "long") referencePrice * (1 + it / 100) else referencePrice * (1 - it / 100) }
        val slPrice = slPercent?.let { if (state.side == "long") referencePrice * (1 - it / 100) else referencePrice * (1 + it / 100) }
        if (tpPrice != null && tpPrice <= 0) {
            _uiState.value = state.copy(error = "Take-profit is invalid at the current price")
            return
        }
        if (slPrice != null && slPrice <= 0) {
            _uiState.value = state.copy(error = "Stop-loss is invalid at the current price")
            return
        }
        val tpSlValid = when {
            tpPrice == null && slPrice == null -> true
            state.side == "long" -> (slPrice == null || slPrice < referencePrice) && (tpPrice == null || tpPrice > referencePrice)
            else -> (slPrice == null || slPrice > referencePrice) && (tpPrice == null || tpPrice < referencePrice)
        }
        if (!tpSlValid) {
            _uiState.value = state.copy(error = "Take-profit / stop-loss must be on the correct side of the current price")
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
                    takeProfitPercent = tpPercent,
                    stopLossPercent = slPercent,
                    confirmLive = state.confirmLive,
                    orderType = if (state.orderType == OrderTypeMode.LIMIT) "LIMIT" else "MARKET",
                    limitPrice = limitPriceValue
                )
                app.repositoryFor(url).openFuturesPosition(request)
                _uiState.value = _uiState.value.copy(isSubmitting = false, opened = true)
                refresh()
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(isSubmitting = false, error = e.toUserMessage())
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
                _uiState.value = _uiState.value.copy(error = e.toUserMessage())
            }
        }
    }

    fun consumeOpened() {
        _uiState.value = _uiState.value.copy(opened = false)
    }
}
