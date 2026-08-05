package com.copytrade.app.ui.futures

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.copytrade.app.CopyTradeApp
import com.copytrade.app.data.remote.dto.FuturesPendingOrderDto
import com.copytrade.app.data.remote.dto.FuturesPositionDto
import com.copytrade.app.data.remote.dto.KlineDto
import com.copytrade.app.data.remote.toUserMessage
import com.copytrade.app.data.repository.EngineRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

enum class TradeChartKind { POSITION, PENDING_ORDER }

data class TradeChartUiState(
    val kind: TradeChartKind,
    val position: FuturesPositionDto? = null,
    val order: FuturesPendingOrderDto? = null,
    /** Live price for a pending order — FuturesPendingOrderDto carries no currentPrice
     *  field the way an open position's view does, so this is fetched separately. */
    val orderCurrentPrice: Double? = null,
    val klines: List<KlineDto> = emptyList(),
    val usdToPhpRate: Double? = null,
    val isLoading: Boolean = true,
    /** The position/order is gone from the live list — closed, filled, or cancelled
     *  elsewhere while this screen was open. */
    val notFound: Boolean = false,
    val error: String? = null
)

class TradeChartViewModel(
    private val app: CopyTradeApp,
    private val tradeId: String,
    kind: TradeChartKind
) : ViewModel() {

    private val _uiState = MutableStateFlow(TradeChartUiState(kind = kind))
    val uiState: StateFlow<TradeChartUiState> = _uiState.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            try {
                val url = app.settingsRepository.serverUrl.first() ?: return@launch
                val repo = app.repositoryFor(url)
                val phpRate = runCatching { repo.getStatus().usdToPhpRate }.getOrNull() ?: _uiState.value.usdToPhpRate

                when (_uiState.value.kind) {
                    TradeChartKind.POSITION -> {
                        val position = repo.getFuturesPositions().find { it.id == tradeId }
                        val klines = position?.let { p -> runCatching { repo.getFuturesKlines(p.symbol) }.getOrNull() }
                        _uiState.value = _uiState.value.copy(
                            position = position,
                            notFound = position == null,
                            klines = klines ?: _uiState.value.klines,
                            usdToPhpRate = phpRate,
                            isLoading = false,
                            error = null
                        )
                    }
                    TradeChartKind.PENDING_ORDER -> {
                        val order = repo.getFuturesOrders().find { it.id == tradeId }
                        val klines = order?.let { o -> runCatching { repo.getFuturesKlines(o.symbol) }.getOrNull() }
                        val currentPrice = order?.let { o -> runCatching { repo.getFuturesPrice(o.symbol) }.getOrNull() }
                        _uiState.value = _uiState.value.copy(
                            order = order,
                            orderCurrentPrice = currentPrice ?: _uiState.value.orderCurrentPrice,
                            notFound = order == null,
                            klines = klines ?: _uiState.value.klines,
                            usdToPhpRate = phpRate,
                            isLoading = false,
                            error = null
                        )
                    }
                }
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(isLoading = false, error = e.toUserMessage())
            }
        }
    }

    fun setTakeProfitByPnlPercent(id: String, pnlPercent: Double) = editField { it.setFuturesTakeProfitByPnlPercent(id, pnlPercent) }
    fun setTakeProfitByPrice(id: String, price: Double) = editField { it.setFuturesTakeProfitByPrice(id, price) }
    fun setStopLossByRiskUsd(id: String, riskUsd: Double) = editField { it.setFuturesStopLossByRiskUsd(id, riskUsd) }
    fun setStopLossByPrice(id: String, price: Double) = editField { it.setFuturesStopLossByPrice(id, price) }
    fun closePosition(id: String) = editField { it.closeFuturesPosition(id) }
    fun cancelOrder(id: String) = editField { it.cancelFuturesOrder(id) }

    private fun editField(action: suspend (EngineRepository) -> Unit) {
        viewModelScope.launch {
            try {
                val url = app.settingsRepository.serverUrl.first() ?: return@launch
                action(app.repositoryFor(url))
                refresh()
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(error = e.toUserMessage())
            }
        }
    }
}
