package com.copytrade.app.ui.copysignals

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Archive
import androidx.compose.material.icons.filled.Unarchive
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import coil.request.ImageRequest
import com.copytrade.app.CopyTradeApp
import com.copytrade.app.data.remote.buildAuthenticatedHttpClient
import com.copytrade.app.data.remote.dto.CopySignalDto
import com.copytrade.app.ui.appViewModel
import com.copytrade.app.ui.components.PollWhileForeground
import com.copytrade.app.ui.strings.Strings
import com.copytrade.app.ui.strings.resolve
import com.copytrade.app.ui.theme.LossRed
import com.copytrade.app.ui.theme.PaperOrange
import com.copytrade.app.ui.theme.ProfitGreen
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CopySignalsScreen(onBack: () -> Unit, onOpenFutures: () -> Unit) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(Strings.copySignalsTitle.resolve()) },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.Filled.ArrowBack, contentDescription = null) }
                }
            )
        }
    ) { padding ->
        CopySignalsList(onOpenFutures = onOpenFutures, modifier = Modifier.padding(padding))
    }
}

/**
 * The pending copy-signals list — extracted so it can be shown both on its own
 * screen and embedded as a tab on the dashboard. Polls for new signals while
 * in the foreground and hands an approved signal off to the Futures form.
 */
@Composable
fun CopySignalsList(onOpenFutures: () -> Unit, modifier: Modifier = Modifier) {
    val viewModel = appViewModel { CopySignalsViewModel(it) }
    val state by viewModel.uiState.collectAsState()
    val app = LocalContext.current.applicationContext as CopyTradeApp
    val serverUrl = remember { runBlocking { app.settingsRepository.serverUrl.first() } ?: "" }
    val scope = rememberCoroutineScope()

    PollWhileForeground { viewModel.refresh() }

    Column(modifier = modifier) {
        val tabIndex = if (state.showArchived) 1 else 0
        TabRow(selectedTabIndex = tabIndex) {
            Tab(
                selected = !state.showArchived,
                onClick = { viewModel.setShowArchived(false) },
                text = { Text(Strings.pendingSignalsTab.resolve()) }
            )
            Tab(
                selected = state.showArchived,
                onClick = { viewModel.setShowArchived(true) },
                text = { Text(Strings.archivedTab.resolve()) }
            )
        }

        state.error?.let {
            Text(it, color = LossRed, modifier = Modifier.padding(16.dp))
        }
        if (state.signals.isEmpty()) {
            Column(modifier = Modifier.padding(16.dp)) {
                val emptyLabel = if (state.showArchived) Strings.noArchivedSignals else Strings.noPendingSignals
                Text(emptyLabel.resolve(), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxWidth(),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                items(state.signals, key = { it.id }) { signal ->
                    CopySignalCard(
                        signal = signal,
                        serverUrl = serverUrl,
                        archivedView = state.showArchived,
                        canCopy = viewModel.canCopyToFutures(signal),
                        canQuickRiskTrade = viewModel.canQuickRiskTrade(signal),
                        onCopyToFutures = {
                            scope.launch {
                                if (viewModel.prepareFuturesHandoff(signal)) onOpenFutures()
                            }
                        },
                        onQuickRiskTrade = {
                            scope.launch {
                                if (viewModel.prepareFuturesHandoff(signal, riskUsdAmount = QUICK_RISK_TRADE_USD)) onOpenFutures()
                            }
                        },
                        onReject = { viewModel.reject(signal.id) },
                        onArchive = { viewModel.archive(signal.id) },
                        onUnarchive = { viewModel.unarchive(signal.id) }
                    )
                }
            }
        }
    }
}

/** At-a-glance FYI for the trader: is this signal still actionable vs its SL/TP? */
@Composable
private fun ValidityBadge(priceCheck: String?) {
    val (label, color) = when (priceCheck) {
        "valid" -> Strings.signalValid.resolve() to ProfitGreen
        "tp_hit", "sl_hit" -> Strings.signalInvalid.resolve() to LossRed
        else -> Strings.signalNotChecked.resolve() to PaperOrange
    }
    Box(
        modifier = Modifier
            .padding(top = 8.dp)
            .background(color.copy(alpha = 0.15f), RoundedCornerShape(6.dp))
            .padding(horizontal = 10.dp, vertical = 4.dp)
    ) {
        Text(
            text = label.uppercase(Locale.US),
            color = color,
            style = MaterialTheme.typography.labelMedium
        )
    }
}

/** Fixed risk size for the quick "$1 risk trade" action — small enough to test a signal live at minimal cost. */
private const val QUICK_RISK_TRADE_USD = 1.0

@Composable
private fun CopySignalCard(
    signal: CopySignalDto,
    serverUrl: String,
    archivedView: Boolean,
    canCopy: Boolean,
    canQuickRiskTrade: Boolean,
    onCopyToFutures: () -> Unit,
    onQuickRiskTrade: () -> Unit,
    onReject: () -> Unit,
    onArchive: () -> Unit,
    onUnarchive: () -> Unit
) {
    val app = LocalContext.current.applicationContext as CopyTradeApp
    val imageLoader = remember { coil.ImageLoader.Builder(app).okHttpClient { buildAuthenticatedHttpClient(app.settingsRepository) }.build() }
    val imageUrl = "${serverUrl.trimEnd('/')}/copy-signals/${signal.id}/image"

    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp)) {
            if (signal.imagePath != null) {
                AsyncImage(
                    model = ImageRequest.Builder(app).data(imageUrl).crossfade(true).build(),
                    imageLoader = imageLoader,
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(160.dp)
                        .padding(bottom = 12.dp)
                )
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = androidx.compose.ui.Alignment.CenterVertically
            ) {
                Text(text = signal.symbol ?: "?", style = MaterialTheme.typography.titleMedium)
                Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                    val sideColor = if (signal.side == "long") ProfitGreen else LossRed
                    Text(text = (signal.side ?: "?").uppercase(Locale.US), color = sideColor, style = MaterialTheme.typography.titleMedium)
                    if (archivedView) {
                        IconButton(onClick = onUnarchive) {
                            Icon(Icons.Filled.Unarchive, contentDescription = Strings.unarchive.resolve())
                        }
                    } else {
                        IconButton(onClick = onArchive) {
                            Icon(Icons.Filled.Archive, contentDescription = Strings.archive.resolve())
                        }
                    }
                }
            }

            ValidityBadge(priceCheck = signal.priceCheck)

            signal.leverage?.let { Text("Leverage: ${it.toInt()}x", style = MaterialTheme.typography.bodyMedium) }
            signal.entryPrice?.let { Text("Entry: $it", style = MaterialTheme.typography.bodyMedium) }
            signal.stopLoss?.let { Text("SL: $it", style = MaterialTheme.typography.bodyMedium) }
            signal.takeProfit?.let { Text("TP: $it", style = MaterialTheme.typography.bodyMedium) }
            signal.currentPrice?.let { Text("Current: $it", style = MaterialTheme.typography.bodyMedium) }
            signal.confidence?.let {
                Text(
                    text = "${Strings.signalConfidence.resolve()}: ${(it * 100).toInt()}%",
                    color = if (it < 0.6) PaperOrange else MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodyMedium
                )
            }
            // Explain WHY when invalidated; the badge above already flags the state.
            if ((signal.priceCheck == "tp_hit" || signal.priceCheck == "sl_hit") && !signal.priceNote.isNullOrBlank()) {
                Text(
                    text = signal.priceNote,
                    color = LossRed,
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.padding(top = 4.dp)
                )
            }

            // Archived signals are out of the active review flow until unarchived —
            // approve/reject/copy actions reappear once it's back in the Pending tab.
            if (!archivedView) {
                // Copying to Futures never executes — it hands the signal's params to
                // the Futures form where the user sets size/risk and places the order.
                Text(
                    text = Strings.copyToFuturesHint.resolve(),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 8.dp)
                )

                Row(modifier = Modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = onReject, modifier = Modifier.fillMaxWidth().weight(1f)) {
                        Text(Strings.reject.resolve(), color = LossRed)
                    }
                    Button(
                        onClick = onCopyToFutures,
                        enabled = canCopy,
                        modifier = Modifier.fillMaxWidth().weight(1f)
                    ) {
                        Text(Strings.copyToFutures.resolve())
                    }
                }

                // Same hand-off as "Copy to Futures", but also derives the position size
                // so this trade risks exactly $1 if the signal's stop-loss hits.
                OutlinedButton(
                    onClick = onQuickRiskTrade,
                    enabled = canQuickRiskTrade,
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp)
                ) {
                    Text(Strings.quickRiskTrade.resolve())
                }
            }
        }
    }
}
