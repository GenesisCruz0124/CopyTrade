package com.copytrade.app.data.remote

import com.copytrade.app.settings.SettingsRepository
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import kotlinx.serialization.json.Json
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Response
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import java.util.concurrent.TimeUnit

private val json = Json {
    ignoreUnknownKeys = true
    isLenient = true
}

private class AuthInterceptor(private val settings: SettingsRepository) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val token = settings.authToken
        val request = chain.request().newBuilder().apply {
            if (!token.isNullOrBlank()) addHeader("Authorization", "Bearer $token")
        }.build()
        return chain.proceed(request)
    }
}

/** Builds a fresh ApiService bound to the current server URL. Rebuild after the URL changes in Settings. */
fun buildApiService(baseUrl: String, settings: SettingsRepository): ApiService {
    val normalizedUrl = if (baseUrl.endsWith("/")) baseUrl else "$baseUrl/"

    val client = OkHttpClient.Builder()
        .addInterceptor(AuthInterceptor(settings))
        .addInterceptor(HttpLoggingInterceptor().apply { level = HttpLoggingInterceptor.Level.BASIC })
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    val contentType = "application/json".toMediaType()
    return Retrofit.Builder()
        .baseUrl(normalizedUrl)
        .client(client)
        .addConverterFactory(json.asConverterFactory(contentType))
        .build()
        .create(ApiService::class.java)
}
