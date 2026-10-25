package com.hrpayroll.ui.screens.home

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hrpayroll.data.repository.Weather
import com.hrpayroll.ui.components.IconBubble
import com.hrpayroll.ui.components.SectionCard
import com.hrpayroll.ui.theme.BrandGold
import com.hrpayroll.ui.theme.Ink
import com.hrpayroll.ui.theme.MutedText
import com.hrpayroll.ui.theme.StatusLeave

/** Today's weather: now, the day's high and low, and the chance of rain. */
@Composable
fun WeatherCard(weather: Weather, place: String, modifier: Modifier = Modifier) {
    SectionCard(modifier = modifier) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconBubble(weather.icon, if (weather.label == "Clear") BrandGold else StatusLeave)
            Column(modifier = Modifier.weight(1f).padding(start = 14.dp)) {
                Text(weather.label, fontWeight = FontWeight.SemiBold, color = Ink, fontSize = 15.sp)
                Text(place, fontSize = 12.sp, color = MutedText)
            }
            Column(horizontalAlignment = Alignment.End) {
                Text("${weather.tempC}°", fontWeight = FontWeight.Bold, color = Ink, fontSize = 26.sp)
                val range = listOfNotNull(weather.highC?.let { "H $it°" }, weather.lowC?.let { "L $it°" }).joinToString(" · ")
                if (range.isNotEmpty()) Text(range, fontSize = 12.sp, color = MutedText)
                weather.rainPct?.let { Text("Rain $it%", fontSize = 12.sp, color = MutedText) }
            }
        }
    }
}
