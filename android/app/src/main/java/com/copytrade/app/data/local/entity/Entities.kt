package com.copytrade.app.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "bots")
data class BotEntity(
    @PrimaryKey val id: String,
    val type: String,
    val symbol: String,
    val status: String,
    val configJson: String,
    val confirmLive: Boolean,
    val allocatedUsdt: Double,
    val dailyLossLimitUsdt: Double?,
    val realizedPnlUsdt: Double,
    val createdAt: Long,
    val updatedAt: Long
)

@Entity(tableName = "fills", primaryKeys = ["id"])
data class FillEntity(
    val id: String,
    val botId: String,
    val orderId: String,
    val symbol: String,
    val side: String,
    val price: Double,
    val quantity: Double,
    val quoteQty: Double,
    val commission: Double,
    val commissionAsset: String?,
    val createdAt: Long
)

@Entity(tableName = "pnl_snapshots", primaryKeys = ["id"])
data class PnlSnapshotEntity(
    val id: Long,
    val botId: String,
    val realizedPnlUsdt: Double,
    val unrealizedPnlUsdt: Double,
    val equityUsdt: Double,
    val createdAt: Long
)

@Entity(tableName = "events", primaryKeys = ["id"])
data class EventEntity(
    val id: Long,
    val botId: String?,
    val type: String,
    val message: String,
    val createdAt: Long
)
