package com.copytrade.app.ui.futures

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.copytrade.app.data.remote.dto.FuturesPositionDto
import com.copytrade.app.ui.appViewModel
import com.copytrade.app.ui.components.PollWhileForeground
import com.copytrade.app.ui.strings.Bi
import com.copytrade.app.ui.strings.Strings
import com.copytrade.app.ui.strings.resolve
import com.copytrade.app.ui.theme.LossRed
import com.copytrade.app.ui.theme.ProfitGreen
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.abs

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FuturesHistoryScreen(onBack: () -> Unit) {
    val viewModel = appViewModel { FuturesHistoryViewModel(it) }
    val state by viewModel.uiState.collectAsState()
    var tabIndex by remember { mutableIntStateOf(0) }

    PollWhileForeground { viewModel.refresh() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(Strings.futuresHistoryTitle.resolve()) },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.Filled.ArrowBack, contentDescription = null) }
                }
            )
        }
    ) { padding ->
        Column(modifier = Modifier.fillMaxWidth().padding(padding)) {
            TabRow(selectedTabIndex = tabIndex) {
                Tab(selected = tabIndex == 0, onClick = { tabIndex = 0 }, text = { Text(Strings.openTab.resolve()) })
                Tab(selected = tabIndex == 1, onClick = { tabIndex = 1 }, text = { Text(Strings.historyTab.resolve()) })
            }

            state.error?.let {
                Text(it, color = LossRed, modifier = Modifier.padding(16.dp))
            }

            if (tabIndex == 0) {
                if (state.openPositions.isEmpty()) {
                    Text(
                        Strings.noOpenPositions.resolve(),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(16.dp)
                    )
                } else {
                    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(state.openPositions, key = { it.id }) { position ->
                            PositionCard(position = position, onClose = { viewModel.closePosition(position.id) })
                        }
                    }
                }
            } else {
                if (state.closedPositions.isEmpty()) {
                    Text(
                        Strings.noPositionHistory.resolve(),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(16.dp)
                    )
                } else {
                    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(state.closedPositions, key = { it.id }) { position ->
                            ClosedPositionCard(position = position)
                        }
                    }
                }
            }
        }
    }
}

private fun closeReasonLabel(reason: String?): Bi = when (reason) {
    "take_profit" -> Strings.closeReasonTakeProfit
    "stop_loss" -> Strings.closeReasonStopLoss
    else -> Strings.closeReasonManual
}

private val dateFormat = SimpleDateFormat("MMM d, HH:mm", Locale.US)

@Composable
private fun ClosedPositionCard(position: FuturesPositionDto) {
    val pnl = position.realizedPnlUsdt
    val pnlColor = when {
        pnl == null -> MaterialTheme.colorScheme.onSurfaceVariant
        pnl > 0 -> ProfitGreen
        pnl < 0 -> LossRed
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    val sideColor = if (position.side == "long") ProfitGreen else LossRed

    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(position.symbol, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Text(
                    "${position.side.uppercase(Locale.US)} ${position.leverage.toInt()}x",
                    color = sideColor,
                    style = MaterialTheme.typography.titleMedium
                )
            }
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("${Strings.entryPrice.resolve()}: ${formatPrice(position.entryPrice)}", style = MaterialTheme.typography.bodyMedium)
                position.closePrice?.let {
                    Text("${Strings.closedAtLabel.resolve()}: ${formatPrice(it)}", style = MaterialTheme.typography.bodyMedium)
                }
            }
            position.closedAt?.let {
                Text(
                    dateFormat.format(Date(it)) + " · " + closeReasonLabel(position.closeReason).resolve(),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            if (pnl != null) {
                val sign = if (pnl > 0) "+" else if (pnl < 0) "-" else ""
                Text(
                    "${Strings.realizedPnlLabel.resolve()}: $sign$${"%.2f".format(abs(pnl))}",
                    color = pnlColor,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold
                )
            }
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                position.riskUsdt?.let {
                    Text(
                        "${Strings.riskUsdAmountLabel.resolve()}: $${"%.2f".format(it)}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                position.totalFeeUsdt?.let {
                    Text(
                        "${Strings.tradingFeeLabel.resolve()}: $${"%.4f".format(it)}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        }
    }
}
