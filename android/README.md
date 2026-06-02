# Android — Employee App

Kotlin + Jetpack Compose (Material 3) · MVVM + Clean Architecture.

## Stack

Hilt (DI) · Retrofit/OkHttp/Moshi · Room · CameraX · ML Kit Face Detection ·
Google Maps + FusedLocationProvider · WorkManager · EncryptedSharedPreferences +
Biometric · Firebase Cloud Messaging · Navigation Compose.

## Setup

1. Open `android/` in Android Studio (Koala+).
2. Add your `google-services.json` to `app/` (Firebase) — gitignored.
3. Set the Maps key: replace `YOUR_GOOGLE_MAPS_KEY` in `app/build.gradle.kts`
   (`manifestPlaceholders["MAPS_API_KEY"]`) or move it to `local.properties`.
4. `API_BASE_URL` defaults to `http://10.0.2.2:3001/api/` (emulator → host backend).
5. Run the `app` configuration.

## Structure

```
app/src/main/java/com/hrpayroll/
├── ui/
│   ├── screens/      login, attendance, shift, leave, payslip
│   ├── navigation/   NavHost + routes
│   └── theme/        Material 3 theme
├── data/
│   ├── remote/       Retrofit API + DTOs
│   ├── local/        Room DB, EncryptedSharedPreferences token store
│   └── repository/   repositories
├── di/               Hilt modules (network, database)
├── service/          LocationTrackingService, FCM service
└── utils/            FaceLivenessAnalyzer (ML Kit)
```

## Conventions (see ../CLAUDE.md)

- Screens are `@Composable` in `ui/screens/`; `@HiltViewModel` + `StateFlow` for state.
- ViewModel → UseCase → Repository → API/Room.
- Async in `viewModelScope`.
