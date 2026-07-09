package com.copytrade.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import com.copytrade.app.ui.navigation.CopyTradeNavGraph
import com.copytrade.app.ui.navigation.Screen
import com.copytrade.app.ui.strings.ProvideAppLanguage
import com.copytrade.app.ui.theme.CopyTradeTheme
import kotlinx.coroutines.flow.first

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        setContent {
            val app = application as CopyTradeApp
            var startDestination by remember { mutableStateOf<String?>(null) }
            var language by remember { mutableStateOf(com.copytrade.app.ui.strings.AppLanguage.ENGLISH) }

            LaunchedEffect(Unit) {
                startDestination = if (app.settingsRepository.isConfigured()) Screen.Dashboard.route else Screen.Setup.route
                app.settingsRepository.language.collect { language = it }
            }

            CopyTradeTheme {
                Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    ProvideAppLanguage(language) {
                        startDestination?.let { CopyTradeNavGraph(startDestination = it) }
                    }
                }
            }
        }
    }
}
