package com.hrpayroll.ui.screens.attendance

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.OptIn as AndroidOptIn
import androidx.camera.core.CameraSelector
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.border
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.mlkit.vision.common.InputImage
import com.hrpayroll.utils.FaceLivenessAnalyzer
import java.io.File

private val REQUIRED_PERMISSIONS = arrayOf(
    Manifest.permission.CAMERA,
    Manifest.permission.ACCESS_FINE_LOCATION,
)

private fun hasAllPermissions(context: Context) = REQUIRED_PERMISSIONS.all {
    ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED
}

/**
 * Selfie capture: front CameraX preview + ML Kit single-face gate + GPS, then uploads
 * to the backend check-in endpoint via [CheckInViewModel]. Calls [onDone] on success.
 */
@Composable
fun CameraCaptureScreen(
    onDone: () -> Unit,
    onCancel: () -> Unit,
    viewModel: CheckInViewModel = hiltViewModel(),
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val state by viewModel.uiState.collectAsState()

    var hasPermissions by remember { mutableStateOf(hasAllPermissions(context)) }
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { result -> hasPermissions = result.values.all { it } }

    LaunchedEffect(Unit) { if (!hasPermissions) permissionLauncher.launch(REQUIRED_PERMISSIONS) }
    LaunchedEffect(state.success) { if (state.success) onDone() }

    var faceCount by remember { mutableIntStateOf(0) }
    var livenessPassed by remember { mutableStateOf(false) }
    var capturing by remember { mutableStateOf(false) }
    var localError by remember { mutableStateOf<String?>(null) }

    val imageCapture = remember {
        ImageCapture.Builder().setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY).build()
    }
    val previewView = remember {
        PreviewView(context).apply { scaleType = PreviewView.ScaleType.FILL_CENTER }
    }
    val mainExecutor = remember { ContextCompat.getMainExecutor(context) }

    // Bind the camera once permissions are granted.
    LaunchedEffect(hasPermissions) {
        if (!hasPermissions) return@LaunchedEffect
        val future = ProcessCameraProvider.getInstance(context)
        future.addListener({
            val provider = future.get()
            val preview = Preview.Builder().build().also { it.setSurfaceProvider(previewView.surfaceProvider) }
            val analysis = ImageAnalysis.Builder()
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .build()
                .also {
                    it.setAnalyzer(mainExecutor, FaceAnalyzer { n, blinked ->
                        faceCount = n
                        if (blinked && n == 1) livenessPassed = true
                    })
                }
            runCatching {
                provider.unbindAll()
                provider.bindToLifecycle(
                    lifecycleOwner,
                    CameraSelector.DEFAULT_FRONT_CAMERA,
                    preview,
                    imageCapture,
                    analysis,
                )
            }.onFailure { localError = "Camera unavailable: ${it.message}" }
        }, mainExecutor)
    }

    val actionLabel = if (viewModel.isCheckOut) "Check-Out" else "Check-In"

    Box(modifier = Modifier.fillMaxSize().background(Color.Black)) {
        if (hasPermissions) {
            AndroidView(factory = { previewView }, modifier = Modifier.fillMaxSize())

            // Top title
            Text(
                "Selfie $actionLabel",
                color = Color.White,
                fontSize = 18.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.align(Alignment.TopCenter).padding(top = 24.dp),
            )

            // Bottom controls
            Column(
                modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(28.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                val ready = faceCount == 1 && livenessPassed
                val statusText = when {
                    state.isSubmitting -> "Verifying…"
                    capturing -> "Capturing…"
                    faceCount == 0 -> "Position your face in the frame"
                    faceCount > 1 -> "Only one person allowed"
                    !livenessPassed -> "Blink to verify you're live 👁️"
                    else -> "Verified ✓  Tap to ${if (viewModel.isCheckOut) "check out" else "check in"}"
                }
                Text(statusText, color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.Medium)
                Spacer(Modifier.height(16.dp))

                val busy = capturing || state.isSubmitting
                Box(
                    modifier = Modifier
                        .size(76.dp)
                        .border(4.dp, if (ready) Color.White else Color.White.copy(alpha = 0.4f), CircleShape)
                        .padding(6.dp)
                        .background(
                            if (ready && !busy) MaterialTheme.colorScheme.primary else Color.Gray.copy(alpha = 0.6f),
                            CircleShape,
                        ),
                    contentAlignment = Alignment.Center,
                ) {
                    if (busy) {
                        CircularProgressIndicator(color = Color.White, strokeWidth = 2.dp, modifier = Modifier.size(28.dp))
                    } else {
                        Button(
                            onClick = {
                                if (!ready) return@Button
                                capturing = true
                                localError = null
                                captureSelfie(
                                    context, imageCapture, mainExecutor,
                                    onSaved = { file ->
                                        fetchLocation(context) { lat, lng, acc ->
                                            capturing = false
                                            // (0,0) = no GPS fix — submitting would look ~8,600km away.
                                            if (lat == 0.0 && lng == 0.0) {
                                                localError = "Couldn't read your location. Switch ON Location/GPS, wait a few seconds, and try again."
                                            } else {
                                                viewModel.submit(file, lat, lng, acc)
                                            }
                                        }
                                    },
                                    onError = { msg -> capturing = false; localError = msg },
                                )
                            },
                            enabled = ready,
                            modifier = Modifier.fillMaxSize(),
                            shape = CircleShape,
                            contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = Color.Transparent),
                        ) {}
                    }
                }

                (localError ?: state.error)?.let {
                    Spacer(Modifier.height(14.dp))
                    Text(it, color = Color(0xFFFF6B6B), fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                    Spacer(Modifier.height(8.dp))
                    Text("Tap to retry · or go back", color = Color.White.copy(alpha = 0.7f), fontSize = 12.sp)
                }

                Spacer(Modifier.height(16.dp))
                Text(
                    "Cancel",
                    color = Color.White.copy(alpha = 0.8f),
                    fontSize = 14.sp,
                    modifier = Modifier.clickable { onCancel() }.padding(8.dp),
                )
            }
        } else {
            Column(
                modifier = Modifier.fillMaxSize().padding(28.dp),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    "Camera & location permission needed for selfie attendance",
                    color = Color.White,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Medium,
                )
                Spacer(Modifier.height(16.dp))
                Button(onClick = { permissionLauncher.launch(REQUIRED_PERMISSIONS) }) {
                    Text("Grant permissions")
                }
                Spacer(Modifier.height(8.dp))
                Text("Go back", color = Color.White.copy(alpha = 0.8f), modifier = Modifier.clickable { onCancel() }.padding(8.dp))
            }
        }
    }
}

/**
 * ML Kit analyzer: reports face count + a blink event (eyes-open → eyes-closed
 * transition) for a basic anti-photo-spoof liveness check.
 */
private class FaceAnalyzer(val onUpdate: (count: Int, blinked: Boolean) -> Unit) : ImageAnalysis.Analyzer {
    private var eyesWereOpen = false

    @AndroidOptIn(ExperimentalGetImage::class)
    override fun analyze(imageProxy: ImageProxy) {
        val media = imageProxy.image
        if (media == null) {
            imageProxy.close()
            return
        }
        val input = InputImage.fromMediaImage(media, imageProxy.imageInfo.rotationDegrees)
        FaceLivenessAnalyzer.detector.process(input)
            .addOnSuccessListener { faces ->
                var blinked = false
                if (faces.size == 1) {
                    val face = faces[0]
                    val left = face.leftEyeOpenProbability
                    val right = face.rightEyeOpenProbability
                    if (left != null && right != null) {
                        if (left > 0.6f && right > 0.6f) {
                            eyesWereOpen = true
                        } else if (left < 0.3f && right < 0.3f && eyesWereOpen) {
                            blinked = true
                            eyesWereOpen = false
                        }
                    }
                }
                onUpdate(faces.size, blinked)
            }
            .addOnFailureListener { onUpdate(0, false) }
            .addOnCompleteListener { imageProxy.close() }
    }
}

private fun captureSelfie(
    context: Context,
    imageCapture: ImageCapture,
    executor: java.util.concurrent.Executor,
    onSaved: (File) -> Unit,
    onError: (String) -> Unit,
) {
    val file = File(context.cacheDir, "selfie_${System.currentTimeMillis()}.jpg")
    val options = ImageCapture.OutputFileOptions.Builder(file).build()
    imageCapture.takePicture(
        options,
        executor,
        object : ImageCapture.OnImageSavedCallback {
            override fun onImageSaved(output: ImageCapture.OutputFileResults) = onSaved(file)
            override fun onError(exc: ImageCaptureException) = onError("Capture failed: ${exc.message}")
        },
    )
}

@SuppressLint("MissingPermission") // permission is verified before this screen binds the camera
private fun fetchLocation(context: Context, onResult: (Double, Double, Float) -> Unit) {
    val client = LocationServices.getFusedLocationProviderClient(context)
    val cancellation = com.google.android.gms.tasks.CancellationTokenSource()
    client.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, cancellation.token)
        .addOnSuccessListener { loc ->
            if (loc != null) {
                onResult(loc.latitude, loc.longitude, loc.accuracy)
            } else {
                client.lastLocation
                    .addOnSuccessListener { last ->
                        if (last != null) onResult(last.latitude, last.longitude, last.accuracy)
                        else onResult(0.0, 0.0, 0f)
                    }
                    .addOnFailureListener { onResult(0.0, 0.0, 0f) }
            }
        }
        .addOnFailureListener { onResult(0.0, 0.0, 0f) }
}
