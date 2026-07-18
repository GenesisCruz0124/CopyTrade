package com.copytrade.app.ui.strings

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.compositionLocalOf

enum class AppLanguage { ENGLISH, TAGLISH }

val LocalAppLanguage = compositionLocalOf { AppLanguage.ENGLISH }

/** A string with both an English and a Taglish rendering, picked by the current app language. */
data class Bi(val en: String, val tl: String)

@Composable
fun Bi.resolve(): String {
    return if (LocalAppLanguage.current == AppLanguage.ENGLISH) en else tl
}

/** All user-facing copy in the app, in both English and Taglish. */
object Strings {
    val appName = Bi("CopyTrade", "CopyTrade")

    // Setup / login
    val setupTitle = Bi("Connect to your engine", "I-connect sa iyong engine")
    val serverUrlLabel = Bi("Server URL", "URL ng Server")
    val bearerTokenLabel = Bi("Bearer token", "Bearer token")
    val testConnection = Bi("Test connection", "I-test ang koneksyon")
    val connectAndContinue = Bi("Connect & continue", "Kumonekta at magpatuloy")
    val connectionSuccess = Bi("Connected successfully", "Successful ang koneksyon")
    val connectionFailed = Bi("Could not connect. Check the URL and token.", "Hindi ma-connect. I-check ang URL at token.")

    // Dashboard
    val dashboardTitle = Bi("Dashboard", "Dashboard")
    val totalBalance = Bi("Total balance", "Kabuuang balanse")
    val futuresAvailable = Bi("Futures available", "Available sa Futures")
    val activeBots = Bi("Active bots", "Mga aktibong bot")
    val noBotsYet = Bi("No bots yet. Tap + to create one.", "Wala pang bot. I-tap ang + para gumawa.")
    val killSwitch = Bi("Kill switch", "Kill switch")
    val killSwitchConfirmTitle = Bi("Are you sure?", "Sigurado ka ba?")
    val killSwitchConfirmMessage = Bi(
        "All open orders will be cancelled and every bot paused.",
        "Lahat ng open orders ay ika-cancel at ma-pause ang lahat ng bot."
    )
    val cancel = Bi("Cancel", "Kanselahin")
    val confirm = Bi("Confirm", "Kumpirmahin")
    val paperModeBadge = Bi("PAPER", "PAPER")
    val liveModeBadge = Bi("LIVE", "LIVE")

    // Bot detail
    val botDetailTitle = Bi("Bot detail", "Detalye ng bot")
    val openOrders = Bi("Open orders", "Mga bukas na order")
    val noOpenOrders = Bi("No open orders", "Walang bukas na order")
    val recentFills = Bi("Recent fills", "Kamakailang fills")
    val pnlChart = Bi("PnL", "PnL")
    val priceChart = Bi("Price chart", "Price chart")
    val start = Bi("Start", "Simulan")
    val pause = Bi("Pause", "I-pause")
    val stop = Bi("Stop", "Itigil")
    val delete = Bi("Delete", "Burahin")
    val statusRunning = Bi("Running", "Tumatakbo")
    val statusPaused = Bi("Paused", "Naka-pause")
    val statusStopped = Bi("Stopped", "Nakatigil")
    val botPausedToast = Bi("Bot is paused", "Naka-pause ang bot")

    // Create bot
    val createBotTitle = Bi("Create bot", "Gumawa ng bot")
    val strategyType = Bi("Strategy", "Estratehiya")
    val grid = Bi("Grid", "Grid")
    val dca = Bi("DCA", "DCA")
    val symbol = Bi("Symbol", "Symbol")
    val lowerPrice = Bi("Lower price", "Pinakamababang presyo")
    val upperPrice = Bi("Upper price", "Pinakamataas na presyo")
    val gridLevels = Bi("Grid levels", "Grid levels")
    val totalBudget = Bi("Total budget (USDT)", "Kabuuang budget (USDT)")
    val gridMode = Bi("Mode", "Mode")
    val amountPerBuy = Bi("Amount per buy (USDT)", "Halaga bawat bili (USDT)")
    val interval = Bi("Interval", "Interval")
    val dipMultiplier = Bi("Dip multiplier", "Dip multiplier")
    val dipThreshold = Bi("Dip threshold (%)", "Dip threshold (%)")
    val takeProfit = Bi("Take-profit (%)", "Take-profit (%)")
    val confirmLive = Bi("I understand this trades with real funds", "Naiintindihan kong gagamit ito ng totoong pera")
    val create = Bi("Create", "Gumawa")
    val validationError = Bi("Please fix the highlighted fields", "Pakiayos ang mga naka-highlight na field")

    // Trade log
    val tradeLogTitle = Bi("Trade log", "Trade log")
    val allBots = Bi("All bots", "Lahat ng bot")
    val noFillsYet = Bi("No fills yet", "Wala pang fills")

    // Settings
    val settingsTitle = Bi("Settings", "Settings")
    val language = Bi("Language", "Wika")
    val english = Bi("English", "English")
    val taglish = Bi("Taglish", "Taglish")
    val serverSettings = Bi("Server settings", "Server settings")
    val about = Bi("About", "Tungkol dito")
    val appVersion = Bi("App version", "Bersyon ng app")
    val aboutBody = Bi(
        "CopyTrade controls a self-hosted MEXC Spot grid/DCA engine. No analytics, no trackers.",
        "Kinokontrol ng CopyTrade ang sarili mong MEXC Spot grid/DCA engine. Walang analytics, walang tracker."
    )
    val logout = Bi("Disconnect", "Idiskonekta")

    // Notifications
    val notificationsSection = Bi("Notifications", "Mga Notification")
    val notifyNewSignals = Bi("Notify me on new Discord signals", "Ipaalam sa akin ang bagong Discord signal")

    // Common
    val retry = Bi("Retry", "Ulitin")
    val loading = Bi("Loading…", "Naglo-load…")
    val error = Bi("Something went wrong", "May nagkamali")

    // Copy signals
    val copySignalsTitle = Bi("Copy signals", "Copy signals")
    val noPendingSignals = Bi("No pending signals", "Walang pending na signal")
    val approve = Bi("Approve", "Aprubahan")
    val reject = Bi("Reject", "Tanggihan")
    val signalValid = Bi("Valid", "Valid")
    val signalInvalid = Bi("Invalid", "Invalid")
    val signalNotChecked = Bi("Not checked", "Hindi pa na-check")
    val copyToFutures = Bi("Copy to Futures", "Kopyahin sa Futures")
    val copyToFuturesHint = Bi(
        "Opens the Futures form pre-filled — set your size/risk, then place the order.",
        "Bubuksan ang Futures form na naka-fill na — ilagay ang size/risk, tapos i-place ang order."
    )
    val approveConfirmTitle = Bi("Approve this signal?", "Aaprubahan ang signal na ito?")
    val approveConfirmMessage = Bi(
        "This will open a real futures position sized from your copy-trading budget.",
        "Magbubukas ito ng totoong futures position gamit ang iyong copy-trading budget."
    )
    val signalConfidence = Bi("Confidence", "Confidence")
    val signalPending = Bi("Pending", "Pending")
    val signalExecuted = Bi("Executed", "Naisagawa")
    val signalFailed = Bi("Failed", "Nabigo")
    val signalRejected = Bi("Rejected", "Tinanggihan")

    // Market signals
    val signalsTitle = Bi("Market signals", "Market signals")
    val signalsPairLabel = Bi("Coin pair (e.g. BTCUSDT)", "Coin pair (e.g. BTCUSDT)")
    val signalsTimeframe = Bi("Timeframe", "Timeframe")
    val signalsAnalyze = Bi("Analyze", "I-analyze")
    val signalsAnalyzing = Bi("Analyzing market…", "Ina-analyze ang market…")
    val signalsEmptyHint = Bi(
        "Enter a coin pair and tap Analyze to get a long/short signal.",
        "Maglagay ng coin pair at i-tap ang Analyze para sa long/short signal."
    )
    val signalsLong = Bi("LONG", "LONG")
    val signalsShort = Bi("SHORT", "SHORT")
    val signalsNeutral = Bi("NEUTRAL", "NEUTRAL")
    val signalsNeutralHint = Bi(
        "No clear edge right now — best to wait.",
        "Walang malinaw na edge ngayon — mas mabuting maghintay."
    )
    val signalsSuggestedEntry = Bi("Suggested entry", "Suggested entry")
    val signalsStopLoss = Bi("Stop loss", "Stop loss")
    val signalsTakeProfit = Bi("Take profit", "Take profit")
    val signalsRiskReward = Bi("Risk / reward", "Risk / reward")
    val signalsWhy = Bi("Why this signal", "Bakit ganito ang signal")
    val signalsIndicators = Bi("Indicators", "Mga indicator")
    val signalsTradeThis = Bi("Trade this signal", "I-trade ang signal na ito")
    val signalsDisclaimer = Bi(
        "For information only. Not financial advice — trade at your own risk.",
        "Para sa impormasyon lamang. Hindi financial advice — mag-trade nang may sariling pananagutan."
    )

    // Activity / alerts feed
    val activityTitle = Bi("Activity", "Activity")
    val activityEmpty = Bi(
        "No activity yet. Signal alerts and bot events will show up here.",
        "Wala pang activity. Dito lalabas ang signal alerts at bot events."
    )
    val activitySignalAlert = Bi("Signal alert", "Signal alert")

    // Futures trading
    val futuresTitle = Bi("Futures trading", "Futures trading")
    val futuresNotConfigured = Bi(
        "Futures trading is not configured on this engine.",
        "Hindi pa naka-configure ang futures trading sa engine na ito."
    )
    val tokenPair = Bi("Token pair", "Token pair")
    val searchTokenPair = Bi("Search token pair (e.g. BTC_USDT)", "Maghanap ng token pair (e.g. BTC_USDT)")
    val openLong = Bi("Open long", "Open long")
    val openShort = Bi("Open short", "Open short")
    val leverage = Bi("Leverage", "Leverage")
    val marginMode = Bi("Margin mode", "Margin mode")
    val isolated = Bi("Isolated", "Isolated")
    val cross = Bi("Cross", "Cross")
    val sizeByUsd = Bi("Fixed USD amount", "Fixed na halaga sa USD")
    val sizeByPercent = Bi("% of balance", "% ng balance")
    val amountUsdLabel = Bi("Amount (USDT)", "Halaga (USDT)")
    val percentOfBalanceLabel = Bi("Percent of balance (%)", "Porsyento ng balance (%)")
    val takeProfitPercentLabel = Bi("Take-profit (%)", "Take-profit (%)")
    val stopLossPercentLabel = Bi("Stop-loss (%)", "Stop-loss (%)")
    val availableBalance = Bi("Available balance", "Available na balance")
    val openPosition = Bi("Open position", "Buksan ang position")
    val closePosition = Bi("Close", "Isara")
    val openPositions = Bi("Open positions", "Mga bukas na position")
    val noOpenPositions = Bi("No open positions", "Walang bukas na position")
    val entryPrice = Bi("Entry", "Entry")
    val currentPriceLabel = Bi("Current", "Kasalukuyan")
    val positionOpened = Bi("Position opened", "Nabuksan ang position")
    val futuresHistoryTitle = Bi("Futures history", "Futures history")
    val openTab = Bi("Open", "Bukas")
    val historyTab = Bi("History", "History")
    val signalsTab = Bi("Signals", "Signals")
    val noPositionHistory = Bi("No closed positions yet", "Wala pang saradong position")
    val closedAtLabel = Bi("Closed", "Sarado")
    val realizedPnlLabel = Bi("Realized PnL", "Realized PnL")
    val closeReasonManual = Bi("Manual", "Manual")
    val closeReasonTakeProfit = Bi("Take-profit hit", "Naabot ang take-profit")
    val closeReasonStopLoss = Bi("Stop-loss hit", "Naabot ang stop-loss")
    val riskUsdAmountLabel = Bi("Risk amount (USD)", "Risk na halaga (USD)")
    val riskUsdAmountAuto = Bi("if stop-loss hits at this size", "kung tumama ang stop-loss sa size na ito")
    val impliedProfitHint = Bi("profit if take-profit hits at this size", "kita kung tumama ang take-profit sa size na ito")
    val riskUsdAmountHintPercent = Bi(
        "Optional — how much you're willing to lose; auto-fills stop-loss %",
        "Optional — magkano ang gusto mong ma-risk; awtomatikong pupunuin ang stop-loss %"
    )
    val riskUsdAmountHintPrice = Bi(
        "Optional — how much you're willing to lose; auto-fills the position size",
        "Optional — magkano ang gusto mong ma-risk; awtomatikong pupunuin ang laki ng position"
    )
    val tradingFeeLabel = Bi("Trading fee", "Trading fee")
    val stopLossByPercent = Bi("Stop-loss %", "Stop-loss %")
    val stopLossByPrice = Bi("Stop-loss price", "Stop-loss price")
    val stopLossPriceLabel = Bi("Stop-loss price (USD)", "Stop-loss price (USD)")
    val todaysPnlLabel = Bi("Today's PnL", "PnL ngayong araw")
    val takeProfitByPercent = Bi("Take-profit %", "Take-profit %")
    val takeProfitByPrice = Bi("Take-profit price", "Take-profit price")
    val takeProfitPriceLabel = Bi("Take-profit price (USD)", "Take-profit price (USD)")
    val orderTypeLabel = Bi("Order type", "Order type")
    val orderTypeMarket = Bi("Market", "Market")
    val orderTypeLimit = Bi("Limit", "Limit")
    val limitPriceLabel = Bi("Limit price (USD)", "Limit price (USD)")
    val orderPlaced = Bi("Order placed", "Naisumite ang order")
    val pendingTab = Bi("Pending", "Pending")
    val noPendingOrders = Bi("No pending orders", "Walang pending na order")
    val cancelOrder = Bi("Cancel order", "Kanselahin ang order")
    val pendingStatusLabel = Bi("Status", "Status")
    val filledLabel = Bi("Filled", "Napuno")
}

@Composable
fun ProvideAppLanguage(language: AppLanguage, content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalAppLanguage provides language, content = content)
}
