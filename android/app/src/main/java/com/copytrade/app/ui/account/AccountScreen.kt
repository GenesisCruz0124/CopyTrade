package com.copytrade.app.ui.account

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Divider
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.copytrade.app.ui.appViewModel
import com.copytrade.app.ui.components.ConfirmDialog
import com.copytrade.app.ui.strings.Strings
import com.copytrade.app.ui.strings.resolve
import com.copytrade.app.ui.theme.LiveRed
import com.copytrade.app.ui.theme.ProfitGreen

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AccountScreen(onBack: () -> Unit) {
    val viewModel = appViewModel { AccountViewModel(it) }
    val state by viewModel.uiState.collectAsState()

    var showSpotLiveConfirm by remember { mutableStateOf(false) }
    var showFuturesLiveConfirm by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(Strings.accountTitle.resolve()) },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.Filled.ArrowBack, contentDescription = null) }
                }
            )
        }
    ) { padding ->
        when {
            state.isLoading -> Box(modifier = Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
            state.user == null -> Box(modifier = Modifier.fillMaxSize().padding(padding).padding(24.dp)) {
                Text(Strings.accountNotPerUser.resolve(), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            else -> {
                val user = state.user!!
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(padding)
                        .verticalScroll(rememberScrollState())
                        .padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    Text(
                        text = "${Strings.accountEmailLabel.resolve()}: ${user.email}",
                        style = MaterialTheme.typography.bodyLarge
                    )

                    Divider()

                    Text(Strings.accountModeSection.resolve(), style = MaterialTheme.typography.titleMedium)
                    ModeToggleRow(
                        label = Strings.accountSpotMode.resolve(),
                        isLive = user.tradingMode == "live",
                        enabled = !state.isUpdatingMode,
                        onToggle = { live -> if (live) showSpotLiveConfirm = true else viewModel.setTradingMode(false) }
                    )
                    ModeToggleRow(
                        label = Strings.accountFuturesMode.resolve(),
                        isLive = user.futuresTradingMode == "live",
                        enabled = !state.isUpdatingMode,
                        onToggle = { live -> if (live) showFuturesLiveConfirm = true else viewModel.setFuturesTradingMode(false) }
                    )

                    Divider()

                    Text(Strings.accountKeysSection.resolve(), style = MaterialTheme.typography.titleMedium)
                    Text(
                        text = Strings.accountKeysHint.resolve(),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )

                    KeysStatusRow(label = Strings.accountSpotKeysLabel.resolve(), saved = user.hasSpotKeys)
                    OutlinedTextField(
                        value = state.mexcApiKey,
                        onValueChange = viewModel::onMexcApiKeyChanged,
                        label = { Text(Strings.accountApiKeyLabel.resolve()) },
                        visualTransformation = PasswordVisualTransformation(),
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = state.mexcApiSecret,
                        onValueChange = viewModel::onMexcApiSecretChanged,
                        label = { Text(Strings.accountApiSecretLabel.resolve()) },
                        visualTransformation = PasswordVisualTransformation(),
                        modifier = Modifier.fillMaxWidth()
                    )

                    KeysStatusRow(label = Strings.accountFuturesKeysLabel.resolve(), saved = user.hasFuturesKeys)
                    OutlinedTextField(
                        value = state.mexcFuturesAccessKey,
                        onValueChange = viewModel::onMexcFuturesAccessKeyChanged,
                        label = { Text(Strings.accountFuturesAccessKeyLabel.resolve()) },
                        visualTransformation = PasswordVisualTransformation(),
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = state.mexcFuturesSecretKey,
                        onValueChange = viewModel::onMexcFuturesSecretKeyChanged,
                        label = { Text(Strings.accountFuturesSecretKeyLabel.resolve()) },
                        visualTransformation = PasswordVisualTransformation(),
                        modifier = Modifier.fillMaxWidth()
                    )

                    Button(
                        onClick = viewModel::saveKeys,
                        enabled = !state.isSavingKeys,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        if (state.isSavingKeys) CircularProgressIndicator(modifier = Modifier.padding(end = 8.dp))
                        Text(Strings.accountSaveKeys.resolve())
                    }
                    if (state.keysSaved) {
                        Text(Strings.accountKeysSavedToast.resolve(), color = ProfitGreen)
                    }

                    if (state.error != null) {
                        Text(state.error!!, color = MaterialTheme.colorScheme.error)
                    }
                }
            }
        }
    }

    if (showSpotLiveConfirm) {
        ConfirmDialog(
            title = Strings.accountLiveConfirmTitle,
            message = Strings.accountLiveConfirmMessage,
            confirmLabel = Strings.confirm,
            cancelLabel = Strings.cancel,
            onConfirm = {
                showSpotLiveConfirm = false
                viewModel.setTradingMode(true)
            },
            onDismiss = { showSpotLiveConfirm = false }
        )
    }
    if (showFuturesLiveConfirm) {
        ConfirmDialog(
            title = Strings.accountLiveConfirmTitle,
            message = Strings.accountLiveConfirmMessage,
            confirmLabel = Strings.confirm,
            cancelLabel = Strings.cancel,
            onConfirm = {
                showFuturesLiveConfirm = false
                viewModel.setFuturesTradingMode(true)
            },
            onDismiss = { showFuturesLiveConfirm = false }
        )
    }
}

@Composable
private fun ModeToggleRow(label: String, isLive: Boolean, enabled: Boolean, onToggle: (Boolean) -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(label, modifier = Modifier.weight(1f))
        Text(
            text = if (isLive) Strings.accountModeLive.resolve() else Strings.accountModePaper.resolve(),
            color = if (isLive) LiveRed else MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(end = 8.dp)
        )
        Switch(checked = isLive, onCheckedChange = onToggle, enabled = enabled)
    }
}

@Composable
private fun KeysStatusRow(label: String, saved: Boolean) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(label, style = MaterialTheme.typography.titleSmall)
        Text(
            text = if (saved) Strings.accountKeysSaved.resolve() else Strings.accountKeysNotSaved.resolve(),
            color = if (saved) ProfitGreen else MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodySmall
        )
    }
}
