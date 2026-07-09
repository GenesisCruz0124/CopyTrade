package com.copytrade.app.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.copytrade.app.CopyTradeApp

@Composable
fun localApp(): CopyTradeApp = LocalContext.current.applicationContext as CopyTradeApp

@Composable
inline fun <reified VM : ViewModel> appViewModel(crossinline create: (CopyTradeApp) -> VM): VM {
    val app = localApp()
    val factory = viewModelFactory {
        initializer { create(app) }
    }
    return viewModel(factory = factory)
}
