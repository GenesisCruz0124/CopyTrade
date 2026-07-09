package com.copytrade.app.ui.tradelog

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
import androidx.compose.material3.Divider
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.copytrade.app.data.local.entity.FillEntity
import com.copytrade.app.ui.appViewModel
import com.copytrade.app.ui.strings.Strings
import com.copytrade.app.ui.strings.resolve
import com.copytrade.app.ui.theme.LossRed
import com.copytrade.app.ui.theme.ProfitGreen
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TradeLogScreen(onBack: () -> Unit) {
    val viewModel = appViewModel { TradeLogViewModel(it) }
    val state by viewModel.uiState.collectAsState()
    val fills = remember(state) { viewModel.filteredFills() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(Strings.tradeLogTitle.resolve()) },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.Filled.ArrowBack, contentDescription = null) }
                }
            )
        }
    ) { padding ->
        Column(modifier = Modifier.padding(padding)) {
            OutlinedTextField(
                value = state.symbolFilter,
                onValueChange = viewModel::setSymbolFilter,
                label = { Text(Strings.symbol.resolve()) },
                placeholder = { Text(Strings.allBots.resolve()) },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp)
            )
            if (fills.isEmpty()) {
                Text(
                    text = Strings.noFillsYet.resolve(),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(16.dp)
                )
            } else {
                LazyColumn(contentPadding = PaddingValues(horizontal = 16.dp)) {
                    items(fills, key = { it.id }) { fill -> TradeLogRow(fill) }
                }
            }
        }
    }
}

@Composable
private fun TradeLogRow(fill: FillEntity) {
    val dateFormat = remember { SimpleDateFormat("MMM d, HH:mm", Locale.US) }
    Column(modifier = Modifier
        .fillMaxWidth()
        .padding(vertical = 10.dp)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(text = "${fill.symbol} · ${fill.side}", style = MaterialTheme.typography.titleMedium)
            Text(
                text = String.format(Locale.US, "%.2f USDT", fill.quoteQty),
                color = if (fill.side == "SELL") ProfitGreen else LossRed,
                style = MaterialTheme.typography.titleMedium
            )
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(
                text = String.format(Locale.US, "%.6f @ %.4f", fill.quantity, fill.price),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodyMedium
            )
            Text(
                text = dateFormat.format(Date(fill.createdAt)),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodyMedium
            )
        }
    }
    Divider()
}
