package com.copytrade.app.ui.dashboard

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.copytrade.app.CopyTradeApp
import com.copytrade.app.data.local.entity.BotEntity
import com.copytrade.app.data.remote.dto.BalanceDto
import com.copytrade.app.data.remote.dto.FuturesTodayPnlDto
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

data class DashboardUiState(
    val mode: String = "paper",
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
                val futuresAvailable = runCatching { repo.getFuturesBalance().balance?.availableBalance }.getOrNull()
                val futuresTodayPnl = runCatching { repo.getFuturesTodayPnl() }.getOrNull()
                _uiState.value = _uiState.value.copy(
                    mode = status.mode,
                    balances = status.balances,
                    totalValueUsdt = status.totalValueUsdt,
                    totalValuePhp = status.totalValuePhp,
                    futuresAvailableUsdt = futuresAvailable,
                    futuresTodayPnl = futuresTodayPnl,
                    killSwitchEngaged = status.killSwitchEngaged,
                    isRefreshing = false
                )
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(isRefreshing = false, error = e.message)
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
