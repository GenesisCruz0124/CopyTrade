package com.copytrade.app.ui.copysignals

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.copytrade.app.CopyTradeApp
import com.copytrade.app.data.remote.toUserMessage
import com.copytrade.app.data.remote.dto.CopySignalDto
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

data class CopySignalsUiState(
    val signals: List<CopySignalDto> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null
)

class CopySignalsViewModel(private val app: CopyTradeApp) : ViewModel() {
    private val _uiState = MutableStateFlow(CopySignalsUiState())
    val uiState: StateFlow<CopySignalsUiState> = _uiState.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            try {
                val url = app.settingsRepository.serverUrl.first() ?: return@launch
                val repo = app.repositoryFor(url)
                val signals = repo.getCopySignals("PENDING")
                _uiState.value = _uiState.value.copy(signals = signals, isLoading = false)
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(isLoading = false, error = e.toUserMessage())
            }
        }
    }

    fun approve(id: String) {
        viewModelScope.launch {
            try {
                val url = app.settingsRepository.serverUrl.first() ?: return@launch
                app.repositoryFor(url).approveCopySignal(id)
                refresh()
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(error = e.toUserMessage())
            }
        }
    }

    fun reject(id: String) {
        viewModelScope.launch {
            try {
                val url = app.settingsRepository.serverUrl.first() ?: return@launch
                app.repositoryFor(url).rejectCopySignal(id)
                refresh()
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(error = e.toUserMessage())
            }
        }
    }
}
