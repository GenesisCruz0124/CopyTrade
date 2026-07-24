package com.copytrade.app.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleStartEffect
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private const val DEFAULT_POLL_INTERVAL_MS = 10_000L

/** Faster cadence for screens showing live trading state (Dashboard, Futures trade
 *  screen) — freshness matters more there than on screens with less time-sensitive data. */
const val FAST_POLL_INTERVAL_MS = 3_000L

/** Repeats [action] every [intervalMs] (default 10s) while this composable's lifecycle
 *  is at least STARTED (foreground). */
@Composable
fun PollWhileForeground(intervalMs: Long = DEFAULT_POLL_INTERVAL_MS, action: suspend () -> Unit) {
    val lifecycleOwner = LocalLifecycleOwner.current
    LifecycleStartEffect(Unit) {
        val job = MainScope().launch {
            lifecycleOwner.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
                while (true) {
                    action()
                    delay(intervalMs)
                }
            }
        }
        onStopOrDispose { job.cancel() }
    }
}
