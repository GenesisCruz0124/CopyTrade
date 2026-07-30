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
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.copytrade.app.data.remote.dto.FuturesPendingOrderDto
import com.copytrade.app.data.remote.dto.FuturesPositionDto
import com.copytrade.app.data.remote.dto.FuturesTodayPnlDto
import androidx.compose.material3.OutlinedButton
import com.copytrade.app.ui.appViewModel
import com.copytrade.app.ui.components.ModeBadge
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
                },
                actions = { ModeBadge(mode = state.mode, modifier = Modifier.padding(end = 8.dp)) }
            )
        }
    ) { padding ->
        Column(modifier = Modifier.fillMaxWidth().padding(padding)) {
            state.todayPnl?.let { TodayPnlCard(it, modifier = Modifier.fillMaxWidth().padding(16.dp)) }

            TabRow(selectedTabIndex = tabIndex) {
                Tab(selected = tabIndex == 0, onClick = { tabIndex = 0 }, text = { Text(Strings.openTab.resolve()) })
                Tab(selected = tabIndex == 1, onClick = { tabIndex = 1 }, text = { Text(Strings.pendingTab.resolve()) })
                Tab(selected = tabIndex == 2, onClick = { tabIndex = 2 }, text = { Text(Strings.historyTab.resolve()) })
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
                            PositionCard(
                                position = position,
                                onClose = { viewModel.closePosition(position.id) },
                                onSetTakeProfitByPnlPercent = { pct -> viewModel.setTakeProfitByPnlPercent(position.id, pct) },
                                onSetTakeProfitByPrice = { price -> viewModel.setTakeProfitByPrice(position.id, price) },
                                onSetStopLossByRiskUsd = { risk -> viewModel.setStopLossByRiskUsd(position.id, risk) },
                                onSetStopLossByPrice = { price -> viewModel.setStopLossByPrice(position.id, price) },
                                phpRate = state.usdToPhpRate
                            )
                        }
                    }
                }
            } else if (tabIndex == 1) {
                if (state.pendingOrders.isEmpty()) {
                    Text(
                        Strings.noPendingOrders.resolve(),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(16.dp)
                    )
                } else {
                    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(state.pendingOrders, key = { it.id }) { order ->
                            PendingOrderCard(order = order, onCancel = { viewModel.cancelOrder(order.id) })
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
                    ClosedPositionsList(positions = state.closedPositions, phpRate = state.usdToPhpRate)
                }
            }
        }
    }
}

@Composable
private fun TodayPnlCard(pnl: FuturesTodayPnlDto, modifier: Modifier = Modifier) {
    val color = when {
        pnl.realizedPnlUsdt > 0 -> ProfitGreen
        pnl.realizedPnlUsdt < 0 -> LossRed
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    val sign = if (pnl.realizedPnlUsdt > 0) "+" else if (pnl.realizedPnlUsdt < 0) "-" else ""

    Card(modifier = modifier) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(Strings.todaysPnlLabel.resolve(), style = MaterialTheme.typography.bodyMedium)
            Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                Text(
                    "$sign$${"%.2f".format(abs(pnl.realizedPnlUsdt))}",
                    color = color,
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold
                )
                pnl.realizedPnlPercent?.let {
                    Text(
                        " ($sign${"%.2f".format(abs(it))}%)",
                        color = color,
                        style = MaterialTheme.typography.titleMedium
                    )
                }
            }
        }
    }
}

@Composable
internal fun PendingOrderCard(order: FuturesPendingOrderDto, onCancel: () -> Unit) {
    val sideColor = if (order.side == "long") ProfitGreen else LossRed

    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(order.symbol, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Text(
                    "${order.side.uppercase(Locale.US)} ${order.leverage.toInt()}x",
                    color = sideColor,
                    style = MaterialTheme.typography.titleMedium
                )
            }
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("${Strings.limitPriceLabel.resolve()}: ${formatPrice(order.limitPrice)}", style = MaterialTheme.typography.bodyMedium)
                Text("${Strings.pendingStatusLabel.resolve()}: ${order.status}", style = MaterialTheme.typography.bodyMedium)
            }
            if (order.filledQuantity > 0) {
                Text(
                    "${Strings.filledLabel.resolve()}: ${order.filledQuantity}/${order.quantity}" +
                        (order.filledPrice?.let { " @ ${formatPrice(it)}" } ?: ""),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                order.riskUsdt?.let {
                    Text(
                        "${Strings.riskUsdAmountLabel.resolve()}: $${"%.2f".format(it)}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                Text(
                    dateFormat.format(Date(order.createdAt)),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            OutlinedButton(onClick = onCancel, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
                Text(Strings.cancelOrder.resolve(), color = LossRed)
            }
        }
    }
}

private data class DayGroup(val dateLabel: String, val totalPnl: Double, val positions: List<FuturesPositionDto>)
private data class MonthGroup(val monthLabel: String, val totalPnl: Double, val days: List<DayGroup>)

private val dayHeaderFormat = SimpleDateFormat("EEEE, MMM d", Locale.US)
private val monthHeaderFormat = SimpleDateFormat("MMMM yyyy", Locale.US)
private val dayKeyFormat = SimpleDateFormat("yyyyMMdd", Locale.US)
private val monthKeyFormat = SimpleDateFormat("yyyyMM", Locale.US)

/** Buckets closed positions by day, then by month, summing realized PnL at each level.
 *  Assumes [positions] already arrives newest-first (the engine returns history that way) —
 *  bucketing preserves encounter order rather than re-sorting. */
private fun groupClosedPositionsByDayAndMonth(positions: List<FuturesPositionDto>): List<MonthGroup> {
    data class DayBucket(val date: Date, val items: MutableList<FuturesPositionDto> = mutableListOf())

    val dayBuckets = LinkedHashMap<String, DayBucket>()
    val dayKeysByMonth = LinkedHashMap<String, MutableList<String>>()

    for (position in positions) {
        val closedAt = position.closedAt ?: continue
        val date = Date(closedAt)
        val dayKey = dayKeyFormat.format(date)
        val monthKey = monthKeyFormat.format(date)
        val isNewDay = dayKey !in dayBuckets
        dayBuckets.getOrPut(dayKey) { DayBucket(date) }.items.add(position)
        if (isNewDay) dayKeysByMonth.getOrPut(monthKey) { mutableListOf() }.add(dayKey)
    }

    return dayKeysByMonth.map { (_, dayKeys) ->
        val days = dayKeys.map { dayKey ->
            val bucket = dayBuckets.getValue(dayKey)
            DayGroup(
                dateLabel = dayHeaderFormat.format(bucket.date),
                totalPnl = bucket.items.sumOf { it.realizedPnlUsdt ?: 0.0 },
                positions = bucket.items
            )
        }
        MonthGroup(
            monthLabel = monthHeaderFormat.format(dayBuckets.getValue(dayKeys.first()).date),
            totalPnl = days.sumOf { it.totalPnl },
            days = days
        )
    }
}

@Composable
private fun PnlSummaryRow(label: String, totalPnl: Double, style: TextStyle) {
    val color = when {
        totalPnl > 0 -> ProfitGreen
        totalPnl < 0 -> LossRed
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    val sign = if (totalPnl > 0) "+" else if (totalPnl < 0) "-" else ""
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(label, style = style, fontWeight = FontWeight.Bold)
        Text("$sign$${"%.2f".format(abs(totalPnl))}", style = style, color = color, fontWeight = FontWeight.Bold)
    }
}

/** Closed-position history grouped by day (with a daily PnL total) and by month
 *  (with a monthly PnL total) — shared by the Dashboard's History tab and the
 *  standalone Futures history screen so both list the same way. */
@Composable
internal fun ClosedPositionsList(positions: List<FuturesPositionDto>, phpRate: Double?, modifier: Modifier = Modifier) {
    val monthGroups = remember(positions) { groupClosedPositionsByDayAndMonth(positions) }
    LazyColumn(modifier = modifier, contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        monthGroups.forEach { month ->
            item(key = "month-${month.monthLabel}") {
                PnlSummaryRow(month.monthLabel, month.totalPnl, MaterialTheme.typography.titleMedium)
            }
            month.days.forEach { day ->
                item(key = "day-${month.monthLabel}-${day.dateLabel}") {
                    PnlSummaryRow(day.dateLabel, day.totalPnl, MaterialTheme.typography.bodyMedium)
                }
                items(day.positions, key = { it.id }) { position ->
                    ClosedPositionCard(position = position, phpRate = phpRate)
                }
            }
        }
    }
}

internal fun closeReasonLabel(reason: String?): Bi = when (reason) {
    "take_profit" -> Strings.closeReasonTakeProfit
    "stop_loss" -> Strings.closeReasonStopLoss
    else -> Strings.closeReasonManual
}

internal val dateFormat = SimpleDateFormat("MMM d, HH:mm", Locale.US)

@Composable
internal fun ClosedPositionCard(position: FuturesPositionDto, phpRate: Double? = null) {
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
                position.totalFeeUsdt?.let { fee ->
                    val phpText = phpRate?.let { rate -> " (≈₱${"%.2f".format(fee * rate)})" } ?: ""
                    Text(
                        "${Strings.tradingFeeLabel.resolve()}: $${"%.4f".format(fee)}$phpText",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        }
    }
}
