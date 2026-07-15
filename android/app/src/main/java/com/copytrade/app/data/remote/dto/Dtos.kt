package com.copytrade.app.data.remote.dto

import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
data class BalanceDto(
    val asset: String,
    val free: Double,
    val locked: Double
)

@Serializable
data class PriceDto(
    val mode: String,
    val symbol: String,
    val price: Double
)

@Serializable
data class StatusDto(
    val mode: String,
    val uptimeSeconds: Long,
    val balances: List<BalanceDto> = emptyList(),
    val totalValueUsdt: Double? = null,
    val usdToPhpRate: Double? = null,
    val totalValuePhp: Double? = null,
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
data class OrderDto(
    val id: String,
    @kotlinx.serialization.SerialName("bot_id") val botId: String,
    @kotlinx.serialization.SerialName("client_order_id") val clientOrderId: String,
    @kotlinx.serialization.SerialName("exchange_order_id") val exchangeOrderId: String? = null,
    val symbol: String,
    val side: String,
    val type: String,
    val price: Double? = null,
    val quantity: Double,
    val status: String,
    @kotlinx.serialization.SerialName("grid_level") val gridLevel: Int? = null,
    @kotlinx.serialization.SerialName("created_at") val createdAt: Long
)

@Serializable
data class OrdersResponseDto(
    val mode: String,
    val orders: List<OrderDto>
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
@OptIn(ExperimentalSerializationApi::class)
data class CreateGridBotRequest(
    @EncodeDefault val type: String = "grid",
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
data class CopySignalDto(
    val id: String,
    val source: String,
    @kotlinx.serialization.SerialName("channel_message_id") val channelMessageId: String? = null,
    val symbol: String? = null,
    val side: String? = null,
    val leverage: Double? = null,
    @kotlinx.serialization.SerialName("entry_price") val entryPrice: Double? = null,
    @kotlinx.serialization.SerialName("stop_loss") val stopLoss: Double? = null,
    @kotlinx.serialization.SerialName("take_profit") val takeProfit: Double? = null,
    val confidence: Double? = null,
    val status: String,
    @kotlinx.serialization.SerialName("order_id") val orderId: String? = null,
    @kotlinx.serialization.SerialName("failure_reason") val failureReason: String? = null,
    @kotlinx.serialization.SerialName("created_at") val createdAt: Long
)

@Serializable
data class CopySignalsResponseDto(
    val mode: String,
    val signals: List<CopySignalDto>
)

@Serializable
data class CopySignalResponseDto(
    val mode: String,
    val signal: CopySignalDto? = null,
    val error: String? = null
)

@Serializable
data class FuturesSymbolDto(
    val symbol: String,
    val baseCoin: String,
    val quoteCoin: String,
    val maxLeverage: Double
)

@Serializable
data class FuturesSymbolsResponseDto(
    val mode: String,
    val symbols: List<FuturesSymbolDto> = emptyList(),
    val error: String? = null
)

@Serializable
data class FuturesBalanceDto(
    val currency: String,
    val availableBalance: Double,
    val positionMargin: Double,
    val equity: Double
)

@Serializable
data class FuturesBalanceResponseDto(
    val mode: String,
    val balance: FuturesBalanceDto? = null,
    val error: String? = null
)

@Serializable
data class FuturesPositionDto(
    val id: String,
    val symbol: String,
    val side: String,
    val leverage: Double,
    @kotlinx.serialization.SerialName("open_type") val openType: String,
    @kotlinx.serialization.SerialName("entry_price") val entryPrice: Double,
    val quantity: Double,
    @kotlinx.serialization.SerialName("margin_usdt") val marginUsdt: Double,
    @kotlinx.serialization.SerialName("take_profit_price") val takeProfitPrice: Double? = null,
    @kotlinx.serialization.SerialName("stop_loss_price") val stopLossPrice: Double? = null,
    val status: String,
    @kotlinx.serialization.SerialName("close_price") val closePrice: Double? = null,
    @kotlinx.serialization.SerialName("realized_pnl_usdt") val realizedPnlUsdt: Double? = null,
    @kotlinx.serialization.SerialName("created_at") val createdAt: Long,
    val currentPrice: Double? = null,
    val unrealizedPnlUsdt: Double? = null,
    val unrealizedPnlPercent: Double? = null
)

@Serializable
data class FuturesPositionsResponseDto(
    val mode: String,
    val positions: List<FuturesPositionDto> = emptyList()
)

@Serializable
data class FuturesPositionResponseDto(
    val mode: String,
    val position: FuturesPositionDto? = null,
    val error: String? = null
)

@Serializable
data class OpenFuturesPositionRequest(
    val symbol: String,
    val side: String,
    val leverage: Double,
    val openType: String = "isolated",
    val amountUsd: Double? = null,
    val percentOfBalance: Double? = null,
    val takeProfitPercent: Double? = null,
    val stopLossPercent: Double? = null,
    val confirmLive: Boolean = false
)

@Serializable
@OptIn(ExperimentalSerializationApi::class)
data class CreateDcaBotRequest(
    @EncodeDefault val type: String = "dca",
    val symbol: String,
    val amountUsdt: Double,
    val interval: String,
    val cronExpression: String? = null,
    val dipMultiplier: Double? = null,
    val dipThresholdPct: Double? = null,
    val takeProfitPct: Double? = null,
    @EncodeDefault val orderStyle: String = "market",
    val dailyLossLimitUsdt: Double? = null,
    val confirmLive: Boolean = false
)
