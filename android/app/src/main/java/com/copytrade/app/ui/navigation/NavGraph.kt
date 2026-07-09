package com.copytrade.app.ui.navigation

import androidx.compose.runtime.Composable
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import androidx.navigation.NavType
import com.copytrade.app.ui.botdetail.BotDetailScreen
import com.copytrade.app.ui.createbot.CreateBotScreen
import com.copytrade.app.ui.dashboard.DashboardScreen
import com.copytrade.app.ui.settings.SettingsScreen
import com.copytrade.app.ui.setup.SetupScreen
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
                onOpenBot = { botId -> navController.navigate(Screen.BotDetail.route(botId)) },
                onCreateBot = { navController.navigate(Screen.CreateBot.route) },
                onOpenTradeLog = { navController.navigate(Screen.TradeLog.route) },
                onOpenSettings = { navController.navigate(Screen.Settings.route) }
            )
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
