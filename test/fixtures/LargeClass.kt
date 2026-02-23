package com.example.app.feature.dashboard

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.app.data.model.Category
import com.example.app.data.model.DashboardItem
import com.example.app.data.model.SortOrder
import com.example.app.data.model.UserProfile
import com.example.app.data.repository.DashboardRepository
import com.example.app.data.repository.UserRepository
import com.example.app.domain.analytics.AnalyticsTracker
import com.example.app.domain.session.SessionManager
import com.example.app.util.NetworkMonitor
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import javax.inject.Inject

data class DashboardUiState(
    val items: List<DashboardItem> = emptyList(),
    val categories: List<Category> = emptyList(),
    val selectedCategory: Category? = null,
    val userProfile: UserProfile? = null,
    val isLoading: Boolean = false,
    val isRefreshing: Boolean = false,
    val searchQuery: String = "",
    val sortOrder: SortOrder = SortOrder.DATE_DESC,
    val errorMessage: String? = null,
    val totalItemCount: Int = 0,
    val hasMorePages: Boolean = false,
    val currentPage: Int = 0,
    val isOffline: Boolean = false,
    val lastSyncTimestamp: Instant? = null
)

sealed class DashboardEvent {
    data class ShowSnackbar(val message: String) : DashboardEvent()
    data class NavigateToDetail(val itemId: Long) : DashboardEvent()
    data class NavigateToCategory(val categoryId: String) : DashboardEvent()
    object NavigateToProfile : DashboardEvent()
    object ScrollToTop : DashboardEvent()
}

@HiltViewModel
class DashboardViewModel @Inject constructor(
    private val dashboardRepository: DashboardRepository,
    private val userRepository: UserRepository,
    private val sessionManager: SessionManager,
    private val analyticsTracker: AnalyticsTracker,
    private val networkMonitor: NetworkMonitor,
    private val savedStateHandle: SavedStateHandle
) : ViewModel() {

    companion object {
        private const val KEY_SEARCH_QUERY = "search_query"
        private const val KEY_SELECTED_CATEGORY = "selected_category"
        private const val PAGE_SIZE = 20
        private const val SEARCH_DEBOUNCE_MS = 300L
        private const val REFRESH_THRESHOLD_MS = 5 * 60 * 1000L
    }

    private val _uiState = MutableStateFlow(DashboardUiState())
    val uiState: StateFlow<DashboardUiState> = _uiState.asStateFlow()

    private val _events = MutableSharedFlow<DashboardEvent>()
    val events = _events.asSharedFlow()

    private val _searchQuery = MutableStateFlow(
        savedStateHandle.get<String>(KEY_SEARCH_QUERY) ?: ""
    )

    private val _sortOrder = MutableStateFlow(SortOrder.DATE_DESC)

    private val _selectedCategoryId = MutableStateFlow<String?>(
        savedStateHandle.get<String>(KEY_SELECTED_CATEGORY)
    )

    private var searchJob: Job? = null
    private var loadMoreJob: Job? = null
    private var currentPage = 0

    val filteredItemCount: StateFlow<Int> = _uiState
        .map { it.items.size }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), 0)

    init {
        observeNetworkStatus()
        observeSearchQuery()
        loadInitialData()
        restoreSavedState()
    }

    private fun observeNetworkStatus() {
        networkMonitor.isOnline
            .distinctUntilChanged()
            .onEach { isOnline ->
                _uiState.update { it.copy(isOffline = !isOnline) }
                if (isOnline && shouldAutoRefresh()) {
                    refreshDashboard()
                }
            }
            .launchIn(viewModelScope)
    }

    private fun observeSearchQuery() {
        _searchQuery
            .onEach { query ->
                savedStateHandle[KEY_SEARCH_QUERY] = query
            }
            .launchIn(viewModelScope)
    }

    private fun shouldAutoRefresh(): Boolean {
        val lastSync = _uiState.value.lastSyncTimestamp ?: return true
        val elapsed = Instant.now().toEpochMilli() - lastSync.toEpochMilli()
        return elapsed > REFRESH_THRESHOLD_MS
    }

    private fun restoreSavedState() {
        val savedCategory = savedStateHandle.get<String>(KEY_SELECTED_CATEGORY)
        if (savedCategory != null) {
            _selectedCategoryId.value = savedCategory
        }
    }

    private fun loadInitialData() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, errorMessage = null) }

            try {
                val profile = userRepository.getCurrentUserProfile()
                val categories = dashboardRepository.getCategories()

                _uiState.update { state ->
                    state.copy(
                        userProfile = profile,
                        categories = categories,
                        isLoading = false
                    )
                }

                loadItems(page = 0)
                analyticsTracker.trackScreenView("dashboard")
            } catch (e: Exception) {
                handleError(e, "Failed to load dashboard data")
            }
        }
    }

    private suspend fun loadItems(page: Int) {
        try {
            val categoryId = _selectedCategoryId.value
            val query = _searchQuery.value
            val sort = _sortOrder.value

            val result = dashboardRepository.getItems(
                page = page,
                pageSize = PAGE_SIZE,
                categoryId = categoryId,
                searchQuery = query.takeIf { it.isNotBlank() },
                sortOrder = sort
            )

            _uiState.update { state ->
                val updatedItems = if (page == 0) {
                    result.items
                } else {
                    state.items + result.items
                }

                state.copy(
                    items = updatedItems,
                    totalItemCount = result.totalCount,
                    hasMorePages = result.hasMore,
                    currentPage = page,
                    isLoading = false,
                    isRefreshing = false,
                    errorMessage = null,
                    lastSyncTimestamp = Instant.now()
                )
            }

            currentPage = page
        } catch (e: Exception) {
            handleError(e, "Failed to load items")
        }
    }

    fun refreshDashboard() {
        viewModelScope.launch {
            _uiState.update { it.copy(isRefreshing = true) }

            try {
                val categories = dashboardRepository.getCategories()
                _uiState.update { it.copy(categories = categories) }
                loadItems(page = 0)

                analyticsTracker.trackEvent("dashboard_refreshed")
            } catch (e: Exception) {
                _uiState.update { it.copy(isRefreshing = false) }
                handleError(e, "Failed to refresh dashboard")
            }
        }
    }

    fun onSearchQueryChanged(query: String) {
        _searchQuery.value = query
        _uiState.update { it.copy(searchQuery = query) }

        searchJob?.cancel()
        searchJob = viewModelScope.launch {
            delay(SEARCH_DEBOUNCE_MS)
            _uiState.update { it.copy(isLoading = true) }
            loadItems(page = 0)

            if (query.isNotBlank()) {
                analyticsTracker.trackEvent(
                    "dashboard_search",
                    mapOf("query" to query)
                )
            }
        }
    }

    fun clearSearch() {
        onSearchQueryChanged("")
        viewModelScope.launch {
            _events.emit(DashboardEvent.ScrollToTop)
        }
    }

    fun onCategorySelected(category: Category?) {
        _selectedCategoryId.value = category?.id
        savedStateHandle[KEY_SELECTED_CATEGORY] = category?.id

        _uiState.update { state ->
            state.copy(
                selectedCategory = category,
                isLoading = true
            )
        }

        viewModelScope.launch {
            loadItems(page = 0)

            if (category != null) {
                analyticsTracker.trackEvent(
                    "category_selected",
                    mapOf("category_id" to category.id, "category_name" to category.name)
                )
            }
        }
    }

    fun onSortOrderChanged(sortOrder: SortOrder) {
        _sortOrder.value = sortOrder
        _uiState.update { it.copy(sortOrder = sortOrder, isLoading = true) }

        viewModelScope.launch {
            loadItems(page = 0)
            analyticsTracker.trackEvent(
                "sort_order_changed",
                mapOf("sort_order" to sortOrder.name)
            )
        }
    }

    fun loadNextPage() {
        val state = _uiState.value
        if (!state.hasMorePages || state.isLoading) return

        loadMoreJob?.cancel()
        loadMoreJob = viewModelScope.launch {
            loadItems(page = currentPage + 1)
        }
    }

    fun onItemClicked(item: DashboardItem) {
        viewModelScope.launch {
            analyticsTracker.trackEvent(
                "item_clicked",
                mapOf(
                    "item_id" to item.id.toString(),
                    "item_type" to item.type,
                    "category" to (item.categoryId ?: "none")
                )
            )
            _events.emit(DashboardEvent.NavigateToDetail(item.id))
        }
    }

    fun onItemLongPressed(item: DashboardItem) {
        viewModelScope.launch {
            analyticsTracker.trackEvent(
                "item_long_pressed",
                mapOf("item_id" to item.id.toString())
            )
        }
    }

    suspend fun toggleItemBookmark(item: DashboardItem) {
        try {
            val updated = item.copy(isBookmarked = !item.isBookmarked)
            dashboardRepository.updateItem(updated)

            _uiState.update { state ->
                state.copy(
                    items = state.items.map {
                        if (it.id == item.id) updated else it
                    }
                )
            }

            val action = if (updated.isBookmarked) "bookmarked" else "unbookmarked"
            analyticsTracker.trackEvent(
                "item_$action",
                mapOf("item_id" to item.id.toString())
            )
            _events.emit(
                DashboardEvent.ShowSnackbar(
                    if (updated.isBookmarked) "Item bookmarked" else "Bookmark removed"
                )
            )
        } catch (e: Exception) {
            handleError(e, "Failed to update bookmark")
        }
    }

    suspend fun deleteItem(item: DashboardItem) {
        try {
            dashboardRepository.deleteItem(item.id)

            _uiState.update { state ->
                state.copy(
                    items = state.items.filter { it.id != item.id },
                    totalItemCount = state.totalItemCount - 1
                )
            }

            analyticsTracker.trackEvent(
                "item_deleted",
                mapOf("item_id" to item.id.toString())
            )
            _events.emit(DashboardEvent.ShowSnackbar("Item deleted"))
        } catch (e: Exception) {
            handleError(e, "Failed to delete item")
        }
    }

    suspend fun archiveItem(item: DashboardItem) {
        try {
            val archived = item.copy(isArchived = true)
            dashboardRepository.updateItem(archived)

            _uiState.update { state ->
                state.copy(
                    items = state.items.filter { it.id != item.id },
                    totalItemCount = state.totalItemCount - 1
                )
            }

            analyticsTracker.trackEvent(
                "item_archived",
                mapOf("item_id" to item.id.toString())
            )
            _events.emit(DashboardEvent.ShowSnackbar("Item archived"))
        } catch (e: Exception) {
            handleError(e, "Failed to archive item")
        }
    }

    fun onProfileClicked() {
        viewModelScope.launch {
            analyticsTracker.trackEvent("profile_clicked")
            _events.emit(DashboardEvent.NavigateToProfile)
        }
    }

    fun onCategoryChipClicked(category: Category) {
        viewModelScope.launch {
            _events.emit(DashboardEvent.NavigateToCategory(category.id))
        }
    }

    suspend fun createItem(
        title: String,
        description: String,
        categoryId: String?,
        priority: Int
    ): DashboardItem? {
        return try {
            _uiState.update { it.copy(isLoading = true) }

            val newItem = dashboardRepository.createItem(
                title = title,
                description = description,
                categoryId = categoryId,
                priority = priority
            )

            _uiState.update { state ->
                state.copy(
                    items = listOf(newItem) + state.items,
                    totalItemCount = state.totalItemCount + 1,
                    isLoading = false
                )
            }

            analyticsTracker.trackEvent(
                "item_created",
                mapOf(
                    "category_id" to (categoryId ?: "none"),
                    "priority" to priority.toString()
                )
            )
            _events.emit(DashboardEvent.ShowSnackbar("Item created"))
            _events.emit(DashboardEvent.ScrollToTop)

            newItem
        } catch (e: Exception) {
            handleError(e, "Failed to create item")
            null
        }
    }

    suspend fun updateItemPriority(itemId: Long, newPriority: Int) {
        try {
            val item = _uiState.value.items.find { it.id == itemId } ?: return
            val updated = item.copy(priority = newPriority)
            dashboardRepository.updateItem(updated)

            _uiState.update { state ->
                state.copy(
                    items = state.items.map {
                        if (it.id == itemId) updated else it
                    }
                )
            }

            analyticsTracker.trackEvent(
                "item_priority_changed",
                mapOf("item_id" to itemId.toString(), "priority" to newPriority.toString())
            )
        } catch (e: Exception) {
            handleError(e, "Failed to update priority")
        }
    }

    suspend fun moveItemToCategory(itemId: Long, targetCategoryId: String) {
        try {
            val item = _uiState.value.items.find { it.id == itemId } ?: return
            val updated = item.copy(categoryId = targetCategoryId)
            dashboardRepository.updateItem(updated)

            _uiState.update { state ->
                val selectedCategory = state.selectedCategory
                val newItems = if (selectedCategory != null && selectedCategory.id != targetCategoryId) {
                    state.items.filter { it.id != itemId }
                } else {
                    state.items.map { if (it.id == itemId) updated else it }
                }

                state.copy(items = newItems)
            }

            analyticsTracker.trackEvent(
                "item_moved",
                mapOf("item_id" to itemId.toString(), "target_category" to targetCategoryId)
            )
            _events.emit(DashboardEvent.ShowSnackbar("Item moved"))
        } catch (e: Exception) {
            handleError(e, "Failed to move item")
        }
    }

    fun getItemsByDate(date: LocalDate): List<DashboardItem> {
        return _uiState.value.items.filter { item ->
            item.createdAt.toLocalDate() == date
        }
    }

    fun getBookmarkedItems(): List<DashboardItem> {
        return _uiState.value.items.filter { it.isBookmarked }
    }

    fun getItemCountByCategory(): Map<String, Int> {
        return _uiState.value.items
            .groupBy { it.categoryId ?: "uncategorized" }
            .mapValues { it.value.size }
    }

    fun getHighPriorityItems(): List<DashboardItem> {
        return _uiState.value.items
            .filter { it.priority >= 3 }
            .sortedByDescending { it.priority }
    }

    suspend fun syncWithRemote() {
        if (_uiState.value.isOffline) {
            _events.emit(DashboardEvent.ShowSnackbar("Cannot sync while offline"))
            return
        }

        try {
            _uiState.update { it.copy(isRefreshing = true) }

            dashboardRepository.syncPendingChanges()
            loadItems(page = 0)

            analyticsTracker.trackEvent("dashboard_synced")
            _events.emit(DashboardEvent.ShowSnackbar("Sync complete"))
        } catch (e: Exception) {
            handleError(e, "Sync failed")
        }
    }

    suspend fun exportDashboardData(): String {
        return try {
            val items = _uiState.value.items
            val categories = _uiState.value.categories
            dashboardRepository.exportToJson(items, categories)
        } catch (e: Exception) {
            handleError(e, "Failed to export data")
            "{}"
        }
    }

    private fun handleError(exception: Exception, fallbackMessage: String) {
        val message = when (exception) {
            is java.net.UnknownHostException -> "No internet connection"
            is java.net.SocketTimeoutException -> "Request timed out"
            is retrofit2.HttpException -> {
                when (exception.code()) {
                    401 -> "Session expired. Please sign in again."
                    403 -> "You do not have permission for this action."
                    404 -> "The requested resource was not found."
                    429 -> "Too many requests. Please try again later."
                    in 500..599 -> "Server error. Please try again later."
                    else -> fallbackMessage
                }
            }
            else -> fallbackMessage
        }

        _uiState.update { state ->
            state.copy(
                isLoading = false,
                isRefreshing = false,
                errorMessage = message
            )
        }

        viewModelScope.launch {
            _events.emit(DashboardEvent.ShowSnackbar(message))
            analyticsTracker.trackEvent(
                "error",
                mapOf(
                    "message" to message,
                    "exception" to (exception.message ?: "unknown")
                )
            )
        }
    }

    fun dismissError() {
        _uiState.update { it.copy(errorMessage = null) }
    }

    fun isItemOwnedByCurrentUser(item: DashboardItem): Boolean {
        val currentUserId = _uiState.value.userProfile?.id ?: return false
        return item.ownerId == currentUserId
    }

    suspend fun logout() {
        try {
            analyticsTracker.trackEvent("user_logout")
            sessionManager.clearSession()
            userRepository.clearLocalData()
        } catch (e: Exception) {
            handleError(e, "Failed to sign out")
        }
    }

    override fun onCleared() {
        super.onCleared()
        searchJob?.cancel()
        loadMoreJob?.cancel()
    }
}
