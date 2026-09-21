package com.hrpayroll.utils

import android.content.Context
import android.provider.Settings
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext

/**
 * How the app moves.
 *
 * Two rules. Everything is short — a quarter of a second — because this is an
 * app people open twenty times a shift, and motion that charms on the first
 * visit irritates by the fiftieth. And everything stops when the phone asks it
 * to: Android's own "Remove animations" setting is how a person with vestibular
 * trouble, or an old handset, says no, and an app that ignores it is not
 * offering a preference.
 */
object Motion {

    const val DURATION_MS = 250

    /**
     * Whether the phone wants animation at all.
     *
     * `ANIMATOR_DURATION_SCALE` is 0 when "Remove animations" is on in
     * Accessibility, and also when a developer has switched animations off —
     * both mean the same thing here.
     */
    fun enabled(context: Context): Boolean =
        Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) > 0f

    @Composable
    fun rememberEnabled(): Boolean {
        val context = LocalContext.current
        return remember(context) { enabled(context) }
    }

    /** Forward: the new screen comes in from the right, the old one steps aside. */
    fun enter(enabled: Boolean): EnterTransition =
        if (!enabled) EnterTransition.None
        else slideInHorizontally(tween(DURATION_MS)) { full -> full / 6 } + fadeIn(tween(DURATION_MS))

    fun exit(enabled: Boolean): ExitTransition =
        if (!enabled) ExitTransition.None
        else slideOutHorizontally(tween(DURATION_MS)) { full -> -full / 8 } + fadeOut(tween(DURATION_MS))

    /** Back: the same movement, mirrored, so "back" is visibly the way you came. */
    fun popEnter(enabled: Boolean): EnterTransition =
        if (!enabled) EnterTransition.None
        else slideInHorizontally(tween(DURATION_MS)) { full -> -full / 6 } + fadeIn(tween(DURATION_MS))

    fun popExit(enabled: Boolean): ExitTransition =
        if (!enabled) ExitTransition.None
        else slideOutHorizontally(tween(DURATION_MS)) { full -> full / 8 } + fadeOut(tween(DURATION_MS))

    /**
     * For screens that are not part of the left-to-right flow — the camera,
     * and signing in or out. Sliding those looks like a mistake.
     */
    fun fade(enabled: Boolean): EnterTransition =
        if (!enabled) EnterTransition.None else fadeIn(tween(DURATION_MS))

    fun fadeAway(enabled: Boolean): ExitTransition =
        if (!enabled) ExitTransition.None else fadeOut(tween(DURATION_MS))
}
