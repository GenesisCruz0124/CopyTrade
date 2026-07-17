package com.copytrade.app

import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import com.copytrade.app.notifications.EXTRA_NAV_ROUTE
import com.copytrade.app.notifications.SignalPollingService
import com.copytrade.app.ui.navigation.CopyTradeNavGraph
import com.copytrade.app.ui.navigation.Screen
import com.copytrade.app.ui.strings.ProvideAppLanguage
import com.copytrade.app.ui.theme.CopyTradeTheme
import kotlinx.coroutines.flow.first

class MainActivity : ComponentActivity() {
    private val requestNotificationPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { /* no-op either way */ }

    // Route a tapped notification wants to open. Observed by the composition so a
    // tap deep-links there, on both a cold start (onCreate) and while running (onNewIntent).
    private val pendingNavRoute = mutableStateOf<String?>(null)

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        intent.getStringExtra(EXTRA_NAV_ROUTE)?.let { pendingNavRoute.value = it }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        pendingNavRoute.value = intent?.getStringExtra(EXTRA_NAV_ROUTE)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            requestNotificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }

        setContent {
            val app = application as CopyTradeApp
            var startDestination by remember { mutableStateOf<String?>(null) }
            var language by remember { mutableStateOf(com.copytrade.app.ui.strings.AppLanguage.ENGLISH) }

            LaunchedEffect(Unit) {
                startDestination = if (app.settingsRepository.isConfigured()) Screen.Dashboard.route else Screen.Setup.route
                // Restart on every launch in case the OS killed the service while the app was
                // closed (Android may reclaim foreground services under memory pressure) —
                // start() is a no-op if it's already running.
                if (app.settingsRepository.isConfigured() && app.settingsRepository.notificationsEnabled.first()) {
                    SignalPollingService.start(app)
                }
                app.settingsRepository.language.collect { language = it }
            }

            CopyTradeTheme {
                Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    ProvideAppLanguage(language) {
                        startDestination?.let {
                            CopyTradeNavGraph(
                                startDestination = it,
                                deepLinkRoute = pendingNavRoute.value,
                                onDeepLinkHandled = { pendingNavRoute.value = null }
                            )
                        }
                    }
                }
            }
        }
    }
}
