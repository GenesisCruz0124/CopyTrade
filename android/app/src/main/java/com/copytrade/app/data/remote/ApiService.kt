package com.copytrade.app.data.remote

import com.copytrade.app.data.remote.dto.BotResponseDto
import com.copytrade.app.data.remote.dto.BotsResponseDto
import com.copytrade.app.data.remote.dto.CopySignalResponseDto
import com.copytrade.app.data.remote.dto.CopySignalsResponseDto
import com.copytrade.app.data.remote.dto.CreateDcaBotRequest
import com.copytrade.app.data.remote.dto.CreateGridBotRequest
import com.copytrade.app.data.remote.dto.EventsResponseDto
import com.copytrade.app.data.remote.dto.OkResponseDto
import com.copytrade.app.data.remote.dto.PnlResponseDto
import com.copytrade.app.data.remote.dto.StatusDto
import com.copytrade.app.data.remote.dto.TradesResponseDto
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

interface ApiService {
    @GET("status")
    suspend fun getStatus(): StatusDto

    @GET("bots")
    suspend fun getBots(): BotsResponseDto

    @POST("bots")
    suspend fun createGridBot(@Body request: CreateGridBotRequest): BotResponseDto

    @POST("bots")
    suspend fun createDcaBot(@Body request: CreateDcaBotRequest): BotResponseDto

    @POST("bots/{id}/start")
    suspend fun startBot(@Path("id") id: String): BotResponseDto

    @POST("bots/{id}/pause")
    suspend fun pauseBot(@Path("id") id: String): BotResponseDto

    @POST("bots/{id}/stop")
    suspend fun stopBot(@Path("id") id: String): BotResponseDto

    @DELETE("bots/{id}")
    suspend fun deleteBot(@Path("id") id: String): OkResponseDto

    @GET("bots/{id}/trades")
    suspend fun getTrades(@Path("id") id: String): TradesResponseDto

    @GET("bots/{id}/pnl")
    suspend fun getPnl(@Path("id") id: String): PnlResponseDto

    @GET("events")
    suspend fun getEvents(@Query("since") since: Long): EventsResponseDto

    @POST("killswitch")
    suspend fun killSwitch(): OkResponseDto

    @GET("copy-signals")
    suspend fun getCopySignals(@Query("status") status: String? = null): CopySignalsResponseDto

    @POST("copy-signals/{id}/approve")
    suspend fun approveCopySignal(@Path("id") id: String): CopySignalResponseDto

    @POST("copy-signals/{id}/reject")
    suspend fun rejectCopySignal(@Path("id") id: String): CopySignalResponseDto
}
