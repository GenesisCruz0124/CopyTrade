package com.copytrade.app.ui.navigation

sealed class Screen(val route: String) {
    data object Setup : Screen("setup")
    data object Dashboard : Screen("dashboard")
    data object CreateBot : Screen("create_bot")
    data object TradeLog : Screen("trade_log")
    data object Settings : Screen("settings")
    data object CopySignals : Screen("copy_signals")
    data object Signals : Screen("signals")
    data object Activity : Screen("activity")
    data object Futures : Screen("futures")
    data object FuturesHistory : Screen("futures_history")
    data object BotDetail : Screen("bot_detail/{botId}") {
        fun route(botId: String) = "bot_detail/$botId"
    }
}
