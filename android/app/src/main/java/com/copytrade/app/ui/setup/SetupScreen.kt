package com.copytrade.app.ui.setup

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.copytrade.app.ui.appViewModel
import com.copytrade.app.ui.strings.Strings
import com.copytrade.app.ui.strings.resolve
import com.copytrade.app.ui.theme.ProfitGreen

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SetupScreen(onConnected: () -> Unit) {
    val viewModel = appViewModel { SetupViewModel(it) }
    val mode by viewModel.mode.collectAsState()
    val serverUrl by viewModel.serverUrl.collectAsState()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.Center
    ) {
        Text(text = Strings.setupTitle.resolve(), style = MaterialTheme.typography.headlineMedium)
        Spacer(Modifier.padding(top = 24.dp))

        OutlinedTextField(
            value = serverUrl,
            onValueChange = viewModel::onServerUrlChanged,
            label = { Text(Strings.serverUrlLabel.resolve()) },
            placeholder = { Text("https://your-engine.example.com") },
            modifier = Modifier.fillMaxWidth()
        )
        Spacer(Modifier.padding(top = 16.dp))

        val tabs = listOf(SetupMode.LOGIN, SetupMode.SIGN_UP, SetupMode.TOKEN)
        val tabLabels = listOf(Strings.setupModeLogin, Strings.setupModeSignUp, Strings.setupModeToken)
        TabRow(selectedTabIndex = tabs.indexOf(mode)) {
            tabs.forEachIndexed { index, tabMode ->
                Tab(
                    selected = mode == tabMode,
                    onClick = { viewModel.onModeChanged(tabMode) },
                    text = { Text(tabLabels[index].resolve()) }
                )
            }
        }
        Spacer(Modifier.padding(top = 20.dp))

        when (mode) {
            SetupMode.LOGIN, SetupMode.SIGN_UP -> AuthForm(viewModel, mode, serverUrl, onConnected)
            SetupMode.TOKEN -> TokenForm(viewModel, serverUrl, onConnected)
        }
    }
}

@Composable
private fun AuthForm(
    viewModel: SetupViewModel,
    mode: SetupMode,
    serverUrl: String,
    onConnected: () -> Unit
) {
    val email by viewModel.email.collectAsState()
    val password by viewModel.password.collectAsState()
    val authState by viewModel.authState.collectAsState()

    if (mode == SetupMode.SIGN_UP) {
        Text(
            text = Strings.setupSignUpHint.resolve(),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Spacer(Modifier.padding(top = 12.dp))
    }

    OutlinedTextField(
        value = email,
        onValueChange = viewModel::onEmailChanged,
        label = { Text(Strings.emailLabel.resolve()) },
        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Email),
        modifier = Modifier.fillMaxWidth()
    )
    Spacer(Modifier.padding(top = 12.dp))

    OutlinedTextField(
        value = password,
        onValueChange = viewModel::onPasswordChanged,
        label = { Text(Strings.passwordLabel.resolve()) },
        visualTransformation = PasswordVisualTransformation(),
        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Password),
        modifier = Modifier.fillMaxWidth()
    )

    val authStateSnapshot = authState
    if (authStateSnapshot is AuthState.Failure) {
        Text(
            text = authStateSnapshot.message,
            color = MaterialTheme.colorScheme.error,
            modifier = Modifier.padding(top = 8.dp)
        )
    } else if (authStateSnapshot is AuthState.InsecureUrl) {
        Text(
            text = Strings.httpsRequired.resolve(),
            color = MaterialTheme.colorScheme.error,
            modifier = Modifier.padding(top = 8.dp)
        )
    }

    Spacer(Modifier.padding(top = 20.dp))

    Button(
        onClick = { viewModel.submitAuth(onConnected) },
        enabled = serverUrl.isNotBlank() && email.isNotBlank() && password.isNotBlank() && authState !is AuthState.Submitting,
        modifier = Modifier.fillMaxWidth()
    ) {
        if (authState is AuthState.Submitting) {
            CircularProgressIndicator(modifier = Modifier.padding(end = 8.dp))
        }
        Text(if (mode == SetupMode.SIGN_UP) Strings.signUp.resolve() else Strings.logIn.resolve())
    }
}

@Composable
private fun TokenForm(viewModel: SetupViewModel, serverUrl: String, onConnected: () -> Unit) {
    val token by viewModel.token.collectAsState()
    val testState by viewModel.testState.collectAsState()

    OutlinedTextField(
        value = token,
        onValueChange = viewModel::onTokenChanged,
        label = { Text(Strings.bearerTokenLabel.resolve()) },
        modifier = Modifier.fillMaxWidth()
    )
    Spacer(Modifier.padding(top = 20.dp))

    OutlinedButton(
        onClick = viewModel::testConnection,
        enabled = serverUrl.isNotBlank() && token.isNotBlank() && testState !is ConnectionTestState.Testing,
        modifier = Modifier.fillMaxWidth()
    ) {
        when (testState) {
            is ConnectionTestState.Testing -> CircularProgressIndicator(modifier = Modifier.padding(4.dp))
            is ConnectionTestState.Success -> Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = ProfitGreen)
            is ConnectionTestState.Failure, is ConnectionTestState.InsecureUrl ->
                Icon(Icons.Filled.Error, contentDescription = null, tint = MaterialTheme.colorScheme.error)
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
    } else if (testState is ConnectionTestState.InsecureUrl) {
        Text(
            text = Strings.httpsRequired.resolve(),
            color = MaterialTheme.colorScheme.error,
            modifier = Modifier.padding(top = 8.dp)
        )
    }

    Spacer(Modifier.padding(top = 20.dp))

    Button(
        onClick = { viewModel.saveAndContinue(onConnected) },
        enabled = serverUrl.isNotBlank() && token.isNotBlank(),
        modifier = Modifier.fillMaxWidth()
    ) {
        Text(Strings.connectAndContinue.resolve())
    }
}
