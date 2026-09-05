package com.hrpayroll.di

import com.hrpayroll.BuildConfig
import com.hrpayroll.data.local.TokenStore
import com.hrpayroll.data.remote.HrApi
import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.moshi.MoshiConverterFactory
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {

    @Provides
    @Singleton
    fun provideMoshi(): Moshi = Moshi.Builder().add(KotlinJsonAdapterFactory()).build()

    @Provides
    @Singleton
    fun provideOkHttp(tokenStore: TokenStore): OkHttpClient {
        val logging = HttpLoggingInterceptor().apply {
            level = if (BuildConfig.DEBUG) HttpLoggingInterceptor.Level.BODY
            else HttpLoggingInterceptor.Level.NONE
        }
        return OkHttpClient.Builder()
            .addInterceptor { chain ->
                val token = tokenStore.getToken()
                val tenant = tokenStore.getTenantSlug()
                val request = chain.request().newBuilder().apply {
                    if (!token.isNullOrBlank()) addHeader("Authorization", "Bearer $token")
                    // One API host serves every dealer, so the workspace travels
                    // in a header. Omitted when unknown — the backend falls back
                    // to the only workspace where just one exists.
                    if (!tenant.isNullOrBlank()) addHeader("X-Tenant-Slug", tenant)
                }.build()
                chain.proceed(request)
            }
            .addInterceptor(logging)
            // TODO: certificate pinning (see CLAUDE.md Security)
            .build()
    }

    @Provides
    @Singleton
    fun provideRetrofit(client: OkHttpClient, moshi: Moshi): Retrofit =
        Retrofit.Builder()
            .baseUrl(BuildConfig.API_BASE_URL)
            .client(client)
            .addConverterFactory(MoshiConverterFactory.create(moshi))
            .build()

    @Provides
    @Singleton
    fun provideHrApi(retrofit: Retrofit): HrApi = retrofit.create(HrApi::class.java)
}
