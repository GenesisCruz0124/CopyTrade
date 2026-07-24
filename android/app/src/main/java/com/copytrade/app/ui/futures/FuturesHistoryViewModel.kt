package com.copytrade.app.ui.futures

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.copytrade.app.CopyTradeApp
import com.copytrade.app.data.remote.toUserMessage
import com.copytrade.app.data.remote.dto.FuturesPendingOrderDto
import com.copytrade.app.data.remote.dto.FuturesPositionDto
import com.copytrade.app.data.remote.dto.FuturesTodayPnlDto
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

data class FuturesHistoryUiState(
    val mode: String = "paper",
    val openPositions: List<FuturesPositionDto> = emptyList(),
    val closedPositions: List<FuturesPositionDto> = emptyList(),
    val pendingOrders: List<FuturesPendingOrderDto> = emptyList(),
    val todayPnl: FuturesTodayPnlDto? = null,
    val isLoading: Boolean = false,
    val error: String? = null
)

class FuturesHistoryViewModel(private val app: CopyTradeApp) : ViewModel() {
    private val _uiState = MutableStateFlow(FuturesHistoryUiState())
    val uiState: StateFlow<FuturesHistoryUiState> = _uiState.asStateFlow()

    init {
        refresh()
    }

    /** [silent]: skip the isLoading flip that drives the pull-to-refresh spinner on
     *  Dashboard — used for the automatic background poll so it doesn't flash on
     *  every tick; a manual pull-to-refresh gesture still wants the visible spinner. */
    fun refresh(silent: Boolean = false) {
        viewModelScope.launch {
            if (!silent) _uiState.value = _uiState.value.copy(isLoading = true)
            try {
                val url = app.settingsRepository.serverUrl.first() ?: return@launch
                val repo = app.repositoryFor(url)
                val open = repo.getFuturesPositions()
                val closed = repo.getFuturesPositionsHistory()
                val pending = runCatching { repo.getFuturesOrders() }.getOrDefault(_uiState.value.pendingOrders)
                // Futures has its own paper/live mode, independent of spot's — read it from
                // a futures response (todayPnl already carries it), not repo.getStatus().
                val todayPnl = runCatching { repo.getFuturesTodayPnl() }.getOrNull()
                _uiState.value = _uiState.value.copy(
                    mode = todayPnl?.mode ?: _uiState.value.mode,
                    openPositions = open,
                    closedPositions = closed,
                    pendingOrders = pending,
                    todayPnl = todayPnl,
                    isLoading = false,
                    error = null
                )
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(isLoading = false, error = e.toUserMessage())
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

    fun cancelOrder(id: String) {
        viewModelScope.launch {
            try {
                val url = app.settingsRepository.serverUrl.first() ?: return@launch
                app.repositoryFor(url).cancelFuturesOrder(id)
                refresh()
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(error = e.toUserMessage())
            }
        }
    }
}
