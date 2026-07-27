package com.copytrade.app.ui.createbot

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.copytrade.app.ui.appViewModel
import com.copytrade.app.ui.strings.Strings
import com.copytrade.app.ui.strings.resolve
import com.copytrade.app.ui.theme.LossRed

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CreateBotScreen(onBack: () -> Unit, onCreated: () -> Unit) {
    val viewModel = appViewModel { CreateBotViewModel(it) }
    val state by viewModel.uiState.collectAsState()

    LaunchedEffect(state.created) {
        if (state.created) onCreated()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(Strings.createBotTitle.resolve()) },
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
                .padding(16.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                SegmentedButton(
                    selected = state.strategyKind == StrategyKind.GRID,
                    onClick = { viewModel.setStrategyKind(StrategyKind.GRID) },
                    shape = androidx.compose.material3.SegmentedButtonDefaults.itemShape(0, 3)
                ) { Text(Strings.grid.resolve()) }
                SegmentedButton(
                    selected = state.strategyKind == StrategyKind.DCA,
                    onClick = { viewModel.setStrategyKind(StrategyKind.DCA) },
                    shape = androidx.compose.material3.SegmentedButtonDefaults.itemShape(1, 3)
                ) { Text(Strings.dca.resolve()) }
                SegmentedButton(
                    selected = state.strategyKind == StrategyKind.FUTURES_SCALP,
                    onClick = { viewModel.setStrategyKind(StrategyKind.FUTURES_SCALP) },
                    shape = androidx.compose.material3.SegmentedButtonDefaults.itemShape(2, 3)
                ) { Text(Strings.scalping.resolve()) }
            }

            when (state.strategyKind) {
                StrategyKind.GRID -> GridForm(state.grid, viewModel::updateGrid)
                StrategyKind.DCA -> DcaForm(state.dca, viewModel::updateDca)
                StrategyKind.FUTURES_SCALP -> ScalpForm(state.scalp, viewModel::updateScalp)
            }

            if (state.isLiveMode) {
                Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                    Checkbox(checked = state.confirmLive, onCheckedChange = viewModel::setConfirmLive)
                    Text(Strings.confirmLive.resolve())
                }
            }

            if (state.showValidationError) {
                Text(Strings.validationError.resolve(), color = MaterialTheme.colorScheme.error)
            }
            state.error?.let { Text(it, color = LossRed) }

            Button(
                onClick = viewModel::submit,
                enabled = !state.isSubmitting,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(Strings.create.resolve())
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun GridForm(form: GridFormState, update: ((GridFormState) -> GridFormState) -> Unit) {
    OutlinedTextField(
        value = form.symbol,
        onValueChange = { v -> update { it.copy(symbol = v.uppercase()) } },
        label = { Text(Strings.symbol.resolve()) },
        modifier = Modifier.fillMaxWidth()
    )
    OutlinedTextField(
        value = form.lowerPrice,
        onValueChange = { v -> update { it.copy(lowerPrice = v) } },
        label = { Text(Strings.lowerPrice.resolve()) },
        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Decimal),
        modifier = Modifier.fillMaxWidth()
    )
    OutlinedTextField(
        value = form.upperPrice,
        onValueChange = { v -> update { it.copy(upperPrice = v) } },
        label = { Text(Strings.upperPrice.resolve()) },
        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Decimal),
        modifier = Modifier.fillMaxWidth()
    )
    OutlinedTextField(
        value = form.gridLevels,
        onValueChange = { v -> update { it.copy(gridLevels = v) } },
        label = { Text(Strings.gridLevels.resolve()) },
        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Number),
        modifier = Modifier.fillMaxWidth()
    )
    OutlinedTextField(
        value = form.totalBudgetUsdt,
        onValueChange = { v -> update { it.copy(totalBudgetUsdt = v) } },
        label = { Text(Strings.totalBudget.resolve()) },
        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Decimal),
        modifier = Modifier.fillMaxWidth()
    )
    Text(Strings.gridMode.resolve(), style = MaterialTheme.typography.bodyMedium)
    SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
        SegmentedButton(
            selected = form.mode == "arithmetic",
            onClick = { update { it.copy(mode = "arithmetic") } },
            shape = androidx.compose.material3.SegmentedButtonDefaults.itemShape(0, 2)
        ) { Text("Arithmetic") }
        SegmentedButton(
            selected = form.mode == "geometric",
            onClick = { update { it.copy(mode = "geometric") } },
            shape = androidx.compose.material3.SegmentedButtonDefaults.itemShape(1, 2)
        ) { Text("Geometric") }
    }
}

@Composable
private fun DcaForm(form: DcaFormState, update: ((DcaFormState) -> DcaFormState) -> Unit) {
    OutlinedTextField(
        value = form.symbol,
        onValueChange = { v -> update { it.copy(symbol = v.uppercase()) } },
        label = { Text(Strings.symbol.resolve()) },
        modifier = Modifier.fillMaxWidth()
    )
    OutlinedTextField(
        value = form.amountUsdt,
        onValueChange = { v -> update { it.copy(amountUsdt = v) } },
        label = { Text(Strings.amountPerBuy.resolve()) },
        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Decimal),
        modifier = Modifier.fillMaxWidth()
    )
    OutlinedTextField(
        value = form.interval,
        onValueChange = { v -> update { it.copy(interval = v) } },
        label = { Text(Strings.interval.resolve() + " (hourly/daily/weekly/custom)") },
        modifier = Modifier.fillMaxWidth()
    )
    if (form.interval == "custom") {
        OutlinedTextField(
            value = form.cronExpression,
            onValueChange = { v -> update { it.copy(cronExpression = v) } },
            label = { Text("Cron expression") },
            modifier = Modifier.fillMaxWidth()
        )
    }
    OutlinedTextField(
        value = form.dipMultiplier,
        onValueChange = { v -> update { it.copy(dipMultiplier = v) } },
        label = { Text(Strings.dipMultiplier.resolve()) },
        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Decimal),
        modifier = Modifier.fillMaxWidth()
    )
    OutlinedTextField(
        value = form.dipThresholdPct,
        onValueChange = { v -> update { it.copy(dipThresholdPct = v) } },
        label = { Text(Strings.dipThreshold.resolve()) },
        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Decimal),
        modifier = Modifier.fillMaxWidth()
    )
    OutlinedTextField(
        value = form.takeProfitPct,
        onValueChange = { v -> update { it.copy(takeProfitPct = v) } },
        label = { Text(Strings.takeProfit.resolve()) },
        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Decimal),
        modifier = Modifier.fillMaxWidth()
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ScalpForm(form: ScalpFormState, update: ((ScalpFormState) -> ScalpFormState) -> Unit) {
    OutlinedTextField(
        value = form.symbol,
        onValueChange = { v -> update { it.copy(symbol = v.uppercase()) } },
        label = { Text(Strings.symbol.resolve()) },
        modifier = Modifier.fillMaxWidth()
    )
    OutlinedTextField(
        value = form.leverage,
        onValueChange = { v -> update { it.copy(leverage = v) } },
        label = { Text("${Strings.leverage.resolve()} (x)") },
        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Number),
        modifier = Modifier.fillMaxWidth()
    )
    Text(Strings.marginMode.resolve(), style = MaterialTheme.typography.bodyMedium)
    SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
        SegmentedButton(
            selected = form.marginMode == "isolated",
            onClick = { update { it.copy(marginMode = "isolated") } },
            shape = androidx.compose.material3.SegmentedButtonDefaults.itemShape(0, 2)
        ) { Text(Strings.isolated.resolve()) }
        SegmentedButton(
            selected = form.marginMode == "cross",
            onClick = { update { it.copy(marginMode = "cross") } },
            shape = androidx.compose.material3.SegmentedButtonDefaults.itemShape(1, 2)
        ) { Text(Strings.cross.resolve()) }
    }
    OutlinedTextField(
        value = form.riskUsdAmount,
        onValueChange = { v -> update { it.copy(riskUsdAmount = v) } },
        label = { Text(Strings.riskUsdAmountLabel.resolve()) },
        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Decimal),
        modifier = Modifier.fillMaxWidth()
    )
    Text(Strings.interval.resolve(), style = MaterialTheme.typography.bodyMedium)
    SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
        SegmentedButton(
            selected = form.interval == "Min1",
            onClick = { update { it.copy(interval = "Min1") } },
            shape = androidx.compose.material3.SegmentedButtonDefaults.itemShape(0, 2)
        ) { Text("1m") }
        SegmentedButton(
            selected = form.interval == "Min5",
            onClick = { update { it.copy(interval = "Min5") } },
            shape = androidx.compose.material3.SegmentedButtonDefaults.itemShape(1, 2)
        ) { Text("5m") }
    }
}
