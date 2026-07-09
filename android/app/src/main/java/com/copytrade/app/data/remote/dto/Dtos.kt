package com.copytrade.app.data.remote.dto

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
data class BalanceDto(
    val asset: String,
    val free: Double,
    val locked: Double
)

@Serializable
data class StatusDto(
    val mode: String,
    val uptimeSeconds: Long,
    val balances: List<BalanceDto> = emptyList(),
    val killSwitchEngaged: Boolean = false
)

@Serializable
data class BotDto(
    val id: String,
    val type: String,
    val symbol: String,
    val status: String,
    val config: JsonElement,
    val confirmLive: Boolean = false,
    val allocatedUsdt: Double,
    val dailyLossLimitUsdt: Double? = null,
    val realizedPnlUsdt: Double = 0.0,
    val createdAt: Long,
    val updatedAt: Long
)

@Serializable
data class BotsResponseDto(
    val mode: String,
    val bots: List<BotDto>
)

@Serializable
data class BotResponseDto(
    val mode: String,
    val bot: BotDto? = null,
    val error: String? = null
)

@Serializable
data class FillDto(
    val id: String,
    @kotlinx.serialization.SerialName("order_id") val orderId: String,
    @kotlinx.serialization.SerialName("bot_id") val botId: String,
    val symbol: String,
    val side: String,
    val price: Double,
    val quantity: Double,
    @kotlinx.serialization.SerialName("quote_qty") val quoteQty: Double,
    val commission: Double = 0.0,
    @kotlinx.serialization.SerialName("commission_asset") val commissionAsset: String? = null,
    @kotlinx.serialization.SerialName("trade_id") val tradeId: String? = null,
    @kotlinx.serialization.SerialName("created_at") val createdAt: Long
)

@Serializable
data class TradesResponseDto(
    val mode: String,
    val trades: List<FillDto>
)

@Serializable
data class PnlSnapshotDto(
    val id: Long,
    @kotlinx.serialization.SerialName("bot_id") val botId: String,
    @kotlinx.serialization.SerialName("realized_pnl_usdt") val realizedPnlUsdt: Double,
    @kotlinx.serialization.SerialName("unrealized_pnl_usdt") val unrealizedPnlUsdt: Double,
    @kotlinx.serialization.SerialName("equity_usdt") val equityUsdt: Double,
    @kotlinx.serialization.SerialName("created_at") val createdAt: Long
)

@Serializable
data class PnlResponseDto(
    val mode: String,
    val series: List<PnlSnapshotDto>
)

@Serializable
data class EventDto(
    val id: Long,
    @kotlinx.serialization.SerialName("bot_id") val botId: String? = null,
    val type: String,
    val message: String,
    @kotlinx.serialization.SerialName("created_at") val createdAt: Long
)

@Serializable
data class EventsResponseDto(
    val mode: String,
    val events: List<EventDto>
)

@Serializable
data class OkResponseDto(
    val mode: String,
    val ok: Boolean = false
)

@Serializable
data class CreateGridBotRequest(
    val type: String = "grid",
    val symbol: String,
    val lowerPrice: Double,
    val upperPrice: Double,
    val gridLevels: Int,
    val totalBudgetUsdt: Double,
    val mode: String,
    val dailyLossLimitUsdt: Double? = null,
    val confirmLive: Boolean = false
)

@Serializable
data class CreateDcaBotRequest(
    val type: String = "dca",
    val symbol: String,
    val amountUsdt: Double,
    val interval: String,
    val cronExpression: String? = null,
    val dipMultiplier: Double? = null,
    val dipThresholdPct: Double? = null,
    val takeProfitPct: Double? = null,
    val orderStyle: String = "market",
    val dailyLossLimitUsdt: Double? = null,
    val confirmLive: Boolean = false
)
