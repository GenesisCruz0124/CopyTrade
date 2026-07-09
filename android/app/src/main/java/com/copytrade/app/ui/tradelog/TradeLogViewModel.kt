package com.copytrade.app.ui.tradelog

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.copytrade.app.CopyTradeApp
import com.copytrade.app.data.local.entity.FillEntity
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

data class TradeLogUiState(
    val fills: List<FillEntity> = emptyList(),
    val symbolFilter: String = ""
)

class TradeLogViewModel(private val app: CopyTradeApp) : ViewModel() {
    private val _uiState = MutableStateFlow(TradeLogUiState())
    val uiState: StateFlow<TradeLogUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            val url = app.settingsRepository.serverUrl.first() ?: return@launch
            app.repositoryFor(url).observeAllFills().catch { }.collect { fills ->
                _uiState.value = _uiState.value.copy(fills = fills)
            }
        }
    }

    fun setSymbolFilter(symbol: String) {
        _uiState.value = _uiState.value.copy(symbolFilter = symbol)
    }

    fun filteredFills(): List<FillEntity> {
        val filter = _uiState.value.symbolFilter
        val fills = _uiState.value.fills
        return if (filter.isBlank()) fills else fills.filter { it.symbol.contains(filter, ignoreCase = true) }
    }
}
