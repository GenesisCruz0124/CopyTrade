package com.copytrade.app.data.local

import androidx.room.Database
import androidx.room.RoomDatabase
import com.copytrade.app.data.local.dao.BotDao
import com.copytrade.app.data.local.dao.EventDao
import com.copytrade.app.data.local.dao.FillDao
import com.copytrade.app.data.local.dao.PnlDao
import com.copytrade.app.data.local.entity.BotEntity
import com.copytrade.app.data.local.entity.EventEntity
import com.copytrade.app.data.local.entity.FillEntity
import com.copytrade.app.data.local.entity.PnlSnapshotEntity

@Database(
    entities = [BotEntity::class, FillEntity::class, PnlSnapshotEntity::class, EventEntity::class],
    version = 1,
    exportSchema = false
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun botDao(): BotDao
    abstract fun fillDao(): FillDao
    abstract fun pnlDao(): PnlDao
    abstract fun eventDao(): EventDao
}
