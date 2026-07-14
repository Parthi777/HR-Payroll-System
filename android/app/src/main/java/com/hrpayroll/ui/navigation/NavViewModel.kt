package com.hrpayroll.ui.navigation

import androidx.lifecycle.ViewModel
import com.hrpayroll.data.local.TokenStore
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject

/** Exposes the signed-in role to the nav host so the bottom tabs can adapt
 *  (cashier vs manager vs super admin). Read as a function — the role is
 *  written to [TokenStore] at login, after this ViewModel is created. */
@HiltViewModel
class NavViewModel @Inject constructor(
    private val tokenStore: TokenStore,
) : ViewModel() {
    fun role(): String? = tokenStore.getRole()
}
