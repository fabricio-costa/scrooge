package com.example.app.data.api

import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

/**
 * API service interface for the backend.
 */
interface ApiService {

    @POST("auth/login")
    suspend fun login(@Body request: LoginRequest): LoginResponse

    @POST("auth/register")
    suspend fun register(@Body request: RegisterRequest): RegisterResponse

    @GET("users/{id}")
    suspend fun getUser(@Path("id") userId: String): UserResponse

    @GET("users")
    suspend fun searchUsers(@Query("q") query: String): List<UserResponse>
}
