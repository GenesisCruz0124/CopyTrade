package com.copytrade.app.ui.bots

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
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.copytrade.app.data.local.entity.BotEntity
import com.copytrade.app.ui.appViewModel
import com.copytrade.app.ui.dashboard.DashboardViewModel
import com.copytrade.app.ui.strings.Strings
import com.copytrade.app.ui.strings.resolve
import com.copytrade.app.ui.theme.LossRed
import com.copytrade.app.ui.theme.ProfitGreen
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BotsScreen(onBack: () -> Unit, onOpenBot: (String) -> Unit) {
    // Reuses DashboardViewModel purely for its already-observed bots list —
    // no need for a dedicated ViewModel just to mirror the same Room flow.
    val viewModel = appViewModel { DashboardViewModel(it) }
    val state by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(Strings.activeBots.resolve()) },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.Filled.ArrowBack, contentDescription = null) }
                }
            )
        }
    ) { padding ->
        if (state.bots.isEmpty()) {
            Column(modifier = Modifier.padding(padding).padding(16.dp)) {
                Text(Strings.noBotsYet.resolve(), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxWidth().padding(padding),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                items(state.bots, key = { it.id }) { bot ->
                    BotCard(bot = bot, onClick = { onOpenBot(bot.id) })
                }
            }
        }
    }
}

@Composable
private fun BotCard(bot: BotEntity, onClick: () -> Unit) {
    Card(modifier = Modifier.fillMaxWidth(), onClick = onClick) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Column {
                Text(text = "${bot.symbol} · ${bot.type.uppercase(Locale.US)}", style = MaterialTheme.typography.titleMedium)
                Text(
                    text = statusLabel(bot.status),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodyMedium
                )
            }
            Column(horizontalAlignment = androidx.compose.ui.Alignment.End) {
                val pnlColor = if (bot.realizedPnlUsdt >= 0) ProfitGreen else LossRed
                Text(
                    text = String.format(Locale.US, "%+.2f USDT", bot.realizedPnlUsdt),
                    color = pnlColor,
                    style = MaterialTheme.typography.titleMedium
                )
            }
        }
    }
}

@Composable
private fun statusLabel(status: String): String = when (status) {
    "running" -> Strings.statusRunning.resolve()
    "paused" -> Strings.statusPaused.resolve()
    else -> Strings.statusStopped.resolve()
}
