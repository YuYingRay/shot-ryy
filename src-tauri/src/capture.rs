use std::fs;

use base64::Engine;
use serde::{Deserialize, Serialize};
use image::GenericImageView;
use tauri::{Emitter, Manager};
use uuid::Uuid;

use crate::app::{show_main_window_and_focus, show_main_window_no_focus};
use crate::images::write_temp_png;
use crate::platform;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotCaptureArgs {
  #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
  pub mode: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureRegionUploadArgs {
  pub file_path: String,
  pub x: f64,
  pub y: f64,
  pub w: f64,
  pub h: f64,
  pub dpr: Option<f64>,
  pub intent: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureCancelArgs {
  pub file_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureRegionDataUrlArgs {
  pub data_url: String,
  pub intent: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureRegionUploadResult {
  pub ok: bool,
  pub status: Option<u16>,
  pub response_text: Option<String>,
  pub file_path: Option<String>,
  pub canceled: bool,
  pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotCapturedPayload {
  #[serde(skip_serializing_if = "Option::is_none")]
  pub data_url: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub file_path: Option<String>,
  pub source: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub intent: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotErrorPayload {
  pub error: String,
  pub source: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub kind: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub permission_pane: Option<String>,
}

pub(crate) fn clipboard_png_data_url_after_screencapture(mode: Option<&str>) -> Result<String, String> {
  platform::clipboard_png_data_url_after_screencapture(mode)
}

#[tauri::command]
pub async fn screenshot_capture_to_file(app: tauri::AppHandle, args: ScreenshotCaptureArgs) -> Result<String, String> {
  #[cfg(target_os = "windows")]
  {
    let mode = args.mode.as_deref().unwrap_or("region");
    if mode == "region" {
      // Hide the main window so it doesn't appear in the capture, then run the
      // PowerShell WinForms interactive region selector (same path as the keyboard shortcut).
      if let Some(main) = app.get_webview_window("main") {
        let _ = main.hide();
      }
      let result = tauri::async_runtime::spawn_blocking(platform::capture_interactive_region_to_file)
        .await
        .map_err(|e| format!("Task join failed: {e}"))?;
      show_main_window_and_focus(&app);
      return match result {
        Ok(Some(path)) => Ok(path),
        Ok(None) => Err("Screenshot capture canceled".to_string()),
        Err(e) => Err(e),
      };
    }
    if mode == "instant" {
      return platform::capture_overlay_screenshot_to_file(&app);
    }
    return Err("Only region and instant screenshot modes are supported on Windows".to_string());
  }

  #[cfg(target_os = "macos")]
  {
    let _ = app;
    let mode = args.mode.as_deref();
    return clipboard_png_data_url_after_screencapture(mode);
  }

  #[cfg(target_os = "linux")]
  {
    let mode = args.mode.as_deref().unwrap_or("region");
    if mode != "region" && mode != "instant" && mode != "region-copy" {
      return Err("Only region screenshot mode is supported on Linux".to_string());
    }

    let intent = if mode == "instant" || mode == "region-copy" {
      Some("copyOutput")
    } else {
      None
    };

    open_capture_overlay(&app, intent)?;
    return Ok("overlay-opened".to_string());
  }

  #[cfg(all(not(target_os = "windows"), not(target_os = "macos"), not(target_os = "linux")))]
  {
    let _ = app;
    let _ = args;
    Err("Screenshot capture is only available on macOS and Windows in the native shell".to_string())
  }
}

#[cfg(any(target_os = "windows", target_os = "linux"))]
pub(crate) fn open_capture_overlay(app: &tauri::AppHandle, intent: Option<&str>) -> Result<(), String> {
  // Hide the main app window before opening the fullscreen overlay so
  // monitor screenshots don't just capture the app itself.
  if let Some(main) = app.get_webview_window("main") {
    let _ = main.hide();
  }

  let label = "capture";
  let url = if let Some(intent) = intent {
    tauri::WebviewUrl::App(format!("capture?intent={}", intent).into())
  } else {
    tauri::WebviewUrl::App("capture".into())
  };

  #[derive(Debug, Clone, Serialize)]
  #[serde(rename_all = "camelCase")]
  struct CaptureResetPayload {
    intent: Option<String>,
    file_path: Option<String>,
    nonce: String,
  }

  let win = if let Some(win) = app.get_webview_window(label) {
    // Ensure intent changes (Ctrl+Shift+8 vs Ctrl+Shift+9) are reflected.
    // We also reset the React state via an event so we don't keep the previous selection.
    let _ = win.eval(&match intent {
      Some(v) => format!("window.location.replace('/capture?intent={}');", v),
      None => "window.location.replace('/capture');".to_string(),
    });
    let _ = win.show();
    win
  } else {
    tauri::WebviewWindowBuilder::new(app, label, url)
      .title("Capture")
      .decorations(false)
      .resizable(false)
      .always_on_top(true)
      .skip_taskbar(true)
      .maximized(true)
      .build()
      .map_err(|e| format!("Failed to open capture window: {e}"))?
  };

  // Windows: a maximized borderless window often excludes the taskbar work-area,
  // which causes the screenshot (full monitor) to be scaled/letterboxed.
  // Fullscreen ensures 1:1 alignment with the captured monitor image.
  platform::configure_capture_overlay_window(&win);

  let _ = win.set_ignore_cursor_events(false);
  let _ = win.set_focus();

  let intent_owned = intent.map(|s| s.to_string());
  let nonce = Uuid::new_v4().to_string();

  // ── Windows: show the overlay immediately (crosshair cursor visible right away),
  //    then take the full-monitor screenshot in a background thread and emit a
  //    second capture-reset once the file is ready.  This removes the 2-3 s
  //    PowerShell cold-start penalty that previously blocked the overlay from
  //    appearing at all.  The overlay shows "Loading screenshot…" until the
  //    image arrives; any drag the user starts before it loads is queued and
  //    flushed automatically once the image is ready.
  // ── Linux / other: no pre-capture; JS uses tauri-plugin-screenshots.
  #[cfg(target_os = "windows")]
  {
    // First event: open the overlay with no image yet.
    let _ = win.emit(
      "capture-reset",
      CaptureResetPayload {
        intent: intent_owned.clone(),
        file_path: None,
        nonce: nonce.clone(),
      },
    );

    // Background thread: capture the screenshot, then deliver it via a second
    // capture-reset so the overlay image swaps in without a full page reload.
    let app_clone = app.clone();
    let intent_bg = intent_owned;
    let nonce_bg = nonce;
    tauri::async_runtime::spawn(async move {
      let app2 = app_clone.clone();
      let file_path = tauri::async_runtime::spawn_blocking(move || {
        platform::capture_overlay_screenshot_to_file(&app2).ok()
      })
      .await
      .ok()
      .flatten();

      if let Some(win) = app_clone.get_webview_window("capture") {
        let _ = win.emit(
          "capture-reset",
          CaptureResetPayload {
            intent: intent_bg,
            file_path,
            nonce: nonce_bg,
          },
        );
      }
    });
  }

  #[cfg(not(target_os = "windows"))]
  {
    let _ = win.emit(
      "capture-reset",
      CaptureResetPayload {
        intent: intent_owned,
        file_path: None,
        nonce,
      },
    );
  }

  Ok(())
}

fn close_capture_window(app: &tauri::AppHandle) {
  if let Some(win) = app.get_webview_window("capture") {
    let _ = win.close();
  }
}

fn compute_clamped_crop_rect(
  img_w: u32,
  img_h: u32,
  x: f64,
  y: f64,
  w: f64,
  h: f64,
) -> Option<(u32, u32, u32, u32)> {
  if img_w == 0 || img_h == 0 {
    return None;
  }

  let w = w.round().max(0.0);
  let h = h.round().max(0.0);
  if w < 1.0 || h < 1.0 {
    return None;
  }

  let x = x.round().max(0.0);
  let y = y.round().max(0.0);
  if x >= (img_w as f64) || y >= (img_h as f64) {
    return None;
  }

  let x = x as u32;
  let y = y as u32;

  let crop_w = (w as u32).max(1);
  let crop_h = (h as u32).max(1);

  let max_w = img_w.saturating_sub(x).max(1);
  let max_h = img_h.saturating_sub(y).max(1);

  let crop_w = crop_w.min(max_w);
  let crop_h = crop_h.min(max_h);

  Some((x, y, crop_w, crop_h))
}

fn open_image_with_retry_opts(path: &str, max_attempts: u32, delay_ms: u64) -> Result<image::DynamicImage, String> {
  let mut last_err: Option<String> = None;
  for attempt in 0..max_attempts {
    match fs::read(path) {
      Ok(bytes) => {
        if bytes.len() < 16 {
          last_err = Some(format!("capture file too small ({} bytes)", bytes.len()));
        } else {
          match image::load_from_memory(&bytes) {
            Ok(img) => return Ok(img),
            Err(e) => last_err = Some(format!("{e}")),
          }
        }
      }
      Err(e) => last_err = Some(format!("{e}")),
    }

    if attempt + 1 < max_attempts {
      std::thread::sleep(std::time::Duration::from_millis(delay_ms));
    }
  }

  Err(format!(
    "Failed to open capture after {max_attempts} attempts: {}",
    last_err.unwrap_or_else(|| "unknown error".to_string())
  ))
}

fn open_image_with_retry(path: &str) -> Result<image::DynamicImage, String> {
  // On some platforms the screenshot file may be observed before the writer
  // has flushed the full contents, which can cause decode errors like
  // "... not matching" or "unexpected end of file". A short retry window
  // makes the capture pipeline much more reliable without meaningfully
  // impacting UX.
  open_image_with_retry_opts(path, 25, 40)
}

#[tauri::command]
pub async fn capture_region_upload(app: tauri::AppHandle, args: CaptureRegionUploadArgs) -> Result<CaptureRegionUploadResult, String> {
  let app2 = app.clone();
  let op_id = Uuid::new_v4().to_string();

  // Important reliability property: schedule the capture work off-thread and return quickly.
  // This makes the flow robust even if the capture webview closes immediately after mouse-up.
  tauri::async_runtime::spawn(async move {
    let op_id2 = op_id;
    let _ = tauri::async_runtime::spawn_blocking(move || {
      let started = std::time::Instant::now();
      eprintln!(
        "[capture:{op_id2}] start file={} x={} y={} w={} h={} dpr={:?} intent={:?}",
        args.file_path,
        args.x,
        args.y,
        args.w,
        args.h,
        args.dpr,
        args.intent
      );

      // UX: close the overlay immediately so it never lingers during crop/upload.
      close_capture_window(&app2);
      eprintln!("[capture:{op_id2}] overlay close requested ({}ms)", started.elapsed().as_millis());

      if args.file_path.trim().is_empty() {
        let msg = "Missing capture file path".to_string();
        eprintln!("[capture:{op_id2}] error: {msg}");
        let _ = app2.emit(
          "screenshot-error",
          ScreenshotErrorPayload {
            error: msg.clone(),
            source: Some("region-capture".to_string()),
            kind: None,
            permission_pane: None,
          },
        );
        return Ok::<(), String>(());
      }

      let w = args.w.round().max(0.0);
      let h = args.h.round().max(0.0);
      if w < 2.0 || h < 2.0 {
        eprintln!("[capture:{op_id2}] cancel: selection too small w={} h={} ({}ms)", w, h, started.elapsed().as_millis());
        if !args.file_path.is_empty() {
          let _ = fs::remove_file(&args.file_path);
        }
        return Ok::<(), String>(());
      }

      let img = match open_image_with_retry(&args.file_path) {
        Ok(v) => v,
        Err(e) => {
          let msg = format!("Failed to open capture: {e}");
          eprintln!("[capture:{op_id2}] open_image_with_retry failed: {msg} ({}ms)", started.elapsed().as_millis());
          let _ = app2.emit(
            "screenshot-error",
            ScreenshotErrorPayload {
              error: msg.clone(),
              source: Some("region-capture".to_string()),
              kind: None,
              permission_pane: None,
            },
          );
          let _ = fs::remove_file(&args.file_path);
          return Err(msg);
        }
      };
      let (img_w, img_h) = img.dimensions();
      eprintln!("[capture:{op_id2}] opened image {}x{} ({}ms)", img_w, img_h, started.elapsed().as_millis());

      // Coordinates coming from the overlay are expected to be in the image's native pixel space.
      // Historically some builds passed CSS pixels + a devicePixelRatio. To be robust across both,
      // try native pixels first, then fall back to DPR-scaling if needed.
      let dpr = args.dpr.unwrap_or(1.0).max(0.1);
      let rect_native = compute_clamped_crop_rect(img_w, img_h, args.x, args.y, w, h);
      let rect_scaled = if rect_native.is_none() && (dpr - 1.0).abs() > 0.001 {
        compute_clamped_crop_rect(img_w, img_h, args.x * dpr, args.y * dpr, w * dpr, h * dpr)
      } else {
        None
      };
      let (x, y, crop_w, crop_h) = match rect_native.or(rect_scaled) {
        Some(v) => v,
        None => {
          eprintln!("[capture:{op_id2}] cancel: crop rect invalid (x={} y={} w={} h={} dpr={}) ({}ms)", args.x, args.y, w, h, dpr, started.elapsed().as_millis());
          let _ = fs::remove_file(&args.file_path);
          return Ok::<(), String>(());
        }
      };

      let cropped = image::imageops::crop_imm(&img, x, y, crop_w, crop_h).to_image();
      eprintln!("[capture:{op_id2}] crop rect x={} y={} w={} h={} ({}ms)", x, y, crop_w, crop_h, started.elapsed().as_millis());
      let mut out: Vec<u8> = Vec::new();
      let dyn_img = image::DynamicImage::ImageRgba8(cropped);
      if let Err(e) = dyn_img.write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png) {
        let msg = format!("Failed to encode crop: {e}");
        eprintln!("[capture:{op_id2}] encode failed: {msg} ({}ms)", started.elapsed().as_millis());
        let _ = app2.emit(
          "screenshot-error",
          ScreenshotErrorPayload {
            error: msg.clone(),
            source: Some("region-capture".to_string()),
            kind: None,
            permission_pane: None,
          },
        );
        let _ = fs::remove_file(&args.file_path);
        return Err(msg);
      }

      let out_path = write_temp_png(&out)?;
      eprintln!("[capture:{op_id2}] wrote cropped png {} bytes -> {} ({}ms)", out.len(), out_path.to_string_lossy(), started.elapsed().as_millis());

      let intent = args.intent.clone();
      if let Some(win) = app2.get_webview_window("main") {
        eprintln!("[capture:{op_id2}] emitting screenshot-captured to main ({}ms)", started.elapsed().as_millis());
        if matches!(intent.as_deref(), Some("copyOutput")) {
          show_main_window_no_focus(&app2);
        } else {
          show_main_window_and_focus(&app2);
        }
        let _ = win.emit(
          "screenshot-captured",
          ScreenshotCapturedPayload {
            data_url: None,
            file_path: Some(out_path.to_string_lossy().to_string()),
            source: "region-capture".to_string(),
            intent,
          },
        );
      }

      if app2.get_webview_window("main").is_none() {
        eprintln!("[capture:{op_id2}] WARN: main window not found; no event emitted ({}ms)", started.elapsed().as_millis());
      }

      let _ = fs::remove_file(&args.file_path);
      close_capture_window(&app2);

      eprintln!("[capture:{op_id2}] done ok ({}ms)", started.elapsed().as_millis());
      Ok::<(), String>(())
    })
    .await;
  });

  Ok(CaptureRegionUploadResult {
    ok: true,
    status: None,
    response_text: None,
    file_path: None,
    canceled: false,
    error: None,
  })
}

#[tauri::command]
pub fn capture_cancel(app: tauri::AppHandle, args: CaptureCancelArgs) -> Result<(), String> {
  if let Some(path) = args.file_path {
    if !path.trim().is_empty() {
      let _ = fs::remove_file(path);
    }
  }
  close_capture_window(&app);
  // If user cancels capture, bring the main window back immediately.
  show_main_window_and_focus(&app);
  Ok(())
}

#[tauri::command]
pub async fn capture_region_submit_data_url(
  app: tauri::AppHandle,
  args: CaptureRegionDataUrlArgs,
) -> Result<CaptureRegionUploadResult, String> {
  let s = args.data_url.trim();
  let comma = s.find(',').ok_or_else(|| "Invalid data URL".to_string())?;
  let (meta, payload) = s.split_at(comma);
  let payload = &payload[1..];

  if !meta.starts_with("data:image/") {
    return Err("Expected an image data URL".to_string());
  }

  let bytes = if meta.contains(";base64") {
    base64::engine::general_purpose::STANDARD
      .decode(payload)
      .map_err(|e| format!("Failed to decode base64 image: {e}"))?
  } else {
    payload.as_bytes().to_vec()
  };

  // Validate that the payload is a decodable image before writing it.
  image::load_from_memory(&bytes).map_err(|e| format!("Invalid screenshot image: {e}"))?;

  let out_path = write_temp_png(&bytes)?;
  let out_path_s = out_path.to_string_lossy().to_string();

  if matches!(args.intent.as_deref(), Some("copyOutput")) {
    show_main_window_no_focus(&app);
  } else {
    show_main_window_and_focus(&app);
  }

  if let Some(main_win) = app.get_webview_window("main") {
    let _ = main_win.emit(
      "screenshot-captured",
      ScreenshotCapturedPayload {
        data_url: None,
        file_path: Some(out_path_s.clone()),
        source: "region-capture-js".to_string(),
        intent: args.intent,
      },
    );
  }

  Ok(CaptureRegionUploadResult {
    ok: true,
    status: None,
    response_text: None,
    file_path: Some(out_path_s),
    canceled: false,
    error: None,
  })
}

#[cfg(test)]
mod tests {
  use super::{compute_clamped_crop_rect, open_image_with_retry_opts};
  use image::GenericImageView;
  use std::io::Cursor;

  #[test]
  fn compute_crop_rejects_out_of_bounds_origin() {
    assert_eq!(compute_clamped_crop_rect(100, 100, 100.0, 0.0, 10.0, 10.0), None);
    assert_eq!(compute_clamped_crop_rect(100, 100, 0.0, 100.0, 10.0, 10.0), None);
  }

  #[test]
  fn open_image_with_retry_reads_png() {
    let img = image::DynamicImage::new_rgba8(2, 2);
    let mut bytes: Vec<u8> = Vec::new();
    img
      .write_to(&mut Cursor::new(&mut bytes), image::ImageFormat::Png)
      .expect("encode png");

    let unique = std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .unwrap_or_default()
      .as_nanos();
    let mut p = std::env::temp_dir();
    p.push(format!("shotstyle-open-image-test-{unique}.png"));
    std::fs::write(&p, &bytes).expect("write temp png");

    let loaded = open_image_with_retry_opts(&p.to_string_lossy(), 1, 0).expect("decode png");
    assert_eq!(loaded.dimensions(), (2, 2));

    let _ = std::fs::remove_file(&p);
  }

  #[test]
  fn open_image_with_retry_missing_file_errors_fast() {
    let unique = std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .unwrap_or_default()
      .as_nanos();
    let mut p = std::env::temp_dir();
    p.push(format!("shotstyle-open-image-missing-{unique}.png"));

    let res = open_image_with_retry_opts(&p.to_string_lossy(), 1, 0);
    assert!(res.is_err());
  }

  #[test]
  fn compute_crop_clamps_size_to_image() {
    assert_eq!(compute_clamped_crop_rect(100, 100, 90.0, 95.0, 50.0, 50.0), Some((90, 95, 10, 5)));
  }
}
