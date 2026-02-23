package com.example.app.ui.login

import androidx.lifecycle.ViewModel
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject

/**
 * ViewModel for the login screen.
 * Handles authentication logic and UI state management.
 */
@HiltViewModel
class LoginViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val tokenManager: TokenManager
) : ViewModel() {

    private val _uiState = MutableStateFlow<LoginUiState>(LoginUiState.Idle)
    val uiState: StateFlow<LoginUiState> = _uiState.asStateFlow()

    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    /**
     * Authenticate user with email and password.
     * @param email User email
     * @param password User password
     */
    suspend fun authenticate(email: String, password: String): Boolean {
        _isLoading.value = true
        return try {
            val result = authRepository.login(email, password)
            if (result.isSuccess) {
                tokenManager.saveToken(result.getOrThrow().token)
                _uiState.value = LoginUiState.Success
                true
            } else {
                _uiState.value = LoginUiState.Error(result.exceptionOrNull()?.message ?: "Unknown error")
                false
            }
        } catch (e: Exception) {
            _uiState.value = LoginUiState.Error(e.message ?: "Unknown error")
            false
        } finally {
            _isLoading.value = false
        }
    }

    /**
     * Validate email format.
     */
    fun validateEmail(email: String): Boolean {
        return email.contains("@") && email.contains(".")
    }

    fun resetState() {
        _uiState.value = LoginUiState.Idle
    }
}

sealed class LoginUiState {
    object Idle : LoginUiState()
    object Success : LoginUiState()
    data class Error(val message: String) : LoginUiState()
}
