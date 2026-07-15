package com.copytrade.app.ui.dashboard

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CandlestickChart
import androidx.compose.material.icons.filled.Insights
import androidx.compose.material.icons.filled.List
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.PowerSettingsNew
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Card
import androidx.compose.material.ExperimentalMaterialApi
import androidx.compose.material.pullrefresh.PullRefreshIndicator
import androidx.compose.material.pullrefresh.pullRefresh
import androidx.compose.material.pullrefresh.rememberPullRefreshState
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Divider
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.copytrade.app.data.local.entity.BotEntity
import com.copytrade.app.ui.appViewModel
import com.copytrade.app.ui.components.ConfirmDialog
import com.copytrade.app.ui.components.ModeBadge
import com.copytrade.app.ui.components.PollWhileForeground
import com.copytrade.app.ui.strings.Strings
import com.copytrade.app.ui.strings.resolve
import com.copytrade.app.ui.theme.LossRed
import com.copytrade.app.ui.theme.ProfitGreen
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterialApi::class)
@Composable
fun DashboardScreen(
    onOpenBot: (String) -> Unit,
    onCreateBot: () -> Unit,
    onOpenTradeLog: () -> Unit,
    onOpenSettings: () -> Unit,
    onOpenCopySignals: () -> Unit,
    onOpenSignals: () -> Unit,
    onOpenFutures: () -> Unit
) {
    val viewModel = appViewModel { DashboardViewModel(it) }
    val state by viewModel.uiState.collectAsState()
    var showKillSwitchConfirm by remember { mutableStateOf(false) }

    PollWhileForeground { viewModel.refresh() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(Strings.dashboardTitle.resolve()) },
                actions = {
                    ModeBadge(mode = state.mode, modifier = Modifier.padding(end = 8.dp))
                    IconButton(onClick = onOpenTradeLog) {
                        Icon(Icons.Filled.List, contentDescription = Strings.tradeLogTitle.resolve())
                    }
                    IconButton(onClick = onOpenCopySignals) {
                        Icon(Icons.Filled.Notifications, contentDescription = Strings.copySignalsTitle.resolve())
                    }
                    IconButton(onClick = onOpenSignals) {
                        Icon(Icons.Filled.Insights, contentDescription = Strings.signalsTitle.resolve())
                    }
                    IconButton(onClick = onOpenFutures) {
                        Icon(Icons.Filled.CandlestickChart, contentDescription = Strings.futuresTitle.resolve())
                    }
                    IconButton(onClick = onOpenSettings) {
                        Icon(Icons.Filled.Settings, contentDescription = Strings.settingsTitle.resolve())
                    }
                    IconButton(onClick = { showKillSwitchConfirm = true }) {
                        Icon(Icons.Filled.PowerSettingsNew, contentDescription = Strings.killSwitch.resolve(), tint = LossRed)
                    }
                }
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = onCreateBot) {
                Icon(Icons.Filled.Add, contentDescription = Strings.createBotTitle.resolve())
            }
        }
    ) { padding ->
        val pullRefreshState = rememberPullRefreshState(refreshing = state.isRefreshing, onRefresh = viewModel::refresh)
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .pullRefresh(pullRefreshState)
        ) {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                item { TotalBalanceCard(state) }
                item {
                    Text(
                        text = Strings.activeBots.resolve(),
                        style = MaterialTheme.typography.titleMedium,
                        modifier = Modifier.padding(top = 8.dp)
                    )
                }
                if (state.bots.isEmpty()) {
                    item {
                        Text(
                            text = Strings.noBotsYet.resolve(),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(vertical = 16.dp)
                        )
                    }
                } else {
                    items(state.bots, key = { it.id }) { bot ->
                        BotCard(bot = bot, onClick = { onOpenBot(bot.id) })
                    }
                }
            }
            PullRefreshIndicator(
                refreshing = state.isRefreshing,
                state = pullRefreshState,
                modifier = Modifier.align(androidx.compose.ui.Alignment.TopCenter)
            )
        }
    }

    if (showKillSwitchConfirm) {
        ConfirmDialog(
            title = Strings.killSwitchConfirmTitle,
            message = Strings.killSwitchConfirmMessage,
            confirmLabel = Strings.confirm,
            cancelLabel = Strings.cancel,
            onConfirm = {
                showKillSwitchConfirm = false
                viewModel.engageKillSwitch()
            },
            onDismiss = { showKillSwitchConfirm = false }
        )
    }
}

/** Fixed-point, never scientific notation — Double.toString() switches to "1.7E-4" for small crypto quantities. */
private fun formatQty(qty: Double): String = String.format(Locale.US, "%.8f", qty).trimEnd('0').trimEnd('.')

@Composable
private fun TotalBalanceCard(state: DashboardUiState) {
    val nonZeroBalances = state.balances.filter { it.free + it.locked > 0 }
    Card(modifier = Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(text = Strings.totalBalance.resolve(), color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(4.dp))
            Text(
                text = state.totalValueUsdt?.let { String.format(Locale.US, "%.2f USDT", it) } ?: "— USDT",
                style = MaterialTheme.typography.headlineMedium
            )
            state.totalValuePhp?.let {
                Text(
                    text = String.format(Locale.US, "≈ ₱%.2f", it),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodyMedium
                )
            }

            if (nonZeroBalances.isNotEmpty()) {
                Spacer(Modifier.height(12.dp))
                Divider()
                Spacer(Modifier.height(8.dp))
                for (balance in nonZeroBalances) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 4.dp),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text(text = balance.asset, style = MaterialTheme.typography.bodyMedium)
                        Text(text = formatQty(balance.free + balance.locked), style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
        }
    }
}

@Composable
private fun BotCard(bot: BotEntity, onClick: () -> Unit) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .then(Modifier),
        onClick = onClick
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Column {
                Text(text = "${bot.symbol} · ${bot.type.uppercase(Locale.US)}", style = MaterialTheme.typography.titleMedium)
                Text(
                    text = statusLabel(bot.status),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodyMedium
                )
            }
            Column(horizontalAlignment = androidx.compose.ui.Alignment.End) {
                val pnlColor = if (bot.realizedPnlUsdt >= 0) ProfitGreen else LossRed
                Text(
                    text = String.format(Locale.US, "%+.2f USDT", bot.realizedPnlUsdt),
                    color = pnlColor,
                    style = MaterialTheme.typography.titleMedium
                )
            }
        }
    }
}

@Composable
private fun statusLabel(status: String): String = when (status) {
    "running" -> Strings.statusRunning.resolve()
    "paused" -> Strings.statusPaused.resolve()
    else -> Strings.statusStopped.resolve()
}
