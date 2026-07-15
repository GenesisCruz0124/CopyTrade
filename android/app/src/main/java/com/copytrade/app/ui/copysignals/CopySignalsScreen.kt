package com.copytrade.app.ui.copysignals

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
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
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
import com.copytrade.app.ui.components.ConfirmDialog
import com.copytrade.app.ui.components.PollWhileForeground
import com.copytrade.app.ui.strings.Strings
import com.copytrade.app.ui.strings.resolve
import com.copytrade.app.ui.theme.LossRed
import com.copytrade.app.ui.theme.PaperOrange
import com.copytrade.app.ui.theme.ProfitGreen
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CopySignalsScreen(onBack: () -> Unit) {
    val viewModel = appViewModel { CopySignalsViewModel(it) }
    val state by viewModel.uiState.collectAsState()
    val app = LocalContext.current.applicationContext as CopyTradeApp
    val serverUrl = remember { runBlocking { app.settingsRepository.serverUrl.first() } ?: "" }

    PollWhileForeground { viewModel.refresh() }

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
        if (state.signals.isEmpty()) {
            Column(modifier = Modifier.padding(padding).padding(16.dp)) {
                Text(Strings.noPendingSignals.resolve(), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        } else {
            LazyColumn(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(padding),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                items(state.signals, key = { it.id }) { signal ->
                    CopySignalCard(signal = signal, serverUrl = serverUrl, onApprove = { viewModel.approve(signal.id) }, onReject = { viewModel.reject(signal.id) })
                }
            }
        }
    }
}

@Composable
private fun CopySignalCard(signal: CopySignalDto, serverUrl: String, onApprove: () -> Unit, onReject: () -> Unit) {
    var showApproveConfirm by remember { mutableStateOf(false) }
    val app = LocalContext.current.applicationContext as CopyTradeApp
    val imageLoader = remember { coil.ImageLoader.Builder(app).okHttpClient { buildAuthenticatedHttpClient(app.settingsRepository) }.build() }
    val imageUrl = "${serverUrl.trimEnd('/')}/copy-signals/${signal.id}/image"

    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp)) {
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

            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(text = signal.symbol ?: "?", style = MaterialTheme.typography.titleMedium)
                val sideColor = if (signal.side == "long") ProfitGreen else LossRed
                Text(text = (signal.side ?: "?").uppercase(Locale.US), color = sideColor, style = MaterialTheme.typography.titleMedium)
            }

            signal.leverage?.let { Text("Leverage: ${it.toInt()}x", style = MaterialTheme.typography.bodyMedium) }
            signal.entryPrice?.let { Text("Entry: $it", style = MaterialTheme.typography.bodyMedium) }
            signal.stopLoss?.let { Text("SL: $it", style = MaterialTheme.typography.bodyMedium) }
            signal.takeProfit?.let { Text("TP: $it", style = MaterialTheme.typography.bodyMedium) }
            signal.confidence?.let {
                Text(
                    text = "${Strings.signalConfidence.resolve()}: ${(it * 100).toInt()}%",
                    color = if (it < 0.6) PaperOrange else MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodyMedium
                )
            }

            Row(modifier = Modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = onReject, modifier = Modifier.fillMaxWidth().weight(1f)) {
                    Text(Strings.reject.resolve(), color = LossRed)
                }
                Button(onClick = { showApproveConfirm = true }, modifier = Modifier.fillMaxWidth().weight(1f)) {
                    Text(Strings.approve.resolve())
                }
            }
        }
    }

    if (showApproveConfirm) {
        ConfirmDialog(
            title = Strings.approveConfirmTitle,
            message = Strings.approveConfirmMessage,
            confirmLabel = Strings.confirm,
            cancelLabel = Strings.cancel,
            onConfirm = {
                showApproveConfirm = false
                onApprove()
            },
            onDismiss = { showApproveConfirm = false }
        )
    }
}
