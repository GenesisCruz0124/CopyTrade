package com.copytrade.app.ui.components

import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.copytrade.app.ui.strings.Bi
import com.copytrade.app.ui.strings.resolve
import com.copytrade.app.ui.theme.LiveRed
import com.copytrade.app.ui.theme.PaperOrange

/** Huge, unmissable PAPER/LIVE badge — orange for paper, red for live, per the safety requirement. */
@Composable
fun ModeBadge(mode: String, modifier: Modifier = Modifier) {
    val isLive = mode.equals("live", ignoreCase = true)
    val color = if (isLive) LiveRed else PaperOrange
    Surface(
        color = color,
        shape = RoundedCornerShape(8.dp),
        modifier = modifier
    ) {
        Text(
            text = if (isLive) "LIVE" else "PAPER",
            color = Color.White,
            fontSize = 14.sp,
            fontWeight = MaterialTheme.typography.titleMedium.fontWeight,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp)
        )
    }
}

@Composable
fun ConfirmDialog(
    title: Bi,
    message: Bi,
    confirmLabel: Bi,
    cancelLabel: Bi,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title.resolve()) },
        text = { Text(message.resolve()) },
        confirmButton = {
            TextButton(onClick = onConfirm) { Text(confirmLabel.resolve(), color = MaterialTheme.colorScheme.error) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(cancelLabel.resolve()) }
        }
    )
}
