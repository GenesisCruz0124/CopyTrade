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
import androidx.compose.ui.Alignment
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CandlestickChart
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Insights
import androidx.compose.material.icons.filled.List
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.PowerSettingsNew
import androidx.compose.material.icons.filled.SmartToy
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Card
import androidx.compose.material.ExperimentalMaterialApi
import androidx.compose.material.pullrefresh.PullRefreshIndicator
import androidx.compose.material.pullrefresh.pullRefresh
import androidx.compose.material.pullrefresh.rememberPullRefreshState
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.copytrade.app.ui.appViewModel
import com.copytrade.app.ui.copysignals.CopySignalsList
import com.copytrade.app.ui.components.ConfirmDialog
import com.copytrade.app.ui.components.FAST_POLL_INTERVAL_MS
import com.copytrade.app.ui.components.ModeBadge
import com.copytrade.app.ui.components.PollWhileForeground
import com.copytrade.app.ui.futures.ClosedPositionCard
import com.copytrade.app.ui.futures.FuturesHistoryViewModel
import com.copytrade.app.ui.futures.PendingOrderCard
import com.copytrade.app.ui.futures.PositionCard
import com.copytrade.app.ui.strings.Strings
import com.copytrade.app.ui.strings.resolve
import com.copytrade.app.ui.theme.LossRed
import com.copytrade.app.ui.theme.ProfitGreen
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterialApi::class)
@Composable
fun DashboardScreen(
    onCreateBot: () -> Unit,
    onOpenTradeLog: () -> Unit,
    onOpenSettings: () -> Unit,
    onOpenCopySignals: () -> Unit,
    onOpenSignals: () -> Unit,
    onOpenActivity: () -> Unit,
    onOpenFutures: () -> Unit,
    onOpenBots: () -> Unit
) {
    val viewModel = appViewModel { DashboardViewModel(it) }
    val state by viewModel.uiState.collectAsState()
    val futuresViewModel = appViewModel { FuturesHistoryViewModel(it) }
    val futuresState by futuresViewModel.uiState.collectAsState()
    var showKillSwitchConfirm by remember { mutableStateOf(false) }
    var showFuturesLiveConfirm by remember { mutableStateOf(false) }
    var showMenu by remember { mutableStateOf(false) }
    var tabIndex by remember { mutableIntStateOf(0) }

    PollWhileForeground(intervalMs = FAST_POLL_INTERVAL_MS) {
        viewModel.refresh(silent = true)
        futuresViewModel.refresh(silent = true)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(Strings.dashboardTitle.resolve()) },
                actions = {
                    IconButton(onClick = { showKillSwitchConfirm = true }) {
                        Icon(Icons.Filled.PowerSettingsNew, contentDescription = Strings.killSwitch.resolve(), tint = LossRed)
                    }
                    IconButton(onClick = { showMenu = true }) {
                        Icon(Icons.Filled.MoreVert, contentDescription = null)
                    }
                    DropdownMenu(expanded = showMenu, onDismissRequest = { showMenu = false }) {
                        DropdownMenuItem(
                            text = { Text(Strings.activeBots.resolve()) },
                            leadingIcon = { Icon(Icons.Filled.SmartToy, contentDescription = null) },
                            onClick = { showMenu = false; onOpenBots() }
                        )
                        DropdownMenuItem(
                            text = { Text(Strings.futuresTitle.resolve()) },
                            leadingIcon = { Icon(Icons.Filled.CandlestickChart, contentDescription = null) },
                            onClick = { showMenu = false; onOpenFutures() }
                        )
                        DropdownMenuItem(
                            text = { Text(Strings.tradeLogTitle.resolve()) },
                            leadingIcon = { Icon(Icons.Filled.List, contentDescription = null) },
                            onClick = { showMenu = false; onOpenTradeLog() }
                        )
                        DropdownMenuItem(
                            text = { Text(Strings.copySignalsTitle.resolve()) },
                            leadingIcon = { Icon(Icons.Filled.Notifications, contentDescription = null) },
                            onClick = { showMenu = false; onOpenCopySignals() }
                        )
                        DropdownMenuItem(
                            text = { Text(Strings.signalsTitle.resolve()) },
                            leadingIcon = { Icon(Icons.Filled.Insights, contentDescription = null) },
                            onClick = { showMenu = false; onOpenSignals() }
                        )
                        DropdownMenuItem(
                            text = { Text(Strings.activityTitle.resolve()) },
                            leadingIcon = { Icon(Icons.Filled.History, contentDescription = null) },
                            onClick = { showMenu = false; onOpenActivity() }
                        )
                        DropdownMenuItem(
                            text = { Text(Strings.settingsTitle.resolve()) },
                            leadingIcon = { Icon(Icons.Filled.Settings, contentDescription = null) },
                            onClick = { showMenu = false; onOpenSettings() }
                        )
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
        val pullRefreshState = rememberPullRefreshState(
            refreshing = state.isRefreshing || futuresState.isLoading,
            onRefresh = { viewModel.refresh(); futuresViewModel.refresh() }
        )
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .pullRefresh(pullRefreshState)
        ) {
            Column(modifier = Modifier.fillMaxSize()) {
                FuturesBalanceCard(
                    state = state,
                    onToggleFuturesLive = { live ->
                        if (live) showFuturesLiveConfirm = true else viewModel.setFuturesTradingMode(false)
                    },
                    modifier = Modifier.padding(16.dp)
                )

                state.error?.let {
                    Text(it, color = LossRed, modifier = Modifier.padding(horizontal = 16.dp))
                }
                futuresState.error?.let {
                    Text(it, color = LossRed, modifier = Modifier.padding(horizontal = 16.dp))
                }

                TabRow(selectedTabIndex = tabIndex) {
                    Tab(selected = tabIndex == 0, onClick = { tabIndex = 0 }, text = { Text(Strings.openTab.resolve()) })
                    Tab(selected = tabIndex == 1, onClick = { tabIndex = 1 }, text = { Text(Strings.pendingTab.resolve()) })
                    Tab(selected = tabIndex == 2, onClick = { tabIndex = 2 }, text = { Text(Strings.historyTab.resolve()) })
                    Tab(selected = tabIndex == 3, onClick = { tabIndex = 3 }, text = { Text(Strings.signalsTab.resolve()) })
                }

                when (tabIndex) {
                    0 -> if (futuresState.openPositions.isEmpty()) {
                        Text(
                            Strings.noOpenPositions.resolve(),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(16.dp)
                        )
                    } else {
                        LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            items(futuresState.openPositions, key = { it.id }) { position ->
                                PositionCard(position = position, onClose = { futuresViewModel.closePosition(position.id) })
                            }
                        }
                    }
                    1 -> if (futuresState.pendingOrders.isEmpty()) {
                        Text(
                            Strings.noPendingOrders.resolve(),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(16.dp)
                        )
                    } else {
                        LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            items(futuresState.pendingOrders, key = { it.id }) { order ->
                                PendingOrderCard(order = order, onCancel = { futuresViewModel.cancelOrder(order.id) })
                            }
                        }
                    }
                    2 -> if (futuresState.closedPositions.isEmpty()) {
                        Text(
                            Strings.noPositionHistory.resolve(),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(16.dp)
                        )
                    } else {
                        LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            items(futuresState.closedPositions, key = { it.id }) { position ->
                                ClosedPositionCard(position = position)
                            }
                        }
                    }
                    else -> CopySignalsList(onOpenFutures = onOpenFutures)
                }
            }
            PullRefreshIndicator(
                refreshing = state.isRefreshing || futuresState.isLoading,
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

    if (showFuturesLiveConfirm) {
        ConfirmDialog(
            title = Strings.accountLiveConfirmTitle,
            message = Strings.accountLiveConfirmMessage,
            confirmLabel = Strings.confirm,
            cancelLabel = Strings.cancel,
            onConfirm = {
                showFuturesLiveConfirm = false
                viewModel.setFuturesTradingMode(true)
            },
            onDismiss = { showFuturesLiveConfirm = false }
        )
    }
}

/**
 * Futures-only by design — spot trading is still shared/global paper money
 * (not real, not per-user, see DashboardUiState.mode kdoc), so surfacing it
 * here just added confusing clutter next to real per-user futures balances.
 */
@Composable
private fun FuturesBalanceCard(
    state: DashboardUiState,
    onToggleFuturesLive: (Boolean) -> Unit,
    modifier: Modifier = Modifier
) {
    Card(modifier = modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(text = Strings.futuresAvailable.resolve(), color = MaterialTheme.colorScheme.onSurfaceVariant)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    state.futuresMode?.let { fMode -> ModeBadge(mode = fMode, modifier = Modifier.padding(end = 8.dp)) }
                    if (state.canManageFuturesMode) {
                        Switch(
                            checked = state.futuresMode == "live",
                            onCheckedChange = onToggleFuturesLive,
                            enabled = !state.isUpdatingFuturesMode
                        )
                    }
                }
            }
            Spacer(Modifier.height(4.dp))
            Text(
                text = state.futuresAvailableUsdt?.let { String.format(Locale.US, "%.2f USDT", it) } ?: "— USDT",
                style = MaterialTheme.typography.headlineMedium
            )

            state.futuresTodayPnl?.let { pnl ->
                Spacer(Modifier.height(8.dp))
                Row(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(
                        text = Strings.futuresTodayPnl.resolve(),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodyMedium
                    )
                    val pnlColor = if (pnl.realizedPnlUsdt >= 0) ProfitGreen else LossRed
                    val sign = if (pnl.realizedPnlUsdt >= 0) "+" else ""
                    val percentText = pnl.realizedPnlPercent?.let { String.format(Locale.US, " (%s%.2f%%)", sign, it) } ?: ""
                    Text(
                        text = String.format(Locale.US, "%s%.2f USDT%s", sign, pnl.realizedPnlUsdt, percentText),
                        color = pnlColor,
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.SemiBold
                    )
                }
            }
        }
    }
}
