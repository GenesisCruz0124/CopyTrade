package com.copytrade.app.data.remote

import com.copytrade.app.data.remote.dto.BotResponseDto
import com.copytrade.app.data.remote.dto.BotsResponseDto
import com.copytrade.app.data.remote.dto.CopySignalResponseDto
import com.copytrade.app.data.remote.dto.CopySignalsResponseDto
import com.copytrade.app.data.remote.dto.CreateDcaBotRequest
import com.copytrade.app.data.remote.dto.CreateGridBotRequest
import com.copytrade.app.data.remote.dto.EventsResponseDto
import com.copytrade.app.data.remote.dto.FuturesBalanceResponseDto
import com.copytrade.app.data.remote.dto.FuturesOrdersResponseDto
import com.copytrade.app.data.remote.dto.FuturesPendingOrderResponseDto
import com.copytrade.app.data.remote.dto.FuturesPositionResponseDto
import com.copytrade.app.data.remote.dto.FuturesPositionsResponseDto
import com.copytrade.app.data.remote.dto.FuturesPriceDto
import com.copytrade.app.data.remote.dto.FuturesSymbolsResponseDto
import com.copytrade.app.data.remote.dto.FuturesTodayPnlDto
import com.copytrade.app.data.remote.dto.KlinesResponseDto
import com.copytrade.app.data.remote.dto.OkResponseDto
import com.copytrade.app.data.remote.dto.OpenFuturesPositionRequest
import com.copytrade.app.data.remote.dto.OrdersResponseDto
import com.copytrade.app.data.remote.dto.PnlResponseDto
import com.copytrade.app.data.remote.dto.PriceDto
import com.copytrade.app.data.remote.dto.SignalResponseDto
import com.copytrade.app.data.remote.dto.StatusDto
import com.copytrade.app.data.remote.dto.TradesResponseDto
import com.copytrade.app.data.remote.dto.AuthCredentialsRequest
import com.copytrade.app.data.remote.dto.ExchangeKeysRequest
import com.copytrade.app.data.remote.dto.TradingModeRequest
import com.copytrade.app.data.remote.dto.UserResponseDto
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path
import retrofit2.http.Query

interface ApiService {
    @POST("auth/register")
    suspend fun register(@Body request: AuthCredentialsRequest): UserResponseDto

    @POST("auth/login")
    suspend fun login(@Body request: AuthCredentialsRequest): UserResponseDto

    @GET("me")
    suspend fun getMe(): UserResponseDto

    @PUT("me/exchange-keys")
    suspend fun updateExchangeKeys(@Body request: ExchangeKeysRequest): UserResponseDto

    @PUT("me/trading-mode")
    suspend fun updateTradingMode(@Body request: TradingModeRequest): UserResponseDto

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

    @GET("bots/{id}/orders")
    suspend fun getOrders(@Path("id") id: String): OrdersResponseDto

    @GET("bots/{id}/pnl")
    suspend fun getPnl(@Path("id") id: String): PnlResponseDto

    @GET("price/{symbol}")
    suspend fun getPrice(@Path("symbol") symbol: String): PriceDto

    @GET("signals/{symbol}")
    suspend fun getSignal(
        @Path("symbol") symbol: String,
        @Query("interval") interval: String
    ): SignalResponseDto

    @GET("events")
    suspend fun getEvents(@Query("since") since: Long): EventsResponseDto

    @POST("killswitch")
    suspend fun killSwitch(): OkResponseDto

    @GET("copy-signals")
    suspend fun getCopySignals(
        @Query("status") status: String? = null,
        @Query("archived") archived: Boolean? = null
    ): CopySignalsResponseDto

    @POST("copy-signals/{id}/approve")
    suspend fun approveCopySignal(@Path("id") id: String): CopySignalResponseDto

    @POST("copy-signals/{id}/reject")
    suspend fun rejectCopySignal(@Path("id") id: String): CopySignalResponseDto

    @POST("copy-signals/{id}/archive")
    suspend fun archiveCopySignal(@Path("id") id: String): CopySignalResponseDto

    @POST("copy-signals/{id}/unarchive")
    suspend fun unarchiveCopySignal(@Path("id") id: String): CopySignalResponseDto

    @GET("futures/symbols")
    suspend fun getFuturesSymbols(): FuturesSymbolsResponseDto

    @GET("futures/balance")
    suspend fun getFuturesBalance(): FuturesBalanceResponseDto

    @GET("futures/positions")
    suspend fun getFuturesPositions(): FuturesPositionsResponseDto

    @GET("futures/positions/history")
    suspend fun getFuturesPositionsHistory(@Query("limit") limit: Int = 100): FuturesPositionsResponseDto

    @POST("futures/positions")
    suspend fun openFuturesPosition(@Body request: OpenFuturesPositionRequest): FuturesPositionResponseDto

    @POST("futures/positions/{id}/close")
    suspend fun closeFuturesPosition(@Path("id") id: String): FuturesPositionResponseDto

    @GET("futures/price/{symbol}")
    suspend fun getFuturesPrice(@Path("symbol") symbol: String): FuturesPriceDto

    @GET("futures/pnl/today")
    suspend fun getFuturesTodayPnl(): FuturesTodayPnlDto

    @GET("klines/{symbol}")
    suspend fun getKlines(
        @Path("symbol") symbol: String,
        @Query("interval") interval: String = "15m",
        @Query("limit") limit: Int = 100
    ): KlinesResponseDto

    @GET("futures/klines/{symbol}")
    suspend fun getFuturesKlines(
        @Path("symbol") symbol: String,
        @Query("limit") limit: Int = 100
    ): KlinesResponseDto

    @GET("futures/orders")
    suspend fun getFuturesOrders(): FuturesOrdersResponseDto

    @GET("futures/orders/history")
    suspend fun getFuturesOrdersHistory(@Query("limit") limit: Int = 100): FuturesOrdersResponseDto

    @POST("futures/orders/{id}/cancel")
    suspend fun cancelFuturesOrder(@Path("id") id: String): FuturesPendingOrderResponseDto
}
