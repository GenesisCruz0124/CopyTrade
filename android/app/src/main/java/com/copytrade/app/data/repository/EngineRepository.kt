package com.copytrade.app.data.repository

import com.copytrade.app.data.local.dao.BotDao
import com.copytrade.app.data.local.dao.EventDao
import com.copytrade.app.data.local.dao.FillDao
import com.copytrade.app.data.local.dao.PnlDao
import com.copytrade.app.data.local.entity.BotEntity
import com.copytrade.app.data.local.entity.EventEntity
import com.copytrade.app.data.local.entity.FillEntity
import com.copytrade.app.data.local.entity.PnlSnapshotEntity
import com.copytrade.app.data.remote.ApiService
import com.copytrade.app.data.remote.dto.CopySignalDto
import com.copytrade.app.data.remote.dto.CreateDcaBotRequest
import com.copytrade.app.data.remote.dto.CreateGridBotRequest
import com.copytrade.app.data.remote.dto.StatusDto
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.Json

/** Retrofit -> Room -> Flow: every refresh call fetches from the engine and writes through to the local cache. */
class EngineRepository(
    private val api: ApiService,
    private val botDao: BotDao,
    private val fillDao: FillDao,
    private val pnlDao: PnlDao,
    private val eventDao: EventDao
) {
    fun observeBots(): Flow<List<BotEntity>> = botDao.observeAll()
    fun observeBot(id: String): Flow<BotEntity?> = botDao.observeOne(id)
    fun observeFillsForBot(botId: String): Flow<List<FillEntity>> = fillDao.observeForBot(botId)
    fun observeAllFills(): Flow<List<FillEntity>> = fillDao.observeAll()
    fun observePnlForBot(botId: String): Flow<List<PnlSnapshotEntity>> = pnlDao.observeForBot(botId)
    fun observeEvents(): Flow<List<EventEntity>> = eventDao.observeAll()

    suspend fun getStatus(): StatusDto = api.getStatus()

    suspend fun refreshBots() {
        val response = api.getBots()
        val entities = response.bots.map { it.toEntity() }
        botDao.upsertAll(entities)
        botDao.deleteMissing(entities.map { it.id })
    }

    suspend fun createGridBot(request: CreateGridBotRequest) {
        api.createGridBot(request)
        refreshBots()
    }

    suspend fun createDcaBot(request: CreateDcaBotRequest) {
        api.createDcaBot(request)
        refreshBots()
    }

    suspend fun startBot(id: String) {
        api.startBot(id)
        refreshBots()
    }

    suspend fun pauseBot(id: String) {
        api.pauseBot(id)
        refreshBots()
    }

    suspend fun stopBot(id: String) {
        api.stopBot(id)
        refreshBots()
    }

    suspend fun deleteBot(id: String) {
        api.deleteBot(id)
        botDao.delete(id)
    }

    suspend fun refreshTrades(botId: String) {
        val response = api.getTrades(botId)
        fillDao.upsertAll(response.trades.map { it.toEntity() })
    }

    suspend fun getOpenOrders(botId: String) = api.getOrders(botId).orders

    suspend fun getPrice(symbol: String) = api.getPrice(symbol).price

    suspend fun refreshPnl(botId: String) {
        val response = api.getPnl(botId)
        pnlDao.upsertAll(response.series.map { it.toEntity(botId) })
    }

    suspend fun refreshEvents() {
        val since = eventDao.latestTimestamp() ?: 0L
        val response = api.getEvents(since)
        if (response.events.isNotEmpty()) {
            eventDao.upsertAll(response.events.map { it.toEntity() })
        }
    }

    suspend fun engageKillSwitch() {
        api.killSwitch()
        refreshBots()
    }

    suspend fun getCopySignals(status: String? = null): List<CopySignalDto> = api.getCopySignals(status).signals

    suspend fun approveCopySignal(id: String): CopySignalDto? = api.approveCopySignal(id).signal

    suspend fun rejectCopySignal(id: String): CopySignalDto? = api.rejectCopySignal(id).signal

    private fun com.copytrade.app.data.remote.dto.BotDto.toEntity() = BotEntity(
        id = id,
        type = type,
        symbol = symbol,
        status = status,
        configJson = Json.encodeToString(kotlinx.serialization.json.JsonElement.serializer(), config),
        confirmLive = confirmLive,
        allocatedUsdt = allocatedUsdt,
        dailyLossLimitUsdt = dailyLossLimitUsdt,
        realizedPnlUsdt = realizedPnlUsdt,
        createdAt = createdAt,
        updatedAt = updatedAt
    )

    private fun com.copytrade.app.data.remote.dto.FillDto.toEntity() = FillEntity(
        id = id,
        botId = botId,
        orderId = orderId,
        symbol = symbol,
        side = side,
        price = price,
        quantity = quantity,
        quoteQty = quoteQty,
        commission = commission,
        commissionAsset = commissionAsset,
        createdAt = createdAt
    )

    private fun com.copytrade.app.data.remote.dto.PnlSnapshotDto.toEntity(botId: String) = PnlSnapshotEntity(
        id = id,
        botId = botId,
        realizedPnlUsdt = realizedPnlUsdt,
        unrealizedPnlUsdt = unrealizedPnlUsdt,
        equityUsdt = equityUsdt,
        createdAt = createdAt
    )

    private fun com.copytrade.app.data.remote.dto.EventDto.toEntity() = EventEntity(
        id = id,
        botId = botId,
        type = type,
        message = message,
        createdAt = createdAt
    )
}
