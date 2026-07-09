package com.copytrade.app.ui.navigation

sealed class Screen(val route: String) {
    data object Setup : Screen("setup")
    data object Dashboard : Screen("dashboard")
    data object CreateBot : Screen("create_bot")
    data object TradeLog : Screen("trade_log")
    data object Settings : Screen("settings")
    data object BotDetail : Screen("bot_detail/{botId}") {
        fun route(botId: String) = "bot_detail/$botId"
    }
}
