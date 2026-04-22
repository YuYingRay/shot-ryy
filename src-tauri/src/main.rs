#![cfg_attr(
  all(not(debug_assertions), target_os = "windows"),
  windows_subsystem = "windows"
)]

mod app;
mod capture;
mod images;
mod platform;
mod shortcuts;
mod ui_experimentation;

use serde::Serialize;
use serde::Deserialize;
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::Mutex;

use app::{AutoHideState, HasBeenFocusedState, KeepInTrayState, LastInteractionState};
use shortcuts::GlobalShortcutState;
use tauri::Manager;

use app::{
  app_open_feedback_external,
  app_open_feedback_window,
  app_open_screenshot_window_with_payload,
  app_open_settings_window,
  app_set_keep_in_tray_enabled,
  app_set_open_at_login_enabled,
  app_set_hide_dock_icon_when_hidden_enabled,
  app_set_auto_hide_enabled,
  app_hide_main_window,
  app_show_main_window,
  app_window_close,
  app_window_minimize,
  app_window_toggle_maximize,
  open_system_settings,
};
use capture::{capture_cancel, capture_region_submit_data_url, capture_region_upload, screenshot_capture_to_file};
use images::{
  backgrounds_delete_custom,
  backgrounds_list_custom,
  backgrounds_save_custom,
  clipboard_write_image_data_url,
  exports_apply_watermark,
  exports_save_to_downloads,
  exports_save_to_path,
  exports_save_to_folder,
  image_apply_fx_bytes,
  wallpapers_list_system,
  read_file_as_asset,
  read_file_as_data_url,
};
use shortcuts::preferences_update_shortcuts;
#[cfg(target_os = "macos")]
use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};
#[cfg(target_os = "windows")]
use window_vibrancy::{apply_acrylic, apply_blur, apply_mica};

#[derive(Clone, Serialize)]
struct VibrancyDebugInfo {
  supported: bool,
  attempted: bool,
  applied: bool,
  platform: String,
  effect: Option<String>,
  blur: Option<f64>,
  error: Option<String>,
}

struct VibrancyDebugState(Mutex<VibrancyDebugInfo>);

impl Default for VibrancyDebugState {
  fn default() -> Self {
    let supported = cfg!(target_os = "macos") || cfg!(target_os = "windows");
    Self(Mutex::new(VibrancyDebugInfo {
      supported,
      attempted: false,
      applied: false,
      platform: std::env::consts::OS.to_string(),
      effect: None,
      blur: None,
      error: None,
    }))
  }
}

#[cfg(target_os = "macos")]
fn map_macos_material(effect: &str) -> NSVisualEffectMaterial {
  let normalized = effect.trim().to_ascii_lowercase().replace('-', "_");
  match normalized.as_str() {
    "thin" => NSVisualEffectMaterial::UltraDark,
    "ultra_dark" | "ultradark" => NSVisualEffectMaterial::UltraDark,
    "under_window_background" => NSVisualEffectMaterial::UnderWindowBackground,
    "hud" | "hud_window" => NSVisualEffectMaterial::HudWindow,
    "fullscreen_ui" => NSVisualEffectMaterial::FullScreenUI,
    "sidebar" => NSVisualEffectMaterial::Sidebar,
    "window_background" => NSVisualEffectMaterial::WindowBackground,
    "titlebar" => NSVisualEffectMaterial::Titlebar,
    "tooltip" => NSVisualEffectMaterial::Tooltip,
    "content_background" => NSVisualEffectMaterial::ContentBackground,
    "sheet" => NSVisualEffectMaterial::Sheet,
    "menu" => NSVisualEffectMaterial::Menu,
    _ => NSVisualEffectMaterial::UnderWindowBackground,
  }
}

fn apply_main_window_vibrancy(app: &tauri::AppHandle, effect: &str, blur: Option<f64>) -> Result<(String, Option<f64>), String> {
  let Some(win) = app.get_webview_window("main") else {
    return Err("Main window not found".to_string());
  };

  #[cfg(target_os = "macos")]
  {
    let material = map_macos_material(effect);
    apply_vibrancy(&win, material, Some(NSVisualEffectState::Active), blur)
      .map_err(|e| format!("Failed to apply macOS vibrancy: {e}"))?;
    let applied_effect = effect.trim().to_ascii_lowercase().replace('-', "_");
    return Ok((applied_effect, blur));
  }

  #[cfg(target_os = "windows")]
  {
    let normalized = effect.trim().to_ascii_lowercase().replace('-', "_");
    if normalized.contains("mica") {
      apply_mica(&win, None).map_err(|e| format!("Failed to apply Windows mica: {e}"))?;
      return Ok(("mica".to_string(), blur));
    }

    // Dark-gray tint (32, 32, 36) at ~63% opacity gives a clear dark-gray
    // frosted-glass look on both Windows 10 (Acrylic) and Windows 11 (Mica/Acrylic).
    let alpha: u8 = 160;

    // Prefer Acrylic on Windows for a translucent blurred look.
    // Keep explicit "blur" support and fallback to blur if acrylic fails.
    if !normalized.contains("blur") {
      match apply_acrylic(&win, Some((32, 32, 36, alpha))) {
        Ok(_) => return Ok(("acrylic".to_string(), blur)),
        Err(_acrylic_err) => {
          apply_blur(&win, Some((32, 32, 36, alpha)))
            .map_err(|e| format!("Failed to apply Windows acrylic/blur: {e}"))?;
          return Ok(("blur".to_string(), blur));
        }
      }
    }

    apply_blur(&win, Some((32, 32, 36, alpha))).map_err(|e| format!("Failed to apply Windows blur: {e}"))?;
    return Ok(("blur".to_string(), blur));
  }

  #[cfg(not(any(target_os = "macos", target_os = "windows")))]
  {
    let _ = win;
    let _ = effect;
    let _ = blur;
    Err("Native vibrancy is unsupported on this platform".to_string())
  }
}

impl VibrancyDebugState {
  fn update<F: FnOnce(&mut VibrancyDebugInfo)>(&self, f: F) {
    match self.0.lock() {
      Ok(mut guard) => f(&mut guard),
      Err(poisoned) => {
        let mut guard = poisoned.into_inner();
        f(&mut guard);
      }
    }
  }

  fn snapshot(&self) -> VibrancyDebugInfo {
    match self.0.lock() {
      Ok(guard) => guard.clone(),
      Err(poisoned) => poisoned.into_inner().clone(),
    }
  }
}

#[tauri::command]
fn vibrancy_debug_status(state: tauri::State<'_, VibrancyDebugState>) -> VibrancyDebugInfo {
  state.snapshot()
}

#[derive(Clone, Deserialize)]
struct VibrancyDebugApplyArgs {
  effect: String,
  blur: Option<f64>,
}

#[tauri::command]
fn vibrancy_debug_apply(
  app: tauri::AppHandle,
  state: tauri::State<'_, VibrancyDebugState>,
  args: VibrancyDebugApplyArgs,
) -> Result<VibrancyDebugInfo, String> {
  let effect = if args.effect.trim().is_empty() {
    #[cfg(target_os = "macos")]
    {
      "ultra_dark".to_string()
    }
    #[cfg(not(target_os = "macos"))]
    {
      "under_window_background".to_string()
    }
  } else {
    args.effect.clone()
  };
  let blur = args.blur;

  match apply_main_window_vibrancy(&app, &effect, blur) {
    Ok((applied_effect, applied_blur)) => {
      state.update(|info| {
        info.supported = cfg!(target_os = "macos") || cfg!(target_os = "windows");
        info.attempted = true;
        info.applied = true;
        info.effect = Some(applied_effect);
        info.blur = applied_blur;
        info.error = None;
      });
      Ok(state.snapshot())
    }
    Err(err) => {
      state.update(|info| {
        info.supported = cfg!(target_os = "macos") || cfg!(target_os = "windows");
        info.attempted = true;
        info.applied = false;
        info.effect = Some(effect);
        info.blur = blur;
        info.error = Some(err.clone());
      });
      Err(err)
    }
  }
}

#[derive(Clone, Deserialize)]
struct AnnotationPathPoint {
  x: f64,
  y: f64,
}

#[derive(Clone, Deserialize)]
struct AnnotationPenOutlinePathArgs {
  points: Vec<AnnotationPathPoint>,
}

#[derive(Clone, Serialize)]
struct ShadowPreset {
  offset_x: f64,
  offset_y: f64,
  blur: f64,
  spread: f64,
  color: String,
  opacity: f64,
}

#[tauri::command]
fn ui_shadow_hug_preset() -> ShadowPreset {
  ShadowPreset {
    offset_x: 0.0,
    offset_y: 10.0,
    blur: 30.0,
    spread: 0.0,
    color: "#000000".to_string(),
    opacity: 0.5,
  }
}

#[tauri::command]
fn annotation_pen_outline_path(args: AnnotationPenOutlinePathArgs) -> String {
  let points = args.points;
  if points.is_empty() {
    return String::new();
  }

  if points.len() == 1 {
    let p = &points[0];
    return format!("M {:.2},{:.2} L {:.2},{:.2} Z", p.x, p.y, p.x, p.y);
  }

  let mut d = String::new();
  d.push_str(&format!("M {:.2},{:.2} ", points[0].x, points[0].y));

  for i in 0..(points.len() - 1) {
    let a = &points[i];
    let b = &points[i + 1];
    let mid_x = (a.x + b.x) / 2.0;
    let mid_y = (a.y + b.y) / 2.0;
    d.push_str(&format!("Q {:.2},{:.2} {:.2},{:.2} ", a.x, a.y, mid_x, mid_y));
  }

  let last = &points[points.len() - 1];
  d.push_str(&format!("L {:.2},{:.2} Z", last.x, last.y));
  d
}

fn main() {
  tauri::Builder::default()
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_log::Builder::new().build())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_screenshots::init())
    .manage(GlobalShortcutState::default())
    .manage(VibrancyDebugState::default())
    // Default to visible, non-auto-hiding behavior.
    // Default to menu-bar style auto-hide; JS temporarily disables around native dialogs.
    .manage(AutoHideState(AtomicBool::new(false)))
    // Keep app resident in tray by default when main window is closed.
    // On Windows, users expect the close button to quit the app.
    #[cfg(target_os = "windows")]
    .manage(KeepInTrayState(AtomicBool::new(false)))
    #[cfg(not(target_os = "windows"))]
    .manage(KeepInTrayState(AtomicBool::new(true)))
    // Prevent auto-hiding during startup/initialization before the user has ever focused the window.
    .manage(HasBeenFocusedState(AtomicBool::new(false)))
    // Track recent window interactions to avoid hiding during drag/resize.
    .manage(LastInteractionState(AtomicU64::new(0)))
    .invoke_handler(tauri::generate_handler![
      read_file_as_data_url,
      read_file_as_asset,
      backgrounds_save_custom,
      backgrounds_list_custom,
      backgrounds_delete_custom,
      wallpapers_list_system,
      exports_save_to_downloads,
      exports_save_to_path,
      exports_save_to_folder,
      exports_apply_watermark,
      screenshot_capture_to_file,
      capture_region_upload,
      capture_region_submit_data_url,
      capture_cancel,
      image_apply_fx_bytes,
      clipboard_write_image_data_url,
      open_system_settings,
      preferences_update_shortcuts,
      app_set_auto_hide_enabled,
      app_set_keep_in_tray_enabled,
      app_set_open_at_login_enabled,
      app_set_hide_dock_icon_when_hidden_enabled,
      app_open_feedback_window,
      app_open_feedback_external,
      app_open_screenshot_window_with_payload,
      app_open_settings_window,
      app_show_main_window,
      app_hide_main_window,
      app_window_close,
      app_window_minimize,
      app_window_toggle_maximize,
      vibrancy_debug_status,
      vibrancy_debug_apply,
      annotation_pen_outline_path,
      ui_shadow_hug_preset,
    ])
    .setup(|app| {
      app::setup_app(app)?;
      let vibrancy_debug = app.state::<VibrancyDebugState>();
      #[cfg(target_os = "windows")]
      let default_vibrancy_effect = "acrylic";
      #[cfg(target_os = "macos")]
      let default_vibrancy_effect = "ultra_dark";
      #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
      let default_vibrancy_effect = "under_window_background";

      match apply_main_window_vibrancy(&app.handle(), default_vibrancy_effect, Some(32.0)) {
        Ok((effect, blur)) => {
          vibrancy_debug.update(|info| {
            info.supported = cfg!(target_os = "macos") || cfg!(target_os = "windows");
            info.attempted = true;
            info.applied = true;
            info.effect = Some(effect);
            info.blur = blur;
            info.error = None;
          });
        }
        Err(err) => {
          vibrancy_debug.update(|info| {
            info.supported = cfg!(target_os = "macos") || cfg!(target_os = "windows");
            info.attempted = true;
            info.applied = false;
            info.effect = Some(default_vibrancy_effect.to_string());
            info.blur = Some(32.0);
            info.error = Some(err);
          });
        }
      }
      ui_experimentation::install_ui_experimentation_wiring(&app.handle());
      app::setup_tray(app).map_err(|e| Box::<dyn std::error::Error>::from(e))?;
      shortcuts::setup_global_shortcuts(&app.handle()).map_err(|e| Box::<dyn std::error::Error>::from(e))?;
      shortcuts::register_default_shortcuts(&app.handle());
      Ok(())
    })
    .on_window_event(|window, event| {
      app::handle_window_event(window, event);
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
