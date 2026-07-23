import java.util.Properties

// Read dev config (LAN IP for the backend) from local.properties; not committed to git.
val localProps = Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
val apiBaseUrl: String = localProps.getProperty("API_BASE_URL") ?: "http://10.0.2.2:3001/api/"

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.google.dagger.hilt.android")
    id("com.google.devtools.ksp")
    // Re-enable once android/app/google-services.json is added (Firebase Cloud Messaging).
    // id("com.google.gms.google-services")
}

android {
    namespace = "com.hrpayroll"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.hrpayroll"
        minSdk = 24
        targetSdk = 35
        versionCode = 15
        versionName = "0.6.6"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // Injected into BuildConfig — override API_BASE_URL in local.properties (LAN IP for a physical device)
        buildConfigField("String", "API_BASE_URL", "\"$apiBaseUrl\"")
        // Firebase (push) — set in local.properties once the Firebase app exists; blank = push disabled.
        buildConfigField("String", "FIREBASE_APP_ID", "\"${localProps.getProperty("FIREBASE_APP_ID") ?: ""}\"")
        buildConfigField("String", "FIREBASE_API_KEY", "\"${localProps.getProperty("FIREBASE_API_KEY") ?: ""}\"")
        buildConfigField("String", "FIREBASE_PROJECT_ID", "\"${localProps.getProperty("FIREBASE_PROJECT_ID") ?: ""}\"")
        buildConfigField("String", "FIREBASE_SENDER_ID", "\"${localProps.getProperty("FIREBASE_SENDER_ID") ?: ""}\"")
        manifestPlaceholders["MAPS_API_KEY"] = "YOUR_GOOGLE_MAPS_KEY"
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.09.00")
    implementation(composeBom)
    androidTestImplementation(composeBom)

    // Core + Compose
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.exifinterface:exifinterface:1.3.7")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.5")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.5")
    implementation("androidx.activity:activity-compose:1.9.2")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")

    // Navigation Compose
    implementation("androidx.navigation:navigation-compose:2.8.0")

    // Hilt (DI)
    implementation("com.google.dagger:hilt-android:2.52")
    ksp("com.google.dagger:hilt-android-compiler:2.52")
    implementation("androidx.hilt:hilt-navigation-compose:1.2.0")
    implementation("androidx.hilt:hilt-work:1.2.0")
    ksp("androidx.hilt:hilt-compiler:1.2.0")

    // Retrofit + OkHttp
    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    implementation("com.squareup.retrofit2:converter-moshi:2.11.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.squareup.okhttp3:logging-interceptor:4.12.0")
    implementation("com.squareup.moshi:moshi-kotlin:1.15.1")

    // Room
    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.room:room-ktx:2.6.1")
    ksp("androidx.room:room-compiler:2.6.1")

    // CameraX
    implementation("androidx.camera:camera-core:1.3.4")
    implementation("androidx.camera:camera-camera2:1.3.4")
    implementation("androidx.camera:camera-lifecycle:1.3.4")
    implementation("androidx.camera:camera-view:1.3.4")

    // ML Kit — Face Detection (liveness)
    implementation("com.google.mlkit:face-detection:16.1.7")

    // ML Kit — Document Scanner (CamScanner-style capture: edge detect, crop, enhance)
    implementation("com.google.android.gms:play-services-mlkit-document-scanner:16.0.0-beta1")

    // Maps + Location
    implementation("com.google.android.gms:play-services-maps:19.0.0")
    implementation("com.google.android.gms:play-services-location:21.3.0")
    implementation("com.google.maps.android:maps-compose:6.1.0")

    // WorkManager (offline sync + GPS logging)
    implementation("androidx.work:work-runtime-ktx:2.9.1")

    // Security — EncryptedSharedPreferences + Biometric
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    implementation("androidx.biometric:biometric:1.1.0")

    // Firebase Cloud Messaging (push)
    implementation(platform("com.google.firebase:firebase-bom:33.3.0"))
    implementation("com.google.firebase:firebase-messaging-ktx")

    // DataStore
    implementation("androidx.datastore:datastore-preferences:1.1.1")

    // Coil (image loading)
    implementation("io.coil-kt:coil-compose:2.7.0")

    // Testing
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.8.1")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.6.1")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
