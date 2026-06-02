# Keep Moshi/Retrofit model classes
-keep class com.hrpayroll.data.remote.dto.** { *; }
-keepclassmembers class * { @com.squareup.moshi.Json *; }

# Hilt
-keep class dagger.hilt.** { *; }
