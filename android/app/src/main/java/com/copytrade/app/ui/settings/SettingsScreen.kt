package com.copytrade.app.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.Divider
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.copytrade.app.BuildConfig
import com.copytrade.app.ui.appViewModel
import com.copytrade.app.ui.strings.AppLanguage
import com.copytrade.app.ui.strings.Strings
import com.copytrade.app.ui.strings.resolve
import com.copytrade.app.ui.theme.LossRed

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(onBack: () -> Unit, onDisconnected: () -> Unit, onOpenAccount: () -> Unit) {
    val viewModel = appViewModel { SettingsViewModel(it) }
    val state by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(Strings.settingsTitle.resolve()) },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.Filled.ArrowBack, contentDescription = null) }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(padding)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Text(Strings.language.resolve(), style = MaterialTheme.typography.titleMedium)
            Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                RadioButton(
                    selected = state.language == AppLanguage.ENGLISH,
                    onClick = { viewModel.setLanguage(AppLanguage.ENGLISH) }
                )
                Text(Strings.english.resolve(), modifier = Modifier.padding(end = 16.dp))
                RadioButton(
                    selected = state.language == AppLanguage.TAGLISH,
                    onClick = { viewModel.setLanguage(AppLanguage.TAGLISH) }
                )
                Text(Strings.taglish.resolve())
            }

            Divider()

            Text(Strings.notificationsSection.resolve(), style = MaterialTheme.typography.titleMedium)
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = androidx.compose.ui.Alignment.CenterVertically
            ) {
                Text(Strings.notifyNewSignals.resolve(), modifier = Modifier.weight(1f))
                Switch(checked = state.notificationsEnabled, onCheckedChange = viewModel::setNotificationsEnabled)
            }

            Divider()

            OutlinedButton(
                onClick = onOpenAccount,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(Strings.manageTradingAccount.resolve())
            }

            Divider()

            Text(Strings.serverSettings.resolve(), style = MaterialTheme.typography.titleMedium)
            OutlinedTextField(
                value = state.serverUrl,
                onValueChange = viewModel::updateServerUrl,
                label = { Text(Strings.serverUrlLabel.resolve()) },
                modifier = Modifier.fillMaxWidth()
            )

            Divider()

            Text(Strings.about.resolve(), style = MaterialTheme.typography.titleMedium)
            Text(Strings.aboutBody.resolve(), color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(
                text = "${Strings.appVersion.resolve()}: ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodyMedium
            )

            Divider()

            OutlinedButton(
                onClick = { viewModel.disconnect(onDisconnected) },
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(Strings.logout.resolve(), color = LossRed)
            }
        }
    }
}
