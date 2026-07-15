package com.copytrade.app.ui.futures

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.copytrade.app.CopyTradeApp
import com.copytrade.app.data.remote.toUserMessage
import com.copytrade.app.data.remote.dto.FuturesPositionDto
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

data class FuturesHistoryUiState(
    val openPositions: List<FuturesPositionDto> = emptyList(),
    val closedPositions: List<FuturesPositionDto> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null
)

class FuturesHistoryViewModel(private val app: CopyTradeApp) : ViewModel() {
    private val _uiState = MutableStateFlow(FuturesHistoryUiState())
    val uiState: StateFlow<FuturesHistoryUiState> = _uiState.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true)
            try {
                val url = app.settingsRepository.serverUrl.first() ?: return@launch
                val repo = app.repositoryFor(url)
                val open = repo.getFuturesPositions()
                val closed = repo.getFuturesPositionsHistory()
                _uiState.value = _uiState.value.copy(
                    openPositions = open,
                    closedPositions = closed,
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
}
