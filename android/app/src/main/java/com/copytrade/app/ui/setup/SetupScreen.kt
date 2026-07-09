package com.copytrade.app.ui.setup

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Error
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.copytrade.app.ui.appViewModel
import com.copytrade.app.ui.strings.Strings
import com.copytrade.app.ui.strings.resolve
import com.copytrade.app.ui.theme.ProfitGreen

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SetupScreen(onConnected: () -> Unit) {
    val viewModel = appViewModel { SetupViewModel(it) }
    val serverUrl by viewModel.serverUrl.collectAsState()
    val token by viewModel.token.collectAsState()
    val testState by viewModel.testState.collectAsState()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.Center
    ) {
        Text(text = Strings.setupTitle.resolve(), style = MaterialTheme.typography.headlineMedium)
        androidx.compose.foundation.layout.Spacer(Modifier.padding(top = 24.dp))

        OutlinedTextField(
            value = serverUrl,
            onValueChange = viewModel::onServerUrlChanged,
            label = { Text(Strings.serverUrlLabel.resolve()) },
            placeholder = { Text("https://your-engine.example.com") },
            modifier = Modifier.fillMaxWidth()
        )
        androidx.compose.foundation.layout.Spacer(Modifier.padding(top = 12.dp))

        OutlinedTextField(
            value = token,
            onValueChange = viewModel::onTokenChanged,
            label = { Text(Strings.bearerTokenLabel.resolve()) },
            modifier = Modifier.fillMaxWidth()
        )
        androidx.compose.foundation.layout.Spacer(Modifier.padding(top = 20.dp))

        OutlinedButton(
            onClick = viewModel::testConnection,
            enabled = serverUrl.isNotBlank() && token.isNotBlank() && testState !is ConnectionTestState.Testing,
            modifier = Modifier.fillMaxWidth()
        ) {
            when (testState) {
                is ConnectionTestState.Testing -> CircularProgressIndicator(modifier = Modifier.padding(4.dp))
                is ConnectionTestState.Success -> Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = ProfitGreen)
                is ConnectionTestState.Failure -> Icon(Icons.Filled.Error, contentDescription = null, tint = MaterialTheme.colorScheme.error)
                else -> {}
            }
            Text(text = "  " + Strings.testConnection.resolve())
        }

        if (testState is ConnectionTestState.Success) {
            Text(
                text = Strings.connectionSuccess.resolve(),
                color = ProfitGreen,
                modifier = Modifier.padding(top = 8.dp)
            )
        } else if (testState is ConnectionTestState.Failure) {
            Text(
                text = Strings.connectionFailed.resolve(),
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(top = 8.dp)
            )
        }

        androidx.compose.foundation.layout.Spacer(Modifier.padding(top = 20.dp))

        Button(
            onClick = { viewModel.saveAndContinue(onConnected) },
            enabled = serverUrl.isNotBlank() && token.isNotBlank(),
            modifier = Modifier.fillMaxWidth()
        ) {
            Text(Strings.connectAndContinue.resolve())
        }
    }
}
