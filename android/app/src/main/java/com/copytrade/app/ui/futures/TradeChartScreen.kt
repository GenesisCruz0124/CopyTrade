package com.copytrade.app.ui.futures

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.copytrade.app.CopyTradeApp
import com.copytrade.app.ui.components.CandlestickChart
import com.copytrade.app.ui.components.ChartPriceLine
import com.copytrade.app.ui.components.PollWhileForeground
import com.copytrade.app.ui.strings.Strings
import com.copytrade.app.ui.strings.resolve
import com.copytrade.app.ui.theme.AccentBlue
import com.copytrade.app.ui.theme.LossRed
import com.copytrade.app.ui.theme.ProfitGreen
import androidx.compose.ui.platform.LocalContext

/**
 * Tapping an Open or Pending item goes here instead of straight to a static card —
 * a live-ticking chart with entry/SL/TP marked directly on it, the same trade details
 * and quick actions (Modify/Close, or Cancel for a pending order) as the list card.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TradeChartScreen(tradeId: String, kind: TradeChartKind, onBack: () -> Unit) {
    val app = LocalContext.current.applicationContext as CopyTradeApp
    val factory = viewModelFactory { initializer { TradeChartViewModel(app, tradeId, kind) } }
    val viewModel: TradeChartViewModel = viewModel(key = "$kind:$tradeId", factory = factory)
    val state by viewModel.uiState.collectAsState()

    PollWhileForeground { viewModel.refresh() }

    val title = state.position?.symbol ?: state.order?.symbol ?: Strings.futuresTitle.resolve()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(title) },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.Filled.ArrowBack, contentDescription = null) }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            when {
                state.isLoading && state.position == null && state.order == null -> {
                    CircularProgressIndicator(modifier = Modifier.padding(top = 32.dp))
                }
                state.notFound -> {
                    Text(
                        Strings.tradeNoLongerOpen.resolve(),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 16.dp)
                    )
                }
                state.kind == TradeChartKind.POSITION && state.position != null -> {
                    val position = state.position!!
                    Text(
                        "${Strings.currentPriceLabel.resolve()}: ${position.currentPrice?.let { formatPrice(it) } ?: "—"}",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold
                    )
                    val priceLines = buildList {
                        add(ChartPriceLine(position.entryPrice, "Entry", AccentBlue, dashed = false))
                        position.stopLossPrice?.let { add(ChartPriceLine(it, "SL", LossRed)) }
                        position.takeProfitPrice?.let { add(ChartPriceLine(it, "TP", ProfitGreen)) }
                    }
                    CandlestickChart(state.klines, modifier = Modifier.fillMaxWidth(), priceLines = priceLines)
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
                state.kind == TradeChartKind.PENDING_ORDER && state.order != null -> {
                    val order = state.order!!
                    val direction = if (order.side == "long") 1 else -1
                    val tpPrice = order.takeProfitPercent?.let { pct -> order.limitPrice * (1 + direction * pct / 100) }
                    val slPrice = order.stopLossPercent?.let { pct -> order.limitPrice * (1 - direction * pct / 100) }
                    Text(
                        "${Strings.currentPriceLabel.resolve()}: ${state.orderCurrentPrice?.let { formatPrice(it) } ?: "—"}",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold
                    )
                    val priceLines = buildList {
                        add(ChartPriceLine(order.limitPrice, "Limit", AccentBlue, dashed = false))
                        slPrice?.let { add(ChartPriceLine(it, "SL", LossRed)) }
                        tpPrice?.let { add(ChartPriceLine(it, "TP", ProfitGreen)) }
                    }
                    CandlestickChart(state.klines, modifier = Modifier.fillMaxWidth(), priceLines = priceLines)
                    PendingOrderCard(order = order, onCancel = { viewModel.cancelOrder(order.id) })
                }
            }
            state.error?.let { Text(it, color = LossRed) }
        }
    }
}
