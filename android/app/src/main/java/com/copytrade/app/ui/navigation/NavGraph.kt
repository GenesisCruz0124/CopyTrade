package com.copytrade.app.ui.navigation

import androidx.compose.runtime.Composable
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import androidx.navigation.NavType
import com.copytrade.app.ui.activity.ActivityScreen
import com.copytrade.app.ui.botdetail.BotDetailScreen
import com.copytrade.app.ui.bots.BotsScreen
import com.copytrade.app.ui.copysignals.CopySignalsScreen
import com.copytrade.app.ui.createbot.CreateBotScreen
import com.copytrade.app.ui.dashboard.DashboardScreen
import com.copytrade.app.ui.futures.FuturesHistoryScreen
import com.copytrade.app.ui.futures.FuturesScreen
import com.copytrade.app.ui.settings.SettingsScreen
import com.copytrade.app.ui.setup.SetupScreen
import com.copytrade.app.ui.signals.SignalsScreen
import com.copytrade.app.ui.tradelog.TradeLogScreen

@Composable
fun CopyTradeNavGraph(startDestination: String) {
    val navController: NavHostController = rememberNavController()

    NavHost(navController = navController, startDestination = startDestination) {
        composable(Screen.Setup.route) {
            SetupScreen(onConnected = {
                navController.navigate(Screen.Dashboard.route) {
                    popUpTo(Screen.Setup.route) { inclusive = true }
                }
            })
        }
        composable(Screen.Dashboard.route) {
            DashboardScreen(
                onCreateBot = { navController.navigate(Screen.CreateBot.route) },
                onOpenTradeLog = { navController.navigate(Screen.TradeLog.route) },
                onOpenSettings = { navController.navigate(Screen.Settings.route) },
                onOpenCopySignals = { navController.navigate(Screen.CopySignals.route) },
                onOpenSignals = { navController.navigate(Screen.Signals.route) },
                onOpenActivity = { navController.navigate(Screen.Activity.route) },
                onOpenFutures = { navController.navigate(Screen.Futures.route) },
                onOpenBots = { navController.navigate(Screen.Bots.route) }
            )
        }
        composable(Screen.Bots.route) {
            BotsScreen(
                onBack = { navController.popBackStack() },
                onOpenBot = { botId -> navController.navigate(Screen.BotDetail.route(botId)) }
            )
        }
        composable(Screen.Activity.route) {
            ActivityScreen(onBack = { navController.popBackStack() })
        }
        composable(Screen.CopySignals.route) {
            CopySignalsScreen(
                onBack = { navController.popBackStack() },
                // Approving a valid signal stores a Futures prefill, then this
                // navigates to the pre-populated Futures form.
                onOpenFutures = { navController.navigate(Screen.Futures.route) }
            )
        }
        composable(Screen.Signals.route) {
            SignalsScreen(
                onBack = { navController.popBackStack() },
                // The signal's pair + side are persisted before this fires, so the
                // Futures screen picks them up when it loads.
                onTradeSignal = { navController.navigate(Screen.Futures.route) }
            )
        }
        composable(Screen.Futures.route) {
            FuturesScreen(
                onBack = { navController.popBackStack() },
                onOpenHistory = { navController.navigate(Screen.FuturesHistory.route) }
            )
        }
        composable(Screen.FuturesHistory.route) {
            FuturesHistoryScreen(onBack = { navController.popBackStack() })
        }
        composable(
            route = Screen.BotDetail.route,
            arguments = listOf(navArgument("botId") { type = NavType.StringType })
        ) { backStackEntry ->
            val botId = backStackEntry.arguments?.getString("botId").orEmpty()
            BotDetailScreen(botId = botId, onBack = { navController.popBackStack() })
        }
        composable(Screen.CreateBot.route) {
            CreateBotScreen(
                onBack = { navController.popBackStack() },
                onCreated = { navController.popBackStack() }
            )
        }
        composable(Screen.TradeLog.route) {
            TradeLogScreen(onBack = { navController.popBackStack() })
        }
        composable(Screen.Settings.route) {
            SettingsScreen(
                onBack = { navController.popBackStack() },
                onDisconnected = {
                    navController.navigate(Screen.Setup.route) {
                        popUpTo(0) { inclusive = true }
                    }
                }
            )
        }
    }
}
