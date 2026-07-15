package com.copytrade.app.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.unit.dp
import com.copytrade.app.data.remote.dto.KlineDto
import com.copytrade.app.ui.theme.LossRed
import com.copytrade.app.ui.theme.ProfitGreen
import kotlin.math.abs
import kotlin.math.max

/** Vico (already used for the PnL line chart) has no candlestick support in the version
 *  pinned here, so this draws OHLC bars directly on a Canvas rather than pulling in a
 *  second charting library or migrating the existing chart to a breaking Vico major version. */
@Composable
fun CandlestickChart(klines: List<KlineDto>, modifier: Modifier = Modifier) {
    if (klines.isEmpty()) return

    Canvas(modifier = modifier.fillMaxWidth().height(180.dp)) {
        val maxPrice = klines.maxOf { it.high }
        val minPrice = klines.minOf { it.low }
        val rawRange = maxPrice - minPrice
        val priceRange = if (rawRange > 0.0) rawRange else max(abs(maxPrice) * 0.01, 1.0)
        val paddedMin = minPrice - priceRange * 0.05
        val paddedRange = priceRange * 1.1

        fun yFor(price: Double): Float = size.height - ((price - paddedMin) / paddedRange * size.height).toFloat()

        val candleWidth = size.width / klines.size
        val bodyWidth = candleWidth * 0.6f

        klines.forEachIndexed { index, k ->
            val centerX = candleWidth * index + candleWidth / 2f
            val bullish = k.close >= k.open
            val color = if (bullish) ProfitGreen else LossRed

            drawLine(
                color = color,
                start = Offset(centerX, yFor(k.high)),
                end = Offset(centerX, yFor(k.low)),
                strokeWidth = 2f
            )

            val yOpen = yFor(k.open)
            val yClose = yFor(k.close)
            drawRect(
                color = color,
                topLeft = Offset(centerX - bodyWidth / 2f, minOf(yOpen, yClose)),
                size = Size(bodyWidth, max(1f, abs(yClose - yOpen)))
            )
        }
    }
}
