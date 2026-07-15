package com.copytrade.app.ui.futures

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.History
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Divider
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.copytrade.app.data.remote.dto.FuturesPositionDto
import com.copytrade.app.ui.appViewModel
import com.copytrade.app.ui.components.PollWhileForeground
import com.copytrade.app.ui.strings.Strings
import com.copytrade.app.ui.strings.resolve
import com.copytrade.app.ui.theme.LossRed
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

    PollWhileForeground { viewModel.refresh() }

    LaunchedEffect(state.opened) {
        if (state.opened) {
            scope.launch { snackbarHostState.showSnackbar(positionOpenedMessage) }
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
                        PositionCard(position = position, onClose = { viewModel.closePosition(position.id) })
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
    val filteredSymbols = remember(state.symbols, state.symbolQuery) {
        val matches = if (state.symbolQuery.isBlank()) {
            state.symbols
        } else {
            state.symbols.filter { it.symbol.contains(state.symbolQuery.uppercase()) }
        }
        matches.take(50)
    }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(Strings.tokenPair.resolve(), style = MaterialTheme.typography.titleMedium)
        ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it }) {
            OutlinedTextField(
                value = state.symbolQuery,
                onValueChange = {
                    viewModel.setSymbolQuery(it)
                    expanded = true
                },
                label = { Text(Strings.searchTokenPair.resolve()) },
                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
                modifier = Modifier
                    .fillMaxWidth()
                    .menuAnchor()
                    .onFocusChanged { if (it.isFocused) expanded = true }
            )
            ExposedDropdownMenu(
                expanded = expanded && filteredSymbols.isNotEmpty(),
                onDismissRequest = { expanded = false }
            ) {
                filteredSymbols.forEach { symbol ->
                    DropdownMenuItem(
                        text = { Text("${symbol.symbol} (max ${symbol.maxLeverage.toInt()}x)") },
                        onClick = {
                            viewModel.selectSymbol(symbol.symbol)
                            expanded = false
                        }
                    )
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

        OutlinedTextField(
            value = state.takeProfitPercent,
            onValueChange = viewModel::setTakeProfitPercent,
            label = { Text(Strings.takeProfitPercentLabel.resolve()) },
            keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Decimal),
            modifier = Modifier.fillMaxWidth()
        )
        OutlinedTextField(
            value = state.stopLossPercent,
            onValueChange = viewModel::setStopLossPercent,
            label = { Text(Strings.stopLossPercentLabel.resolve()) },
            keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Decimal),
            modifier = Modifier.fillMaxWidth()
        )
        OutlinedTextField(
            value = state.riskUsdAmount,
            onValueChange = viewModel::setRiskUsdAmount,
            label = { Text(Strings.riskUsdAmountLabel.resolve()) },
            supportingText = { Text(Strings.riskUsdAmountHint.resolve()) },
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

@Composable
internal fun PositionCard(position: FuturesPositionDto, onClose: () -> Unit) {
    val pnlUsdt = position.unrealizedPnlUsdt
    val pnlPercent = position.unrealizedPnlPercent
    val pnlColor = when {
        pnlUsdt == null -> MaterialTheme.colorScheme.onSurfaceVariant
        pnlUsdt > 0 -> ProfitGreen
        pnlUsdt < 0 -> LossRed
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
                position.currentPrice?.let {
                    Text("${Strings.currentPriceLabel.resolve()}: ${formatPrice(it)}", style = MaterialTheme.typography.bodyMedium)
                }
            }
            if (pnlUsdt != null && pnlPercent != null) {
                val sign = if (pnlUsdt > 0) "+" else if (pnlUsdt < 0) "-" else ""
                Text(
                    "$sign$${"%.2f".format(abs(pnlUsdt))} ($sign${"%.2f".format(abs(pnlPercent))}%)",
                    color = pnlColor,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold
                )
            }
            position.riskUsdt?.let {
                Text(
                    "${Strings.riskUsdAmountLabel.resolve()}: $${"%.2f".format(it)}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            OutlinedButton(onClick = onClose, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
                Text(Strings.closePosition.resolve(), color = LossRed)
            }
        }
    }
}
