package com.copytrade.app.data.remote

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import retrofit2.HttpException

private val errorJson = Json { ignoreUnknownKeys = true }

/**
 * Retrofit's HttpException.message is just "HTTP 400 Bad Request" — the engine's actual
 * reason lives in the JSON error body ({"error": "..."}). Falls back to the generic
 * message when the body isn't parseable JSON (e.g. a network error with no response).
 */
fun Throwable.toUserMessage(): String {
    if (this is HttpException) {
        val body = response()?.errorBody()?.string()
        if (!body.isNullOrBlank()) {
            runCatching {
                val element = errorJson.parseToJsonElement(body).jsonObject
                element["error"]?.jsonPrimitive?.content
            }.getOrNull()?.let { return it }
        }
    }
    return message ?: "Something went wrong"
}
