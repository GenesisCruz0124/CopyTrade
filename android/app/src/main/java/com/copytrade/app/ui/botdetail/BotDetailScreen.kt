package com.copytrade.app.ui.botdetail

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material3.Card
import androidx.compose.material3.Divider
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.copytrade.app.CopyTradeApp
import com.copytrade.app.data.local.entity.FillEntity
import com.copytrade.app.data.remote.dto.OrderDto
import com.copytrade.app.ui.components.PollWhileForeground
import com.copytrade.app.ui.strings.Strings
import com.copytrade.app.ui.strings.resolve
import com.copytrade.app.ui.theme.LossRed
import com.copytrade.app.ui.theme.ProfitGreen
import com.patrykandpatrick.vico.compose.axis.horizontal.rememberBottomAxis
import com.patrykandpatrick.vico.compose.axis.vertical.rememberStartAxis
import com.patrykandpatrick.vico.compose.chart.Chart
import com.patrykandpatrick.vico.compose.chart.line.lineChart
import com.patrykandpatrick.vico.core.entry.ChartEntryModelProducer
import com.patrykandpatrick.vico.core.entry.entryOf
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BotDetailScreen(botId: String, onBack: () -> Unit) {
    val app = LocalContext.current.applicationContext as CopyTradeApp
    val factory = viewModelFactory { initializer { BotDetailViewModel(app, botId) } }
    val viewModel: BotDetailViewModel = viewModel(key = botId, factory = factory)
    val state by viewModel.uiState.collectAsState()

    PollWhileForeground { viewModel.refresh() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(state.bot?.symbol ?: Strings.botDetailTitle.resolve()) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Filled.ArrowBack, contentDescription = null)
                    }
                },
                actions = {
                    IconButton(onClick = { viewModel.delete(onBack) }) {
                        Icon(Icons.Filled.Delete, contentDescription = Strings.delete.resolve(), tint = LossRed)
                    }
                }
            )
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxWidth()
                .padding(padding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            item { ConfigSummaryCard(state) }
            item { ControlsRow(viewModel) }
            item { PnlChartCard(state) }
            item {
                Text(
                    text = "${Strings.openOrders.resolve()} (${state.openOrders.size})",
                    style = MaterialTheme.typography.titleMedium
                )
            }
            if (state.openOrders.isEmpty()) {
                item { Text(Strings.noOpenOrders.resolve(), color = MaterialTheme.colorScheme.onSurfaceVariant) }
            } else {
                items(state.openOrders, key = { it.id }) { order -> OpenOrderRow(order) }
            }
            item {
                Text(
                    text = "${Strings.recentFills.resolve()} (${state.fills.size})",
                    style = MaterialTheme.typography.titleMedium
                )
            }
            if (state.fills.isEmpty()) {
                item { Text(Strings.noFillsYet.resolve(), color = MaterialTheme.colorScheme.onSurfaceVariant) }
            } else {
                items(state.fills, key = { it.id }) { fill -> FillRow(fill) }
            }
        }
    }
}

@Composable
private fun ConfigSummaryCard(state: BotDetailUiState) {
    val bot = state.bot ?: return
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(text = "${bot.symbol} · ${bot.type.uppercase(Locale.US)}", style = MaterialTheme.typography.titleLarge)
            Text(text = "Budget: ${bot.allocatedUsdt} USDT", style = MaterialTheme.typography.bodyMedium)
            val pnlColor = if (bot.realizedPnlUsdt >= 0) ProfitGreen else LossRed
            Text(
                text = String.format(Locale.US, "Realized PnL: %+.2f USDT", bot.realizedPnlUsdt),
                color = pnlColor,
                style = MaterialTheme.typography.bodyMedium
            )
        }
    }
}

@Composable
private fun ControlsRow(viewModel: BotDetailViewModel) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        IconButton(onClick = viewModel::start) { Icon(Icons.Filled.PlayArrow, contentDescription = Strings.start.resolve()) }
        IconButton(onClick = viewModel::pause) { Icon(Icons.Filled.Pause, contentDescription = Strings.pause.resolve()) }
        IconButton(onClick = viewModel::stop) { Icon(Icons.Filled.Close, contentDescription = Strings.stop.resolve()) }
    }
}

@Composable
private fun PnlChartCard(state: BotDetailUiState) {
    if (state.pnlSeries.isEmpty()) return
    val entries = state.pnlSeries.mapIndexed { index, snapshot -> entryOf(index.toFloat(), snapshot.equityUsdt.toFloat()) }
    val producer = remember(entries) { ChartEntryModelProducer(entries) }

    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(Strings.pnlChart.resolve(), style = MaterialTheme.typography.titleMedium)
            Chart(
                chart = lineChart(),
                chartModelProducer = producer,
                startAxis = rememberStartAxis(),
                bottomAxis = rememberBottomAxis(),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(180.dp)
            )
        }
    }
}

/** Fixed-point, never scientific notation — Double.toString() switches to "1.7E-4" for small crypto quantities. */
private fun formatQty(qty: Double): String = String.format(Locale.US, "%.8f", qty).trimEnd('0').trimEnd('.')

@Composable
private fun FillRow(fill: FillEntity) {
    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(text = "${fill.side} ${formatQty(fill.quantity)}", style = MaterialTheme.typography.bodyMedium)
            Text(text = String.format(Locale.US, "@ %.4f", fill.price), style = MaterialTheme.typography.bodyMedium)
        }
    }
    Divider()
}

@Composable
private fun OpenOrderRow(order: OrderDto) {
    val sideColor = if (order.side == "BUY") ProfitGreen else LossRed
    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(text = "${order.side} ${formatQty(order.quantity)}", color = sideColor, style = MaterialTheme.typography.bodyMedium)
            Text(
                text = order.price?.let { String.format(Locale.US, "@ %.4f", it) } ?: order.type,
                style = MaterialTheme.typography.bodyMedium
            )
        }
    }
    Divider()
}
