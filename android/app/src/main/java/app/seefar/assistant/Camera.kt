package app.seefar.assistant

import android.graphics.Bitmap
import android.graphics.Matrix
import android.util.Base64
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors

/** Keeps the newest camera frame (small JPEG, base64) ready to send with the next question. */
class FrameGrabber {
    @Volatile var latest: String? = null
    @Volatile private var last = 0L

    val analyzer = ImageAnalysis.Analyzer { img ->
        try {
            val now = System.currentTimeMillis()
            if (now - last > 800) {
                last = now
                var bmp = img.toBitmap()
                val rot = img.imageInfo.rotationDegrees
                if (rot != 0) {
                    bmp = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, Matrix().apply { postRotate(rot.toFloat()) }, true)
                }
                val scale = 768f / maxOf(bmp.width, bmp.height)
                if (scale < 1f) bmp = Bitmap.createScaledBitmap(bmp, (bmp.width * scale).toInt(), (bmp.height * scale).toInt(), true)
                val out = ByteArrayOutputStream()
                bmp.compress(Bitmap.CompressFormat.JPEG, 72, out)
                latest = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
            }
        } catch (_: Exception) {
        } finally {
            img.close()
        }
    }

    fun clear() { latest = null }
}

@Composable
fun CameraView(grabber: FrameGrabber, front: Boolean, modifier: Modifier = Modifier) {
    val owner = LocalLifecycleOwner.current
    key(front) {
        AndroidView(
            modifier = modifier,
            factory = { c ->
                val pv = PreviewView(c).apply { scaleType = PreviewView.ScaleType.FILL_CENTER }
                val future = ProcessCameraProvider.getInstance(c)
                future.addListener({
                    try {
                        val provider = future.get()
                        val preview = Preview.Builder().build().also { it.setSurfaceProvider(pv.surfaceProvider) }
                        val analysis = ImageAnalysis.Builder()
                            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                            .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
                            .build().also { it.setAnalyzer(Executors.newSingleThreadExecutor(), grabber.analyzer) }
                        provider.unbindAll()
                        provider.bindToLifecycle(
                            owner,
                            if (front) CameraSelector.DEFAULT_FRONT_CAMERA else CameraSelector.DEFAULT_BACK_CAMERA,
                            preview, analysis
                        )
                    } catch (_: Exception) {
                    }
                }, ContextCompat.getMainExecutor(c))
                pv
            },
            onRelease = {
                try { ProcessCameraProvider.getInstance(it.context).get().unbindAll() } catch (_: Exception) {}
            }
        )
    }
}
