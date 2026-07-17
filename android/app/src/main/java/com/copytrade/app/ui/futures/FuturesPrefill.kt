package com.copytrade.app.ui.futures

import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * A one-shot set of trade parameters to pre-fill the Futures form, e.g. handed
 * off from an approved copy signal. Size/risk is deliberately NOT included — the
 * user sets that themselves before opening. Persisted as JSON in settings and
 * consumed once by FuturesViewModel.
 */
@Serializable
data class FuturesPrefill(
    val symbol: String,
    val side: String,
    val leverage: Int? = null,
    val entryPrice: Double? = null,
    val stopLoss: Double? = null,
    val takeProfit: Double? = null
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
