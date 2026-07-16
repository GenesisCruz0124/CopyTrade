package com.copytrade.app.ui.activity

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.ExperimentalMaterialApi
import androidx.compose.material.pullrefresh.PullRefreshIndicator
import androidx.compose.material.pullrefresh.pullRefresh
import androidx.compose.material.pullrefresh.rememberPullRefreshState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.TrendingDown
import androidx.compose.material.icons.filled.TrendingUp
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
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
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import com.copytrade.app.data.local.entity.EventEntity
import com.copytrade.app.ui.appViewModel
import com.copytrade.app.ui.components.PollWhileForeground
import com.copytrade.app.ui.strings.Strings
import com.copytrade.app.ui.strings.resolve
import com.copytrade.app.ui.theme.AccentBlue
import com.copytrade.app.ui.theme.LossRed
import com.copytrade.app.ui.theme.ProfitGreen
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterialApi::class)
@Composable
fun ActivityScreen(onBack: () -> Unit) {
    val viewModel = appViewModel { ActivityViewModel(it) }
    val state by viewModel.uiState.collectAsState()

    PollWhileForeground { viewModel.refresh() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(Strings.activityTitle.resolve()) },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.Filled.ArrowBack, contentDescription = null) }
                }
            )
        }
    ) { padding ->
        val pullRefreshState = rememberPullRefreshState(refreshing = state.isRefreshing, onRefresh = viewModel::refresh)
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .pullRefresh(pullRefreshState)
        ) {
            if (state.events.isEmpty()) {
                Text(
                    text = Strings.activityEmpty.resolve(),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(24.dp)
                )
            } else {
                val dateFormat = remember { SimpleDateFormat("MMM d, HH:mm", Locale.US) }
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items(state.events, key = { it.id }) { event ->
                        EventRow(event = event, timestamp = dateFormat.format(Date(event.createdAt)))
                    }
                }
            }
            PullRefreshIndicator(
                refreshing = state.isRefreshing,
                state = pullRefreshState,
                modifier = Modifier.align(Alignment.TopCenter)
            )
        }
    }
}

private data class EventVisual(val icon: ImageVector, val tint: androidx.compose.ui.graphics.Color, val label: String?)

@Composable
private fun eventVisual(event: EventEntity): EventVisual {
    // Signal-monitor events carry a "LONG …" / "SHORT …" message — colour them
    // like a trade direction so alerts stand out from ordinary bot events.
    if (event.type == "signal") {
        val isLong = event.message.startsWith("LONG")
        return EventVisual(
            icon = if (isLong) Icons.Filled.TrendingUp else Icons.Filled.TrendingDown,
            tint = if (isLong) ProfitGreen else LossRed,
            label = Strings.activitySignalAlert.resolve()
        )
    }
    return EventVisual(icon = Icons.Filled.Notifications, tint = AccentBlue, label = null)
}

@Composable
private fun EventRow(event: EventEntity, timestamp: String) {
    val visual = eventVisual(event)
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Icon(visual.icon, contentDescription = null, tint = visual.tint, modifier = Modifier.size(24.dp))
            Column(modifier = Modifier.fillMaxWidth()) {
                visual.label?.let {
                    Text(it, style = MaterialTheme.typography.labelSmall, color = visual.tint)
                }
                Text(event.message, style = MaterialTheme.typography.bodyMedium)
                Text(
                    timestamp,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}
