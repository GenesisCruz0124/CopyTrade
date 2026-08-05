package com.copytrade.app.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.copytrade.app.data.remote.dto.KlineDto
import com.copytrade.app.ui.theme.LossRed
import com.copytrade.app.ui.theme.ProfitGreen
import kotlin.math.abs
import kotlin.math.max

/** A horizontal reference line drawn over the candles — entry/SL/TP/current price, etc. */
data class ChartPriceLine(val price: Double, val label: String, val color: Color, val dashed: Boolean = true)

/** Vico (already used for the PnL line chart) has no candlestick support in the version
 *  pinned here, so this draws OHLC bars directly on a Canvas rather than pulling in a
 *  second charting library or migrating the existing chart to a breaking Vico major version. */
@Composable
fun CandlestickChart(klines: List<KlineDto>, modifier: Modifier = Modifier, priceLines: List<ChartPriceLine> = emptyList()) {
    if (klines.isEmpty()) return
    val textMeasurer = rememberTextMeasurer()
    val labelStyle = TextStyle(fontSize = 11.sp, fontWeight = FontWeight.SemiBold)

    Canvas(modifier = modifier.fillMaxWidth().height(220.dp)) {
        val candlePrices = klines.flatMap { listOf(it.high, it.low) }
        val linePrices = priceLines.map { it.price }
        val allPrices = candlePrices + linePrices
        val maxPrice = allPrices.max()
        val minPrice = allPrices.min()
        val rawRange = maxPrice - minPrice
        val priceRange = if (rawRange > 0.0) rawRange else max(abs(maxPrice) * 0.01, 1.0)
        val paddedMin = minPrice - priceRange * 0.08
        val paddedRange = priceRange * 1.16

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

        priceLines.forEach { line ->
            val y = yFor(line.price)
            drawLine(
                color = line.color,
                start = Offset(0f, y),
                end = Offset(size.width, y),
                strokeWidth = 1.5f,
                pathEffect = if (line.dashed) PathEffect.dashPathEffect(floatArrayOf(12f, 8f)) else null
            )
            val measured = textMeasurer.measure(line.label, labelStyle)
            val labelY = (y - measured.size.height - 2f).coerceIn(0f, size.height - measured.size.height)
            drawRect(
                color = Color.Black.copy(alpha = 0.55f),
                topLeft = Offset(size.width - measured.size.width - 8f, labelY),
                size = Size(measured.size.width + 6f, measured.size.height.toFloat())
            )
            drawText(
                textMeasurer = textMeasurer,
                text = line.label,
                topLeft = Offset(size.width - measured.size.width - 5f, labelY),
                style = labelStyle.copy(color = line.color)
            )
        }
    }
}
