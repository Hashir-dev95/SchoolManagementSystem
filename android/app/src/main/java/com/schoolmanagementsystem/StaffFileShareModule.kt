package com.schoolmanagementsystem

import android.content.Intent
import android.util.Base64
import androidx.core.content.FileProvider
import com.facebook.react.bridge.*
import com.facebook.react.ReactPackage
import com.facebook.react.uimanager.ViewManager
import java.io.File
import java.util.UUID

// Only server-authorized bytes cross this bridge. No token, remote URL, public
// storage path or client-chosen filename is passed to another application.
class StaffFileShareModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "StaffFileShare"

  @ReactMethod
  fun open(base64: String, mime: String, promise: Promise) {
    val extension = mapOf("application/pdf" to "pdf", "image/png" to "png", "image/jpeg" to "jpg")[mime]
    if (extension == null || base64.length > 14_000_000) {
      promise.reject("INVALID_FILE", "This file cannot be opened safely."); return
    }
    try {
      val activity = reactApplicationContext.currentActivity
        ?: throw IllegalStateException("Open the school app and retry.")
      val directory = File(reactApplicationContext.cacheDir, "staff-files").apply { mkdirs() }
      directory.listFiles()?.filter { it.lastModified() < System.currentTimeMillis() - 3_600_000 }?.forEach { it.delete() }
      val bytes = Base64.decode(base64, Base64.DEFAULT)
      require(bytes.isNotEmpty() && bytes.size <= 10_000_000)
      val file = File(directory, "document-${UUID.randomUUID()}.$extension")
      file.writeBytes(bytes)
      val uri = FileProvider.getUriForFile(reactApplicationContext, "${reactApplicationContext.packageName}.stafffiles", file)
      val intent = Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime)
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      activity.runOnUiThread {
        try { activity.startActivity(intent); promise.resolve(true) }
        catch (error: Exception) { file.delete(); promise.reject("NO_VIEWER", "Install a viewer for this file type, then retry.") }
      }
    } catch (error: Exception) { promise.reject("FILE_OPEN_FAILED", "Unable to open your private file. Please retry.") }
  }
}

class StaffFileSharePackage : ReactPackage {
  @Suppress("OVERRIDE_DEPRECATION")
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> = listOf(StaffFileShareModule(reactContext))
  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
