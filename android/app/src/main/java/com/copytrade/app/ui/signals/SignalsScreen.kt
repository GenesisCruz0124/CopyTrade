package com.copytrade.app.ui.signals

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.text.KeyboardOptions
import com.copytrade.app.data.remote.dto.SignalDto
import com.copytrade.app.ui.appViewModel
import com.copytrade.app.ui.components.CandlestickChart
import com.copytrade.app.ui.components.ModeBadge
import com.copytrade.app.ui.components.PollWhileForeground
import com.copytrade.app.ui.strings.Strings
import com.copytrade.app.ui.strings.resolve
import com.copytrade.app.ui.theme.LossRed
import com.copytrade.app.ui.theme.ProfitGreen
import kotlinx.coroutines.launch
import java.util.Locale

/** Fixed risk size for the quick "$1 risk trade" action — small enough to test a signal live at minimal cost. */
private const val QUICK_RISK_TRADE_USD = 1.0

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SignalsScreen(onBack: () -> Unit, onTradeSignal: () -> Unit) {
    val viewModel = appViewModel { SignalsViewModel(it) }
    val state by viewModel.uiState.collectAsState()
    val scope = rememberCoroutineScope()
    var expanded by remember { mutableStateOf(false) }

    PollWhileForeground { viewModel.refreshCurrentSelection() }
    val filteredSymbols = remember(state.symbols, state.symbolQuery) {
        if (state.symbolQuery.isBlank()) {
            state.symbols
        } else {
            state.symbols.filter { it.symbol.contains(state.symbolQuery.uppercase()) }
        }.take(50)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(Strings.signalsTitle.resolve()) },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.Filled.ArrowBack, contentDescription = null) }
                },
                actions = {
                    ModeBadge(mode = state.mode, modifier = Modifier.padding(end = 8.dp))
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp)
                .verticalScroll(rememberScrollState())
                .imePadding(),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Deliberately not using ExposedDropdownMenuBox/ExposedDropdownMenu here — that popup-based
            // menu flips to render above the anchor when the keyboard eats vertical space, which ends up
            // covering the very field you're trying to edit. An inline list in the normal layout flow
            // (below, pushing the rest of the form down) can never overlap the input.
            OutlinedTextField(
                value = state.symbolQuery,
                onValueChange = {
                    viewModel.setSymbolQuery(it)
                    expanded = true
                },
                label = { Text(Strings.signalsPairLabel.resolve()) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(
                    capitalization = KeyboardCapitalization.Characters,
                    imeAction = ImeAction.Search
                ),
                trailingIcon = {
                    IconButton(onClick = { expanded = !expanded }) {
                        Icon(Icons.Filled.ArrowDropDown, contentDescription = null)
                    }
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .onFocusChanged { focus ->
                        if (focus.isFocused) {
                            expanded = true
                            if (state.symbolQuery.isNotBlank() && state.symbolQuery == state.selectedSymbol) {
                                viewModel.setSymbolQuery("")
                            }
                        } else if (state.symbolQuery.isBlank() && state.selectedSymbol.isNotBlank()) {
                            viewModel.setSymbolQuery(state.selectedSymbol)
                        }
                    }
            )
            if (expanded && filteredSymbols.isNotEmpty()) {
                Card(
                    modifier = Modifier.fillMaxWidth().heightIn(max = 280.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHigh)
                ) {
                    LazyColumn {
                        items(filteredSymbols, key = { it.symbol }) { symbol ->
                            DropdownMenuItem(
                                text = { Text(symbol.symbol) },
                                onClick = {
                                    viewModel.selectSymbol(symbol.symbol)
                                    expanded = false
                                }
                            )
                        }
                    }
                }
            } else if (expanded && state.symbolsLoadFailed) {
                Text(
                    Strings.signalsPairListUnavailable.resolve(),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            if (state.selectedSymbol.isNotBlank()) {
                Text(
                    text = state.currentPrice?.let { "${Strings.currentPriceLabel.resolve()}: $${formatPrice(it)}" }
                        ?: Strings.loading.resolve(),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                CandlestickChart(state.klines, modifier = Modifier.fillMaxWidth())
            }

            Text(Strings.signalsTimeframe.resolve(), style = MaterialTheme.typography.labelLarge)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SIGNAL_INTERVALS.forEach { interval ->
                    FilterChip(
                        selected = state.interval == interval,
                        onClick = { viewModel.setInterval(interval) },
                        label = { Text(interval) }
                    )
                }
            }

            Button(
                onClick = viewModel::analyze,
                enabled = !state.isLoading && state.symbolQuery.isNotBlank(),
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(if (state.isLoading) Strings.signalsAnalyzing.resolve() else Strings.signalsAnalyze.resolve())
            }

            state.error?.let { message ->
                Text(message, color = LossRed, style = MaterialTheme.typography.bodyMedium)
            }

            when {
                state.isLoading -> {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(top = 24.dp),
                        horizontalArrangement = Arrangement.Center
                    ) {
                        CircularProgressIndicator()
                    }
                }
                state.signal != null -> {
                    SignalResultCard(signal = state.signal!!)
                    IndicatorsCard(signal = state.signal!!)
                    if (state.signal!!.signal != "NEUTRAL") {
                        OutlinedButton(
                            onClick = {
                                scope.launch {
                                    if (viewModel.prepareTradeHandoff()) onTradeSignal()
                                }
                            },
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text(Strings.signalsTradeThis.resolve())
                        }
                        // Same hand-off as "Trade this signal", but also derives the position
                        // size so this trade risks exactly $1 if the suggested stop-loss hits.
                        OutlinedButton(
                            onClick = {
                                scope.launch {
                                    if (viewModel.prepareTradeHandoff(riskUsdAmount = QUICK_RISK_TRADE_USD)) onTradeSignal()
                                }
                            },
                            modifier = Modifier.fillMaxWidth().padding(top = 8.dp)
                        ) {
                            Text(Strings.quickRiskTrade.resolve())
                        }
                        // The risk/reward ratio directly gives the payoff for a fixed $1 risk —
                        // no need to wait for the Futures form to size the position first.
                        state.signal!!.riskRewardRatio?.let { ratio ->
                            Text(
                                text = "≈ $${"%.2f".format(QUICK_RISK_TRADE_USD * ratio)} ${Strings.impliedProfitHint.resolve()}",
                                color = ProfitGreen,
                                style = MaterialTheme.typography.bodySmall,
                                modifier = Modifier.padding(top = 4.dp)
                            )
                        }
                    }
                    Text(
                        Strings.signalsDisclaimer.resolve(),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                else -> {
                    Text(
                        Strings.signalsEmptyHint.resolve(),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 8.dp)
                    )
                }
            }
        }
    }
}

@Composable
private fun SignalResultCard(signal: SignalDto) {
    val accent = when (signal.signal) {
        "LONG" -> ProfitGreen
        "SHORT" -> LossRed
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    val label = when (signal.signal) {
        "LONG" -> Strings.signalsLong.resolve()
        "SHORT" -> Strings.signalsShort.resolve()
        else -> Strings.signalsNeutral.resolve()
    }
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = accent.copy(alpha = 0.12f))
    ) {
        Column(modifier = Modifier.fillMaxWidth().padding(20.dp)) {
            Text(
                "${signal.symbol} · ${signal.interval}",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(Modifier.height(4.dp))
            Text(
                label,
                style = MaterialTheme.typography.displaySmall,
                fontWeight = FontWeight.Bold,
                color = accent
            )
            Text(
                "${Strings.signalConfidence.resolve()}: ${signal.confidence}%",
                style = MaterialTheme.typography.titleMedium
            )
            if (signal.signal == "NEUTRAL") {
                Spacer(Modifier.height(4.dp))
                Text(
                    Strings.signalsNeutralHint.resolve(),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            } else {
                Spacer(Modifier.height(12.dp))
                LevelRow(Strings.signalsSuggestedEntry.resolve(), formatPrice(signal.suggestedEntry), null)
                LevelRow(Strings.signalsStopLoss.resolve(), formatPrice(signal.stopLoss), LossRed)
                LevelRow(Strings.signalsTakeProfit.resolve(), formatPrice(signal.takeProfit), ProfitGreen)
                signal.riskRewardRatio?.let {
                    LevelRow(Strings.signalsRiskReward.resolve(), "1 : ${trimNumber(it)}", null)
                }
            }
            Spacer(Modifier.height(16.dp))
            Text(Strings.signalsWhy.resolve(), style = MaterialTheme.typography.titleSmall)
            Spacer(Modifier.height(4.dp))
            signal.reasons.forEach { reason ->
                Text("• $reason", style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}

@Composable
private fun LevelRow(label: String, value: String, valueColor: Color?) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(
            value,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.SemiBold,
            fontFamily = FontFamily.Monospace,
            color = valueColor ?: MaterialTheme.colorScheme.onSurface
        )
    }
}

@Composable
private fun IndicatorsCard(signal: SignalDto) {
    val ind = signal.indicators
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
    ) {
        Column(modifier = Modifier.fillMaxWidth().padding(16.dp)) {
            Text(Strings.signalsIndicators.resolve(), style = MaterialTheme.typography.titleSmall)
            Spacer(Modifier.height(8.dp))
            LevelRow("Price", formatPrice(ind.price), null)
            LevelRow("EMA fast", formatPrice(ind.emaFast), null)
            LevelRow("EMA slow", formatPrice(ind.emaSlow), null)
            LevelRow("RSI (14)", trimNumber(ind.rsi), rsiColor(ind.rsi))
            LevelRow("MACD hist", trimNumber(ind.macdHistogram), if (ind.macdHistogram >= 0) ProfitGreen else LossRed)
            LevelRow("ATR (14)", formatPrice(ind.atr), null)
        }
    }
}

private fun rsiColor(rsi: Double): Color? = when {
    rsi >= 70 -> LossRed
    rsi <= 30 -> ProfitGreen
    else -> null
}

/** Compact price formatting: adapts decimals so both BTC (large) and micro-caps read well. */
private fun formatPrice(value: Double): String {
    val decimals = when {
        value >= 1000 -> 2
        value >= 1 -> 4
        else -> 8
    }
    return String.format(Locale.US, "%,.${decimals}f", value)
}

private fun trimNumber(value: Double): String {
    return String.format(Locale.US, "%.2f", value).trimEnd('0').trimEnd('.').ifEmpty { "0" }
}
