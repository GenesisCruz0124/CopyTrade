package com.copytrade.app.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.copytrade.app.data.remote.dto.KlineDto
import com.copytrade.app.ui.strings.Strings
import com.copytrade.app.ui.strings.resolve
import com.copytrade.app.ui.theme.LossRed
import com.copytrade.app.ui.theme.ProfitGreen
import kotlin.math.abs
import kotlin.math.max

private enum class DragTarget { SL, TP }

/**
 * MT5-style chart: entry is a fixed reference line, SL/TP are draggable directly on the
 * candles. Dragging shows the possible profit/loss (USDT) that price would produce live;
 * releasing commits it via onStopLossDragEnd/onTakeProfitDragEnd — the caller is
 * responsible for actually calling the set-SL/TP-by-price endpoint from there.
 */
@Composable
fun DraggableTradeChart(
    klines: List<KlineDto>,
    entryPrice: Double,
    side: String,
    quantity: Double,
    contractSize: Double,
    marginUsdt: Double,
    stopLossPrice: Double?,
    takeProfitPrice: Double?,
    onStopLossDragEnd: (Double) -> Unit,
    onTakeProfitDragEnd: (Double) -> Unit,
    modifier: Modifier = Modifier
) {
    if (klines.isEmpty()) return

    var liveSl by remember(stopLossPrice) { mutableStateOf(stopLossPrice) }
    var liveTp by remember(takeProfitPrice) { mutableStateOf(takeProfitPrice) }
    var dragging by remember { mutableStateOf<DragTarget?>(null) }

    val textMeasurer = rememberTextMeasurer()
    val labelStyle = TextStyle(fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
    val direction = if (side == "long") 1 else -1

    val candleMax = klines.maxOf { it.high }
    val candleMin = klines.minOf { it.low }
    val allPrices = listOfNotNull(candleMax, candleMin, entryPrice, stopLossPrice, takeProfitPrice)
    val maxPrice = allPrices.max()
    val minPrice = allPrices.min()
    val rawRange = maxPrice - minPrice
    val priceRange = if (rawRange > 0.0) rawRange else max(abs(maxPrice) * 0.01, 1.0)
    val paddedMin = minPrice - priceRange * 0.12
    val paddedRange = priceRange * 1.24

    fun yFor(price: Double, heightPx: Float): Float = heightPx - ((price - paddedMin) / paddedRange * heightPx).toFloat()
    fun priceFor(y: Float, heightPx: Float): Double = paddedMin + ((heightPx - y) / heightPx) * paddedRange

    Column(modifier = modifier) {
        Canvas(
            modifier = Modifier
                .fillMaxWidth()
                .height(240.dp)
                .pointerInput(stopLossPrice, takeProfitPrice) {
                    detectDragGestures(
                        onDragStart = { offset ->
                            val h = size.height.toFloat()
                            val slY = liveSl?.let { yFor(it, h) }
                            val tpY = liveTp?.let { yFor(it, h) }
                            val hitSl = slY != null && abs(offset.y - slY) < 28f
                            val hitTp = tpY != null && abs(offset.y - tpY) < 28f
                            dragging = when {
                                hitSl && hitTp -> if (abs(offset.y - slY!!) < abs(offset.y - tpY!!)) DragTarget.SL else DragTarget.TP
                                hitSl -> DragTarget.SL
                                hitTp -> DragTarget.TP
                                else -> null
                            }
                        },
                        onDrag = { change, dragAmount ->
                            if (dragging == null) return@detectDragGestures
                            change.consume()
                            val h = size.height.toFloat()
                            when (dragging) {
                                DragTarget.SL -> liveSl?.let { liveSl = priceFor(yFor(it, h) + dragAmount.y, h).coerceAtLeast(0.0) }
                                DragTarget.TP -> liveTp?.let { liveTp = priceFor(yFor(it, h) + dragAmount.y, h).coerceAtLeast(0.0) }
                                null -> {}
                            }
                        },
                        onDragEnd = {
                            when (dragging) {
                                DragTarget.SL -> liveSl?.let(onStopLossDragEnd)
                                DragTarget.TP -> liveTp?.let(onTakeProfitDragEnd)
                                null -> {}
                            }
                            dragging = null
                        },
                        onDragCancel = { dragging = null }
                    )
                }
        ) {
            val candleWidth = size.width / klines.size
            val bodyWidth = candleWidth * 0.6f
            val h = size.height

            klines.forEachIndexed { index, k ->
                val centerX = candleWidth * index + candleWidth / 2f
                val bullish = k.close >= k.open
                val color = if (bullish) ProfitGreen else LossRed
                drawLine(color = color, start = Offset(centerX, yFor(k.high, h)), end = Offset(centerX, yFor(k.low, h)), strokeWidth = 2f)
                val yOpen = yFor(k.open, h)
                val yClose = yFor(k.close, h)
                drawRect(
                    color = color,
                    topLeft = Offset(centerX - bodyWidth / 2f, minOf(yOpen, yClose)),
                    size = Size(bodyWidth, max(1f, abs(yClose - yOpen)))
                )
            }

            fun drawPriceLine(price: Double, label: String, color: Color, dashed: Boolean) {
                val y = yFor(price, h)
                drawLine(
                    color = color,
                    start = Offset(0f, y),
                    end = Offset(size.width, y),
                    strokeWidth = if (dashed) 1.5f else 2f,
                    pathEffect = if (dashed) PathEffect.dashPathEffect(floatArrayOf(12f, 8f)) else null
                )
                val measured = textMeasurer.measure(label, labelStyle)
                val labelY = (y - measured.size.height - 2f).coerceIn(0f, h - measured.size.height)
                drawRect(
                    color = Color.Black.copy(alpha = 0.55f),
                    topLeft = Offset(size.width - measured.size.width - 8f, labelY),
                    size = Size(measured.size.width + 6f, measured.size.height.toFloat())
                )
                drawText(textMeasurer = textMeasurer, text = label, topLeft = Offset(size.width - measured.size.width - 5f, labelY), style = labelStyle.copy(color = color))
            }

            drawPriceLine(entryPrice, "Entry", Color(0xFF3B82F6), dashed = false)
            liveSl?.let { drawPriceLine(it, "SL ${formatChartPrice(it)}", LossRed, dashed = true) }
            liveTp?.let { drawPriceLine(it, "TP ${formatChartPrice(it)}", ProfitGreen, dashed = true) }
        }

        val draggedPrice = when (dragging) {
            DragTarget.SL -> liveSl
            DragTarget.TP -> liveTp
            null -> null
        }
        if (draggedPrice != null) {
            val profit = (draggedPrice - entryPrice) * quantity * contractSize * direction
            val profitPercent = if (marginUsdt > 0) profit / marginUsdt * 100 else null
            val sign = if (profit >= 0) "+" else ""
            val color = if (profit >= 0) ProfitGreen else LossRed
            Text(
                "${Strings.possibleProfitLabel.resolve()}: $sign${"%.2f".format(profit)} USDT" +
                    (profitPercent?.let { " ($sign${"%.2f".format(it)}%)" } ?: ""),
                color = color,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(top = 8.dp)
            )
        } else {
            Text(
                Strings.dragToAdjustHint.resolve(),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(top = 8.dp)
            )
        }
    }
}

private fun formatChartPrice(price: Double): String =
    String.format(java.util.Locale.US, "%.8f", price).trimEnd('0').trimEnd('.')
