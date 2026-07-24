package com.copytrade.app.ui.dashboard

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.copytrade.app.CopyTradeApp
import com.copytrade.app.data.local.entity.BotEntity
import com.copytrade.app.data.remote.dto.BalanceDto
import com.copytrade.app.data.remote.dto.FuturesTodayPnlDto
import com.copytrade.app.data.remote.dto.TradingModeRequest
import com.copytrade.app.data.remote.toUserMessage
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

data class DashboardUiState(
    /** Spot trading mode. Not yet per-user — every account shares this global setting. */
    val mode: String = "paper",
    /** Futures trading mode — per-user once signed in with a personal account. Null
     *  while futures balance hasn't loaded yet (e.g. futures not configured). */
    val futuresMode: String? = null,
    /** Whether the connected session can change its own futures trading mode —
     *  true only for a per-user login (GET /me succeeds), not the legacy/admin token. */
    val canManageFuturesMode: Boolean = false,
    val isUpdatingFuturesMode: Boolean = false,
    val balances: List<BalanceDto> = emptyList(),
    val totalValueUsdt: Double? = null,
    val totalValuePhp: Double? = null,
    val futuresAvailableUsdt: Double? = null,
    val futuresTodayPnl: FuturesTodayPnlDto? = null,
    val bots: List<BotEntity> = emptyList(),
    val isRefreshing: Boolean = false,
    val killSwitchEngaged: Boolean = false,
    val error: String? = null
)

class DashboardViewModel(private val app: CopyTradeApp) : ViewModel() {

    private val _uiState = MutableStateFlow(DashboardUiState())
    val uiState: StateFlow<DashboardUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            val url = app.settingsRepository.serverUrl.first()
            if (url != null) {
                app.repositoryFor(url).observeBots()
                    .catch { }
                    .collect { bots -> _uiState.value = _uiState.value.copy(bots = bots) }
            }
        }
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isRefreshing = true, error = null)
            try {
                val url = app.settingsRepository.serverUrl.first() ?: return@launch
                val repo = app.repositoryFor(url)
                val status = repo.getStatus()
                repo.refreshBots()
                // Futures balance is a separate endpoint and may be unconfigured —
                // treat any failure as "not available" rather than failing the refresh.
                val futuresBalance = runCatching { repo.getFuturesBalance() }.getOrNull()
                val futuresTodayPnl = runCatching { repo.getFuturesTodayPnl() }.getOrNull()
                val currentUser = runCatching { repo.getMe() }.getOrNull()
                _uiState.value = _uiState.value.copy(
                    mode = status.mode,
                    futuresMode = futuresBalance?.mode,
                    canManageFuturesMode = currentUser != null,
                    balances = status.balances,
                    totalValueUsdt = status.totalValueUsdt,
                    totalValuePhp = status.totalValuePhp,
                    futuresAvailableUsdt = futuresBalance?.balance?.availableBalance,
                    futuresTodayPnl = futuresTodayPnl,
                    killSwitchEngaged = status.killSwitchEngaged,
                    isRefreshing = false
                )
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(isRefreshing = false, error = e.message)
            }
        }
    }

    fun setFuturesTradingMode(live: Boolean) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isUpdatingFuturesMode = true, error = null)
            try {
                val url = app.settingsRepository.serverUrl.first() ?: return@launch
                app.repositoryFor(url).updateTradingMode(TradingModeRequest(futuresTradingMode = if (live) "live" else "paper"))
                _uiState.value = _uiState.value.copy(isUpdatingFuturesMode = false)
                refresh()
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(isUpdatingFuturesMode = false, error = e.toUserMessage())
            }
        }
    }

    fun engageKillSwitch() {
        viewModelScope.launch {
            try {
                val url = app.settingsRepository.serverUrl.first() ?: return@launch
                app.repositoryFor(url).engageKillSwitch()
                refresh()
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(error = e.message)
            }
        }
    }
}
