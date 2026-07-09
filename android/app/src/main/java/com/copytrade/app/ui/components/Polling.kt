package com.copytrade.app.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleStartEffect
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private const val POLL_INTERVAL_MS = 10_000L

/** Repeats [action] every 10s while this composable's lifecycle is at least STARTED (foreground). */
@Composable
fun PollWhileForeground(action: suspend () -> Unit) {
    val lifecycleOwner = LocalLifecycleOwner.current
    LifecycleStartEffect(Unit) {
        val job = MainScope().launch {
            lifecycleOwner.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
                while (true) {
                    action()
                    delay(POLL_INTERVAL_MS)
                }
            }
        }
        onStopOrDispose { job.cancel() }
    }
}
