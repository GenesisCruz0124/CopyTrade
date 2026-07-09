package com.copytrade.app.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.copytrade.app.data.local.entity.BotEntity
import com.copytrade.app.data.local.entity.EventEntity
import com.copytrade.app.data.local.entity.FillEntity
import com.copytrade.app.data.local.entity.PnlSnapshotEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface BotDao {
    @Query("SELECT * FROM bots ORDER BY createdAt DESC")
    fun observeAll(): Flow<List<BotEntity>>

    @Query("SELECT * FROM bots WHERE id = :id")
    fun observeOne(id: String): Flow<BotEntity?>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(bots: List<BotEntity>)

    @Query("DELETE FROM bots WHERE id = :id")
    suspend fun delete(id: String)

    @Query("DELETE FROM bots WHERE id NOT IN (:keepIds)")
    suspend fun deleteMissing(keepIds: List<String>)
}

@Dao
interface FillDao {
    @Query("SELECT * FROM fills WHERE botId = :botId ORDER BY createdAt DESC")
    fun observeForBot(botId: String): Flow<List<FillEntity>>

    @Query("SELECT * FROM fills ORDER BY createdAt DESC LIMIT 500")
    fun observeAll(): Flow<List<FillEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(fills: List<FillEntity>)
}

@Dao
interface PnlDao {
    @Query("SELECT * FROM pnl_snapshots WHERE botId = :botId ORDER BY createdAt ASC")
    fun observeForBot(botId: String): Flow<List<PnlSnapshotEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(snapshots: List<PnlSnapshotEntity>)
}

@Dao
interface EventDao {
    @Query("SELECT * FROM events ORDER BY createdAt DESC LIMIT 200")
    fun observeAll(): Flow<List<EventEntity>>

    @Query("SELECT MAX(createdAt) FROM events")
    suspend fun latestTimestamp(): Long?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(events: List<EventEntity>)
}
