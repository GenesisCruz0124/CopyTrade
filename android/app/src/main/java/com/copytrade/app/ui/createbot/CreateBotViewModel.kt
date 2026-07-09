package com.copytrade.app.ui.createbot

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.copytrade.app.CopyTradeApp
import com.copytrade.app.data.remote.dto.CreateDcaBotRequest
import com.copytrade.app.data.remote.dto.CreateGridBotRequest
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

enum class StrategyKind { GRID, DCA }

data class GridFormState(
    val symbol: String = "BTCUSDT",
    val lowerPrice: String = "",
    val upperPrice: String = "",
    val gridLevels: String = "10",
    val totalBudgetUsdt: String = "",
    val mode: String = "arithmetic"
) {
    fun validate(): Boolean {
        val lower = lowerPrice.toDoubleOrNull() ?: return false
        val upper = upperPrice.toDoubleOrNull() ?: return false
        val levels = gridLevels.toIntOrNull() ?: return false
        val budget = totalBudgetUsdt.toDoubleOrNull() ?: return false
        return symbol.isNotBlank() && lower > 0 && upper > lower && levels in 2..50 && budget > 0
    }
}

data class DcaFormState(
    val symbol: String = "BTCUSDT",
    val amountUsdt: String = "",
    val interval: String = "daily",
    val cronExpression: String = "",
    val dipMultiplier: String = "",
    val dipThresholdPct: String = "",
    val takeProfitPct: String = ""
) {
    fun validate(): Boolean {
        val amount = amountUsdt.toDoubleOrNull() ?: return false
        if (interval == "custom" && cronExpression.isBlank()) return false
        return symbol.isNotBlank() && amount > 0
    }
}

data class CreateBotUiState(
    val strategyKind: StrategyKind = StrategyKind.GRID,
    val grid: GridFormState = GridFormState(),
    val dca: DcaFormState = DcaFormState(),
    val confirmLive: Boolean = false,
    val isLiveMode: Boolean = false,
    val isSubmitting: Boolean = false,
    val showValidationError: Boolean = false,
    val error: String? = null,
    val created: Boolean = false
)

class CreateBotViewModel(private val app: CopyTradeApp) : ViewModel() {

    private val _uiState = MutableStateFlow(CreateBotUiState())
    val uiState: StateFlow<CreateBotUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            val url = app.settingsRepository.serverUrl.first() ?: return@launch
            try {
                val status = app.repositoryFor(url).getStatus()
                _uiState.value = _uiState.value.copy(isLiveMode = status.mode == "live")
            } catch (_: Exception) {
            }
        }
    }

    fun setStrategyKind(kind: StrategyKind) {
        _uiState.value = _uiState.value.copy(strategyKind = kind)
    }

    fun updateGrid(update: (GridFormState) -> GridFormState) {
        _uiState.value = _uiState.value.copy(grid = update(_uiState.value.grid), showValidationError = false)
    }

    fun updateDca(update: (DcaFormState) -> DcaFormState) {
        _uiState.value = _uiState.value.copy(dca = update(_uiState.value.dca), showValidationError = false)
    }

    fun setConfirmLive(value: Boolean) {
        _uiState.value = _uiState.value.copy(confirmLive = value)
    }

    fun submit() {
        val state = _uiState.value
        val valid = when (state.strategyKind) {
            StrategyKind.GRID -> state.grid.validate()
            StrategyKind.DCA -> state.dca.validate()
        }
        if (!valid || (state.isLiveMode && !state.confirmLive)) {
            _uiState.value = state.copy(showValidationError = true)
            return
        }

        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isSubmitting = true, error = null)
            try {
                val url = app.settingsRepository.serverUrl.first() ?: error("not configured")
                val repo = app.repositoryFor(url)
                when (state.strategyKind) {
                    StrategyKind.GRID -> repo.createGridBot(
                        CreateGridBotRequest(
                            symbol = state.grid.symbol,
                            lowerPrice = state.grid.lowerPrice.toDouble(),
                            upperPrice = state.grid.upperPrice.toDouble(),
                            gridLevels = state.grid.gridLevels.toInt(),
                            totalBudgetUsdt = state.grid.totalBudgetUsdt.toDouble(),
                            mode = state.grid.mode,
                            confirmLive = state.confirmLive
                        )
                    )
                    StrategyKind.DCA -> repo.createDcaBot(
                        CreateDcaBotRequest(
                            symbol = state.dca.symbol,
                            amountUsdt = state.dca.amountUsdt.toDouble(),
                            interval = state.dca.interval,
                            cronExpression = state.dca.cronExpression.ifBlank { null },
                            dipMultiplier = state.dca.dipMultiplier.toDoubleOrNull(),
                            dipThresholdPct = state.dca.dipThresholdPct.toDoubleOrNull(),
                            takeProfitPct = state.dca.takeProfitPct.toDoubleOrNull(),
                            confirmLive = state.confirmLive
                        )
                    )
                }
                _uiState.value = _uiState.value.copy(isSubmitting = false, created = true)
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(isSubmitting = false, error = e.message)
            }
        }
    }
}
