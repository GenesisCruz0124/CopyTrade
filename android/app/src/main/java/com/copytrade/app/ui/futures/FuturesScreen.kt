package com.copytrade.app.ui.futures

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.StarBorder
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Divider
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import kotlinx.coroutines.launch
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import com.copytrade.app.data.remote.dto.FuturesPositionDto
import com.copytrade.app.ui.appViewModel
import com.copytrade.app.ui.components.CandlestickChart
import com.copytrade.app.ui.components.ConfirmDialog
import com.copytrade.app.ui.components.FAST_POLL_INTERVAL_MS
import com.copytrade.app.ui.components.ModeBadge
import com.copytrade.app.ui.components.PollWhileForeground
import com.copytrade.app.ui.strings.Strings
import com.copytrade.app.ui.strings.resolve
import com.copytrade.app.ui.theme.LossRed
import com.copytrade.app.ui.theme.PaperOrange
import com.copytrade.app.ui.theme.ProfitGreen
import java.util.Locale
import kotlin.math.abs

internal fun formatPrice(price: Double): String = String.format(Locale.US, "%.8f", price).trimEnd('0').trimEnd('.')

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FuturesScreen(onBack: () -> Unit, onOpenHistory: () -> Unit) {
    val viewModel = appViewModel { FuturesViewModel(it) }
    val state by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val positionOpenedMessage = Strings.positionOpened.resolve()
    val orderPlacedMessage = Strings.orderPlaced.resolve()

    PollWhileForeground(intervalMs = FAST_POLL_INTERVAL_MS) { viewModel.refresh() }

    LaunchedEffect(state.opened) {
        if (state.opened) {
            val message = if (state.orderType == OrderTypeMode.LIMIT) orderPlacedMessage else positionOpenedMessage
            scope.launch { snackbarHostState.showSnackbar(message) }
            viewModel.consumeOpened()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(Strings.futuresTitle.resolve()) },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.Filled.ArrowBack, contentDescription = null) }
                },
                actions = {
                    ModeBadge(mode = state.mode, modifier = Modifier.padding(end = 8.dp))
                    IconButton(onClick = onOpenHistory) {
                        Icon(Icons.Filled.History, contentDescription = Strings.futuresHistoryTitle.resolve())
                    }
                }
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) }
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
            if (state.notConfigured) {
                Text(Strings.futuresNotConfigured.resolve(), color = MaterialTheme.colorScheme.onSurfaceVariant)
                return@Column
            }

            state.balance?.let { balance ->
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text(Strings.availableBalance.resolve(), style = MaterialTheme.typography.bodyMedium)
                        Text(
                            "$${"%.2f".format(balance.availableBalance)} USDT",
                            style = MaterialTheme.typography.headlineSmall
                        )
                    }
                }
            }

            OpenPositionForm(state = state, viewModel = viewModel)

            Divider()

            Text(Strings.openPositions.resolve(), style = MaterialTheme.typography.titleMedium)
            if (state.positions.isEmpty()) {
                Text(Strings.noOpenPositions.resolve(), color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    state.positions.forEach { position ->
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
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun OpenPositionForm(state: FuturesUiState, viewModel: FuturesViewModel) {
    var expanded by remember { mutableStateOf(false) }
    val filteredSymbols = remember(state.symbols, state.symbolQuery, state.favorites) {
        val matches = if (state.symbolQuery.isBlank()) {
            state.symbols
        } else {
            state.symbols.filter { it.symbol.contains(state.symbolQuery.uppercase()) }
        }
        val (favorites, others) = matches.partition { it.symbol in state.favorites }
        (favorites.sortedBy { it.symbol } + others).take(50)
    }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(Strings.tokenPair.resolve(), style = MaterialTheme.typography.titleMedium)
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
            label = { Text(Strings.searchTokenPair.resolve()) },
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
                        // Tapping a field that still shows the previously picked symbol only ever
                        // matched itself in the list, making it look locked — clear it so the
                        // full/favorites list shows and typing starts a fresh search.
                        if (state.symbolQuery.isNotBlank() && state.symbolQuery == state.selectedSymbol) {
                            viewModel.setSymbolQuery("")
                        }
                    } else if (state.symbolQuery.isBlank() && state.selectedSymbol.isNotBlank()) {
                        // Tapped away without picking anything — restore the prior selection
                        // instead of leaving the field empty.
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
                        val isFavorite = symbol.symbol in state.favorites
                        DropdownMenuItem(
                            text = { Text("${symbol.symbol} (max ${symbol.maxLeverage.toInt()}x)") },
                            leadingIcon = {
                                IconButton(onClick = { viewModel.toggleFavorite(symbol.symbol) }) {
                                    Icon(
                                        if (isFavorite) Icons.Filled.Star else Icons.Outlined.StarBorder,
                                        contentDescription = null,
                                        tint = if (isFavorite) PaperOrange else MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                }
                            },
                            onClick = {
                                viewModel.selectSymbol(symbol.symbol)
                                expanded = false
                            }
                        )
                    }
                }
            }
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

        SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
            SegmentedButton(
                selected = state.side == "long",
                onClick = { viewModel.setSide("long") },
                shape = SegmentedButtonDefaults.itemShape(0, 2)
            ) { Text(Strings.openLong.resolve(), color = if (state.side == "long") ProfitGreen else MaterialTheme.colorScheme.onSurface) }
            SegmentedButton(
                selected = state.side == "short",
                onClick = { viewModel.setSide("short") },
                shape = SegmentedButtonDefaults.itemShape(1, 2)
            ) { Text(Strings.openShort.resolve(), color = if (state.side == "short") LossRed else MaterialTheme.colorScheme.onSurface) }
        }

        Text(Strings.orderTypeLabel.resolve(), style = MaterialTheme.typography.bodyMedium)
        SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
            SegmentedButton(
                selected = state.orderType == OrderTypeMode.MARKET,
                onClick = { viewModel.setOrderType(OrderTypeMode.MARKET) },
                shape = SegmentedButtonDefaults.itemShape(0, 2)
            ) { Text(Strings.orderTypeMarket.resolve()) }
            SegmentedButton(
                selected = state.orderType == OrderTypeMode.LIMIT,
                onClick = { viewModel.setOrderType(OrderTypeMode.LIMIT) },
                shape = SegmentedButtonDefaults.itemShape(1, 2)
            ) { Text(Strings.orderTypeLimit.resolve()) }
        }
        if (state.orderType == OrderTypeMode.LIMIT) {
            OutlinedTextField(
                value = state.limitPrice,
                onValueChange = viewModel::setLimitPrice,
                label = { Text(Strings.limitPriceLabel.resolve()) },
                keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Decimal),
                modifier = Modifier.fillMaxWidth()
            )
        }

        OutlinedTextField(
            value = state.leverage,
            onValueChange = viewModel::setLeverage,
            label = { Text("${Strings.leverage.resolve()} (x)") },
            keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Number),
            modifier = Modifier.fillMaxWidth()
        )

        Text(Strings.marginMode.resolve(), style = MaterialTheme.typography.bodyMedium)
        SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
            SegmentedButton(
                selected = state.openType == "isolated",
                onClick = { viewModel.setOpenType("isolated") },
                shape = SegmentedButtonDefaults.itemShape(0, 2)
            ) { Text(Strings.isolated.resolve()) }
            SegmentedButton(
                selected = state.openType == "cross",
                onClick = { viewModel.setOpenType("cross") },
                shape = SegmentedButtonDefaults.itemShape(1, 2)
            ) { Text(Strings.cross.resolve()) }
        }

        SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
            SegmentedButton(
                selected = state.sizingMode == SizingMode.USD,
                onClick = { viewModel.setSizingMode(SizingMode.USD) },
                shape = SegmentedButtonDefaults.itemShape(0, 2)
            ) { Text(Strings.sizeByUsd.resolve()) }
            SegmentedButton(
                selected = state.sizingMode == SizingMode.PERCENT,
                onClick = { viewModel.setSizingMode(SizingMode.PERCENT) },
                shape = SegmentedButtonDefaults.itemShape(1, 2)
            ) { Text(Strings.sizeByPercent.resolve()) }
        }
        if (state.sizingMode == SizingMode.USD) {
            OutlinedTextField(
                value = state.amountUsd,
                onValueChange = viewModel::setAmountUsd,
                label = { Text(Strings.amountUsdLabel.resolve()) },
                keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Decimal),
                modifier = Modifier.fillMaxWidth()
            )
        } else {
            OutlinedTextField(
                value = state.percentOfBalance,
                onValueChange = viewModel::setPercentOfBalance,
                label = { Text(Strings.percentOfBalanceLabel.resolve()) },
                keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Decimal),
                modifier = Modifier.fillMaxWidth()
            )
        }

        SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
            SegmentedButton(
                selected = state.takeProfitInputMode == TpInputMode.PERCENT,
                onClick = { viewModel.setTakeProfitInputMode(TpInputMode.PERCENT) },
                shape = SegmentedButtonDefaults.itemShape(0, 2)
            ) { Text(Strings.takeProfitByPercent.resolve()) }
            SegmentedButton(
                selected = state.takeProfitInputMode == TpInputMode.PRICE,
                onClick = { viewModel.setTakeProfitInputMode(TpInputMode.PRICE) },
                shape = SegmentedButtonDefaults.itemShape(1, 2)
            ) { Text(Strings.takeProfitByPrice.resolve()) }
        }
        // Profit-side mirror of the risk read-out below: shows what this size + TP nets.
        val profitHint: (@Composable () -> Unit)? = state.impliedProfitUsdt?.let { profit ->
            { Text("≈ $${"%.2f".format(profit)} ${Strings.impliedProfitHint.resolve()}", color = ProfitGreen) }
        }
        if (state.takeProfitInputMode == TpInputMode.PERCENT) {
            OutlinedTextField(
                value = state.takeProfitPercent,
                onValueChange = viewModel::setTakeProfitPercent,
                label = { Text(Strings.takeProfitPercentLabel.resolve()) },
                supportingText = profitHint,
                keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Decimal),
                modifier = Modifier.fillMaxWidth()
            )
        } else {
            OutlinedTextField(
                value = state.takeProfitPriceUsd,
                onValueChange = viewModel::setTakeProfitPriceUsd,
                label = { Text(Strings.takeProfitPriceLabel.resolve()) },
                isError = state.takeProfitPriceError != null,
                supportingText = state.takeProfitPriceError?.let { { Text(it, color = LossRed) } } ?: profitHint,
                keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Decimal),
                modifier = Modifier.fillMaxWidth()
            )
        }
        SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
            SegmentedButton(
                selected = state.stopLossInputMode == SlInputMode.PERCENT,
                onClick = { viewModel.setStopLossInputMode(SlInputMode.PERCENT) },
                shape = SegmentedButtonDefaults.itemShape(0, 2)
            ) { Text(Strings.stopLossByPercent.resolve()) }
            SegmentedButton(
                selected = state.stopLossInputMode == SlInputMode.PRICE,
                onClick = { viewModel.setStopLossInputMode(SlInputMode.PRICE) },
                shape = SegmentedButtonDefaults.itemShape(1, 2)
            ) { Text(Strings.stopLossByPrice.resolve()) }
        }
        if (state.stopLossInputMode == SlInputMode.PERCENT) {
            OutlinedTextField(
                value = state.stopLossPercent,
                onValueChange = viewModel::setStopLossPercent,
                label = { Text(Strings.stopLossPercentLabel.resolve()) },
                keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Decimal),
                modifier = Modifier.fillMaxWidth()
            )
        } else {
            OutlinedTextField(
                value = state.stopLossPriceUsd,
                onValueChange = viewModel::setStopLossPriceUsd,
                label = { Text(Strings.stopLossPriceLabel.resolve()) },
                isError = state.stopLossPriceError != null,
                supportingText = state.stopLossPriceError?.let { { Text(it, color = LossRed) } },
                keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Decimal),
                modifier = Modifier.fillMaxWidth()
            )
        }
        OutlinedTextField(
            value = state.riskUsdAmount,
            onValueChange = viewModel::setRiskUsdAmount,
            label = { Text(Strings.riskUsdAmountLabel.resolve()) },
            supportingText = {
                val autoRisk = state.impliedRiskUsdt
                if (state.riskUsdAmount.isBlank() && autoRisk != null) {
                    // Reverse of the risk->size flow: show what this size + stop-loss risks.
                    Text(
                        "≈ $${"%.2f".format(autoRisk)} ${Strings.riskUsdAmountAuto.resolve()}",
                        color = ProfitGreen
                    )
                } else {
                    Text(
                        if (state.stopLossInputMode == SlInputMode.PERCENT) {
                            Strings.riskUsdAmountHintPercent.resolve()
                        } else {
                            Strings.riskUsdAmountHintPrice.resolve()
                        }
                    )
                }
            },
            keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Decimal),
            modifier = Modifier.fillMaxWidth()
        )

        if (state.mode == "live") {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = state.confirmLive, onCheckedChange = viewModel::setConfirmLive)
                Text(Strings.confirmLive.resolve())
            }
        }

        state.error?.let { Text(it, color = LossRed) }

        Button(
            onClick = viewModel::openPosition,
            enabled = !state.isSubmitting,
            modifier = Modifier.fillMaxWidth()
        ) {
            Text(Strings.openPosition.resolve())
        }
    }
}

/** A single stat in a position card's grid: a small underlined muted label
 *  above a bold value — mirrors MEXC's futures position card layout. */
@Composable
private fun StatCell(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    valueColor: Color = MaterialTheme.colorScheme.onSurface
) {
    Column(modifier = modifier) {
        Text(
            label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textDecoration = TextDecoration.Underline
        )
        Spacer(Modifier.height(2.dp))
        Text(value, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, color = valueColor)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun PositionCard(
    position: FuturesPositionDto,
    onClose: () -> Unit,
    onSetTakeProfitByPnlPercent: (Double) -> Unit = {},
    onSetTakeProfitByPrice: (Double) -> Unit = {},
    onSetStopLossByRiskUsd: (Double) -> Unit = {},
    onSetStopLossByPrice: (Double) -> Unit = {},
    phpRate: Double? = null
) {
    var showCloseConfirm by remember { mutableStateOf(false) }
    var showTpDialog by remember { mutableStateOf(false) }
    var showSlDialog by remember { mutableStateOf(false) }
    val pnlUsdt = position.unrealizedPnlUsdt
    val pnlPercent = position.unrealizedPnlPercent
    val pnlColor = when {
        pnlUsdt == null -> MaterialTheme.colorScheme.onSurfaceVariant
        pnlUsdt > 0 -> ProfitGreen
        pnlUsdt < 0 -> LossRed
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    val sideColor = if (position.side == "long") ProfitGreen else LossRed

    Card(modifier = Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text(position.symbol, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Text(
                    position.side.uppercase(Locale.US),
                    color = sideColor,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold
                )
            }
            Spacer(Modifier.height(6.dp))
            Box(
                modifier = Modifier
                    .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(50))
                    .padding(horizontal = 10.dp, vertical = 4.dp)
            ) {
                Text(
                    "${position.openType.replaceFirstChar { it.uppercase() }} ${position.leverage.toInt()}x",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            Spacer(Modifier.height(14.dp))

            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Bottom) {
                Text(
                    Strings.unrealizedPnlLabel.resolve(),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textDecoration = TextDecoration.Underline
                )
                if (pnlUsdt != null && pnlPercent != null) {
                    val sign = if (pnlUsdt > 0) "+" else if (pnlUsdt < 0) "-" else ""
                    Column(horizontalAlignment = Alignment.End) {
                        Text(
                            "$sign$${"%.2f".format(abs(pnlUsdt))} ($sign${"%.2f".format(abs(pnlPercent))}%)",
                            color = pnlColor,
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold
                        )
                        phpRate?.let { rate ->
                            Text(
                                "$sign₱${"%.2f".format(abs(pnlUsdt) * rate)}",
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                style = MaterialTheme.typography.bodySmall
                            )
                        }
                    }
                }
            }
            Spacer(Modifier.height(14.dp))

            Row(modifier = Modifier.fillMaxWidth()) {
                StatCell(Strings.marginLabel.resolve(), "$${"%.2f".format(position.marginUsdt)}", Modifier.weight(1f))
                StatCell(Strings.quantityLabel.resolve(), formatPrice(position.quantity), Modifier.weight(1f))
            }
            Spacer(Modifier.height(10.dp))
            Row(modifier = Modifier.fillMaxWidth()) {
                StatCell(Strings.entryPrice.resolve(), formatPrice(position.entryPrice), Modifier.weight(1f))
                StatCell(
                    Strings.currentPriceLabel.resolve(),
                    position.currentPrice?.let { formatPrice(it) } ?: "—",
                    Modifier.weight(1f)
                )
            }
            if (position.stopLossPrice != null || position.takeProfitPrice != null) {
                Spacer(Modifier.height(10.dp))
                Row(modifier = Modifier.fillMaxWidth()) {
                    StatCell(
                        Strings.signalsStopLoss.resolve(),
                        position.stopLossPrice?.let { formatPrice(it) } ?: "—",
                        Modifier.weight(1f),
                        valueColor = if (position.stopLossPrice != null) LossRed else MaterialTheme.colorScheme.onSurface
                    )
                    val direction = if (position.side == "long") 1 else -1
                    val tpImpliedProfitUsdt = position.takeProfitPrice?.let { tp ->
                        (tp - position.entryPrice) * position.quantity * position.contractSize * direction
                    }
                    StatCell(
                        Strings.signalsTakeProfit.resolve(),
                        position.takeProfitPrice?.let { tp ->
                            val profitText = tpImpliedProfitUsdt?.let { profit ->
                                // Same ROE% the card's own PnL line and the "Edit TP" dialog use —
                                // lets the two stay directly comparable at a glance.
                                val tpPnlPercent = profit / position.marginUsdt * 100
                                val phpText = phpRate?.let { rate -> " (≈₱${"%.2f".format(profit * rate)})" } ?: ""
                                "\n+$${"%.2f".format(profit)} (+${"%.2f".format(tpPnlPercent)}%)$phpText"
                            } ?: ""
                            "${formatPrice(tp)}$profitText"
                        } ?: "—",
                        Modifier.weight(1f),
                        valueColor = if (position.takeProfitPrice != null) ProfitGreen else MaterialTheme.colorScheme.onSurface
                    )
                }
            }
            Spacer(Modifier.height(10.dp))
            Row(modifier = Modifier.fillMaxWidth()) {
                StatCell(
                    Strings.riskUsdAmountLabel.resolve(),
                    position.riskUsdt?.let { "$${"%.2f".format(it)}" } ?: "—",
                    Modifier.weight(1f)
                )
                StatCell(
                    Strings.tradingFeeLabel.resolve(),
                    position.totalFeeUsdt?.let { fee ->
                        val phpText = phpRate?.let { rate -> " (≈₱${"%.2f".format(fee * rate)})" } ?: ""
                        "$${"%.4f".format(fee)}$phpText"
                    } ?: "—",
                    Modifier.weight(1f)
                )
            }

            Row(modifier = Modifier.fillMaxWidth().padding(top = 14.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(
                    onClick = { showSlDialog = true },
                    shape = RoundedCornerShape(50),
                    modifier = Modifier.weight(1f)
                ) {
                    Text(
                        if (position.stopLossPrice != null) Strings.editStopLoss.resolve() else Strings.setStopLoss.resolve(),
                        color = LossRed
                    )
                }
                OutlinedButton(
                    onClick = { showTpDialog = true },
                    shape = RoundedCornerShape(50),
                    modifier = Modifier.weight(1f)
                ) {
                    Text(
                        if (position.takeProfitPrice != null) Strings.editTakeProfit.resolve() else Strings.setTakeProfit.resolve(),
                        color = ProfitGreen
                    )
                }
            }
            Button(
                onClick = { showCloseConfirm = true },
                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                shape = RoundedCornerShape(50),
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp)
            ) {
                Text(Strings.closePosition.resolve(), color = LossRed)
            }
        }
    }

    if (showTpDialog) {
        var byPrice by remember { mutableStateOf(false) }
        var tpInput by remember { mutableStateOf("10") }
        var tpError by remember { mutableStateOf<String?>(null) }
        AlertDialog(
            onDismissRequest = { showTpDialog = false },
            title = { Text(Strings.takeProfitDialogTitle.resolve()) },
            text = {
                Column {
                    Text(
                        Strings.takeProfitDialogMessage.resolve(),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(Modifier.height(8.dp))
                    SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                        SegmentedButton(
                            selected = !byPrice,
                            onClick = { byPrice = false; tpInput = "10"; tpError = null },
                            shape = SegmentedButtonDefaults.itemShape(0, 2)
                        ) { Text(Strings.takeProfitByPercent.resolve()) }
                        SegmentedButton(
                            selected = byPrice,
                            onClick = { byPrice = true; tpInput = position.takeProfitPrice?.let { formatPrice(it) } ?: ""; tpError = null },
                            shape = SegmentedButtonDefaults.itemShape(1, 2)
                        ) { Text(Strings.takeProfitByPrice.resolve()) }
                    }
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = tpInput,
                        onValueChange = { tpInput = it; tpError = null },
                        label = { Text(if (byPrice) Strings.takeProfitPriceLabel.resolve() else Strings.takeProfitPnlPercentLabel.resolve()) },
                        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        isError = tpError != null,
                        supportingText = tpError?.let { { Text(it, color = LossRed) } },
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    val value = tpInput.toDoubleOrNull()
                    if (value == null || value <= 0) {
                        tpError = "Enter a number greater than 0"
                    } else {
                        if (byPrice) onSetTakeProfitByPrice(value) else onSetTakeProfitByPnlPercent(value)
                        showTpDialog = false
                    }
                }) { Text(Strings.confirm.resolve()) }
            },
            dismissButton = {
                TextButton(onClick = { showTpDialog = false }) { Text(Strings.cancel.resolve()) }
            }
        )
    }

    if (showSlDialog) {
        var byPrice by remember { mutableStateOf(false) }
        var slInput by remember { mutableStateOf("1") }
        var slError by remember { mutableStateOf<String?>(null) }
        AlertDialog(
            onDismissRequest = { showSlDialog = false },
            title = { Text(Strings.stopLossDialogTitle.resolve()) },
            text = {
                Column {
                    Text(
                        Strings.stopLossDialogMessage.resolve(),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(Modifier.height(8.dp))
                    SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                        SegmentedButton(
                            selected = !byPrice,
                            onClick = { byPrice = false; slInput = "1"; slError = null },
                            shape = SegmentedButtonDefaults.itemShape(0, 2)
                        ) { Text(Strings.stopLossByRiskAmount.resolve()) }
                        SegmentedButton(
                            selected = byPrice,
                            onClick = { byPrice = true; slInput = position.stopLossPrice?.let { formatPrice(it) } ?: ""; slError = null },
                            shape = SegmentedButtonDefaults.itemShape(1, 2)
                        ) { Text(Strings.stopLossByPrice.resolve()) }
                    }
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = slInput,
                        onValueChange = { slInput = it; slError = null },
                        label = { Text(if (byPrice) Strings.stopLossPriceLabel.resolve() else Strings.riskUsdAmountLabel.resolve()) },
                        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        isError = slError != null,
                        supportingText = slError?.let { { Text(it, color = LossRed) } },
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    val value = slInput.toDoubleOrNull()
                    if (value == null || value <= 0) {
                        slError = "Enter a number greater than 0"
                    } else {
                        if (byPrice) onSetStopLossByPrice(value) else onSetStopLossByRiskUsd(value)
                        showSlDialog = false
                    }
                }) { Text(Strings.confirm.resolve()) }
            },
            dismissButton = {
                TextButton(onClick = { showSlDialog = false }) { Text(Strings.cancel.resolve()) }
            }
        )
    }

    if (showCloseConfirm) {
        ConfirmDialog(
            title = Strings.closePositionConfirmTitle,
            message = Strings.closePositionConfirmMessage,
            confirmLabel = Strings.closePosition,
            cancelLabel = Strings.cancel,
            onConfirm = {
                showCloseConfirm = false
                onClose()
            },
            onDismiss = { showCloseConfirm = false }
        )
    }
}
