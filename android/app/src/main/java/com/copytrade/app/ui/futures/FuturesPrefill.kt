package com.copytrade.app.ui.futures

import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * A one-shot set of trade parameters to pre-fill the Futures form, e.g. handed
 * off from an approved copy signal. Size is deliberately NOT included by
 * default — the user sets that themselves before opening. [riskUsdAmount] is
 * the one exception: it powers the "$1 risk trade" quick action, which derives
 * the position size from the signal's stop-loss so the trade risks exactly
 * that many dollars if the stop-loss hits. Persisted as JSON in settings and
 * consumed once by FuturesViewModel.
 */
@Serializable
data class FuturesPrefill(
    val symbol: String,
    val side: String,
    val leverage: Int? = null,
    val entryPrice: Double? = null,
    val stopLoss: Double? = null,
    val takeProfit: Double? = null,
    val riskUsdAmount: Double? = null
) {
    fun toJson(): String = json.encodeToString(this)

    companion object {
        private val json = Json { ignoreUnknownKeys = true }

        fun fromJsonOrNull(raw: String?): FuturesPrefill? {
            if (raw.isNullOrBlank()) return null
            return runCatching { json.decodeFromString<FuturesPrefill>(raw) }.getOrNull()
        }
    }
}
