package com.copytrade.app.ui.botdetail

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.copytrade.app.CopyTradeApp
import com.copytrade.app.data.local.entity.BotEntity
import com.copytrade.app.data.local.entity.FillEntity
import com.copytrade.app.data.local.entity.PnlSnapshotEntity
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

data class BotDetailUiState(
    val bot: BotEntity? = null,
    val fills: List<FillEntity> = emptyList(),
    val pnlSeries: List<PnlSnapshotEntity> = emptyList(),
    val error: String? = null
)

class BotDetailViewModel(private val app: CopyTradeApp, private val botId: String) : ViewModel() {

    private val _uiState = MutableStateFlow(BotDetailUiState())
    val uiState: StateFlow<BotDetailUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            val url = app.settingsRepository.serverUrl.first() ?: return@launch
            val repo = app.repositoryFor(url)
            combine(repo.observeBot(botId), repo.observeFillsForBot(botId), repo.observePnlForBot(botId)) { bot, fills, pnl ->
                BotDetailUiState(bot = bot, fills = fills, pnlSeries = pnl)
            }.catch { }.collect { _uiState.value = it }
        }
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            try {
                val url = app.settingsRepository.serverUrl.first() ?: return@launch
                val repo = app.repositoryFor(url)
                repo.refreshBots()
                repo.refreshTrades(botId)
                repo.refreshPnl(botId)
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(error = e.message)
            }
        }
    }

    fun start() = runAction { it.startBot(botId) }
    fun pause() = runAction { it.pauseBot(botId) }
    fun stop() = runAction { it.stopBot(botId) }
    fun delete(onDeleted: () -> Unit) {
        viewModelScope.launch {
            try {
                val url = app.settingsRepository.serverUrl.first() ?: return@launch
                app.repositoryFor(url).deleteBot(botId)
                onDeleted()
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(error = e.message)
            }
        }
    }

    private fun runAction(action: suspend (com.copytrade.app.data.repository.EngineRepository) -> Unit) {
        viewModelScope.launch {
            try {
                val url = app.settingsRepository.serverUrl.first() ?: return@launch
                action(app.repositoryFor(url))
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(error = e.message)
            }
        }
    }
}
