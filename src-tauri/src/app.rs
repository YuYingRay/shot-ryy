use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::{Emitter, Manager, WindowEvent};

#[cfg(target_os = "macos")]
use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};
#[cfg(target_os = "windows")]
use window_vibrancy::{apply_acrylic, apply_blur};

use crate::platform;

pub fn now_millis() -> u64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap_or_else(|_| Duration::from_secs(0))
    .as_millis() as u64
}

pub struct AutoHideState(pub AtomicBool);
pub struct KeepInTrayState(pub AtomicBool);
pub struct HasBeenFocusedState(pub AtomicBool);
pub struct LastInteractionState(pub AtomicU64);

fn apply_default_vibrancy_to_window(win: &tauri::WebviewWindow) {
  #[cfg(target_os = "macos")]
  {
    let _ = apply_vibrancy(
      win,
      NSVisualEffectMaterial::UltraDark,
      Some(NSVisualEffectState::Active),
      Some(32.0),
    );
  }

  #[cfg(target_os = "windows")]
  {
    let alpha = 112;
    if apply_acrylic(win, Some((18, 18, 24, alpha))).is_err() {
      let _ = apply_blur(win, Some((18, 18, 24, alpha)));
    }
  }
}

#[derive(serde::Deserialize)]
pub struct SetAutoHideArgs {
  pub enabled: bool,
}

#[derive(serde::Serialize)]
pub struct SetAutoHideResult {
  pub ok: bool,
  pub enabled: bool,
}

#[derive(serde::Deserialize)]
pub struct SetKeepInTrayArgs {
  pub enabled: bool,
}

#[derive(serde::Serialize)]
pub struct SetKeepInTrayResult {
  pub ok: bool,
  pub enabled: bool,
}

#[derive(serde::Deserialize)]
pub struct SetOpenAtLoginArgs {
  pub enabled: bool,
}

#[derive(serde::Serialize)]
pub struct SetOpenAtLoginResult {
  pub ok: bool,
  pub enabled: bool,
}

#[derive(serde::Deserialize)]
pub struct SetHideDockIconArgs {
  pub enabled: bool,
}

#[derive(serde::Serialize)]
pub struct SetHideDockIconResult {
  pub ok: bool,
  pub enabled: bool,
}

#[tauri::command]
pub fn app_show_main_window(app: tauri::AppHandle) -> Result<(), String> {
  let Some(win) = app.get_webview_window("main") else {
    return Err("Main window not found".to_string());
  };
  platform::prepare_main_window_show(&app);
  // Best-effort show + focus.
  let _ = win.show();
  let _ = win.unminimize();
  let _ = win.set_focus();
  platform::post_main_window_focus(&win);
  Ok(())
}

pub fn show_main_window_and_focus(app: &tauri::AppHandle) {
  if let Some(win) = app.get_webview_window("main") {
    platform::prepare_main_window_show(app);
    let _ = win.show();
    let _ = win.unminimize();
    let _ = win.set_focus();
    platform::post_main_window_focus(&win);
  }
}

pub fn show_main_window_no_focus(app: &tauri::AppHandle) {
  // Keep the window alive/visible so the renderer can compose output, but do not steal focus.
  if let Some(win) = app.get_webview_window("main") {
    let was_hidden = win.is_visible().ok() == Some(false);
    // If we're only showing to let the renderer do background work, keep the app out of the Dock.
    // Only do this when the window was previously hidden, so we don't unexpectedly hide the
    // Dock icon while the user is actively using the app.
    if was_hidden {
      platform::prepare_main_window_show(app);
    }
    let _ = win.show();
    let _ = win.unminimize();

    // If we had to show the window just to wake the renderer, hide it again shortly after
    // (but only if it never became focused).
    if was_hidden {
      let win2 = win.clone();
      std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(3500));
        if win2.is_focused().ok() == Some(true) {
          return;
        }
        let _ = win2.hide();
      });
    }
  }
}

#[tauri::command]
pub fn app_window_close(app: tauri::AppHandle) -> Result<(), String> {
  let Some(win) = app.get_webview_window("main") else {
    return Err("Main window not found".to_string());
  };
  win.close().map_err(|e| format!("Failed to close window: {e}"))
}

#[tauri::command]
pub fn app_hide_main_window(app: tauri::AppHandle) -> Result<(), String> {
  let Some(win) = app.get_webview_window("main") else {
    return Err("Main window not found".to_string());
  };
  win.hide().map_err(|e| format!("Failed to hide window: {e}"))
}

#[tauri::command]
pub fn app_window_minimize(app: tauri::AppHandle) -> Result<(), String> {
  let Some(win) = app.get_webview_window("main") else {
    return Err("Main window not found".to_string());
  };
  win.minimize().map_err(|e| format!("Failed to minimize window: {e}"))
}

#[tauri::command]
pub fn app_window_toggle_maximize(app: tauri::AppHandle) -> Result<(), String> {
  let Some(win) = app.get_webview_window("main") else {
    return Err("Main window not found".to_string());
  };
  // Tauri v2 doesn't expose toggle_maximize, so emulate via is_maximized.
  let is_max = win.is_maximized().map_err(|e| format!("Failed to read window state: {e}"))?;
  if is_max {
    win.unmaximize().map_err(|e| format!("Failed to unmaximize: {e}"))
  } else {
    win.maximize().map_err(|e| format!("Failed to maximize: {e}"))
  }
}

#[tauri::command]
pub fn app_open_feedback_window(app: tauri::AppHandle) -> Result<(), String> {
  let label = "feedback";
  if let Some(win) = app.get_webview_window(label) {
    let _ = win.show();
    let _ = win.set_focus();
    return Ok(());
  }

  let url = "https://shotstyle.userjot.com/"
    .parse()
    .map_err(|e| format!("Invalid feedback url: {e}"))?;

  tauri::WebviewWindowBuilder::new(&app, label, tauri::WebviewUrl::External(url))
    .title("Feedback")
    .inner_size(980.0, 740.0)
    .resizable(true)
    .build()
    .map_err(|e| format!("Failed to open feedback window: {e}"))?;

  Ok(())
}

#[tauri::command]
pub fn app_open_settings_window(app: tauri::AppHandle) -> Result<(), String> {
  let label = "settings";
  if let Some(win) = app.get_webview_window(label) {
    let _ = win.show();
    let _ = win.set_focus();
    return Ok(());
  }

  tauri::WebviewWindowBuilder::new(
    &app,
    label,
    tauri::WebviewUrl::App("settings.html".into()),
  )
    .title("Settings")
    .inner_size(720.0, 600.0)
    .resizable(true)
    .build()
    .map_err(|e| format!("Failed to open settings window: {e}"))?;

  Ok(())
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotWindowPayload {
  pub data_url: Option<String>,
  pub file_path: Option<String>,
  pub intent: Option<String>,
  pub source: Option<String>,
  pub spawned_window: Option<bool>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenScreenshotWindowArgs {
  pub payload: Option<ScreenshotWindowPayload>,
}

#[tauri::command]
pub fn app_open_screenshot_window_with_payload(
  app: tauri::AppHandle,
  args: OpenScreenshotWindowArgs,
) -> Result<String, String> {
  let label = format!("main-{}", now_millis());

  let mut builder = tauri::WebviewWindowBuilder::new(
    &app,
    label.clone(),
    tauri::WebviewUrl::App("/".into()),
  )
    .title("shot.style")
    .inner_size(1320.0, 860.0)
    .resizable(true)
    .transparent(true)
    .decorations(false);

  let mut payload_for_init = args.payload.clone();
  if let Some(p) = payload_for_init.as_mut() {
    p.spawned_window = Some(true);
  }

  if let Some(payload) = payload_for_init.as_ref() {
    if let Ok(json) = serde_json::to_string(payload) {
      let init_script = format!(
        "window.__SHOTSTYLE_BOOT_PAYLOAD = {json};"
      );
      builder = builder.initialization_script(&init_script);
    }
  }

  let win = builder
    .build()
    .map_err(|e| format!("Failed to open screenshot window: {e}"))?;

  apply_default_vibrancy_to_window(&win);

  let _ = win.show();
  let _ = win.unminimize();
  let _ = win.set_focus();

  if let Some(mut payload) = args.payload {
    payload.spawned_window = Some(true);
    let app2 = app.clone();
    let label2 = label.clone();
    std::thread::spawn(move || {
      // The renderer can take variable time to hydrate (especially in dev/HMR).
      // A single early emit can be missed, producing a blank spawned window.
      // Retry for a short period so at least one emit lands after listeners attach.
      for _ in 0..16 {
        std::thread::sleep(std::time::Duration::from_millis(150));
        if let Some(w) = app2.get_webview_window(&label2) {
          let _ = w.emit("screenshot-captured", payload.clone());
        }
      }
    });
  }

  Ok(label)
}

#[tauri::command]
pub fn app_open_feedback_external() -> Result<(), String> {
  let url = "https://shotstyle.userjot.com/";

  platform::open_url(url)
}

#[tauri::command]
pub fn app_set_auto_hide_enabled(app: tauri::AppHandle, args: SetAutoHideArgs) -> Result<SetAutoHideResult, String> {
  let state = app.state::<AutoHideState>();
  state.0.store(args.enabled, Ordering::SeqCst);
  Ok(SetAutoHideResult { ok: true, enabled: args.enabled })
}

#[tauri::command]
pub fn app_set_keep_in_tray_enabled(app: tauri::AppHandle, args: SetKeepInTrayArgs) -> Result<SetKeepInTrayResult, String> {
  let state = app.state::<KeepInTrayState>();
  state.0.store(args.enabled, Ordering::SeqCst);
  Ok(SetKeepInTrayResult { ok: true, enabled: args.enabled })
}

#[tauri::command]
pub fn app_set_open_at_login_enabled(_app: tauri::AppHandle, args: SetOpenAtLoginArgs) -> Result<SetOpenAtLoginResult, String> {
  platform::set_open_at_login_enabled(args.enabled)?;
  Ok(SetOpenAtLoginResult { ok: true, enabled: args.enabled })
}

#[tauri::command]
pub fn app_set_hide_dock_icon_when_hidden_enabled(app: tauri::AppHandle, args: SetHideDockIconArgs) -> Result<SetHideDockIconResult, String> {
  platform::set_dock_icon_hidden(args.enabled, &app)?;
  Ok(SetHideDockIconResult { ok: true, enabled: args.enabled })
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct OpenSystemSettingsArgs {
  #[allow(dead_code)]
  pub pane: String,
}

#[tauri::command]
pub async fn open_system_settings(args: OpenSystemSettingsArgs) -> Result<bool, String> {
  platform::open_system_settings(&args.pane).await
}

pub fn setup_app(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
  let handle = app.handle();

  // Ensure panics are captured in the app logs.
  // (This complements JS-side error capture for renderer crashes.)
  std::panic::set_hook(Box::new(|panic_info| {
    log::error!("[panic] {}", panic_info);
  }));

  platform::setup_platform_app(app);
  platform::prewarm_capture_interactive_runtime();

  #[cfg(target_os = "windows")]
  {
    if let Some(win) = handle.get_webview_window("main") {
      let _ = win.set_shadow(false);
    }
  }

  // Show the main window at startup so the renderer initializes immediately.
  // This prevents first-run shortcut flows from racing the webview initialization.
  show_main_window_and_focus(&handle);

  Ok(())
}

pub fn setup_tray(app: &tauri::App) -> Result<(), tauri::Error> {
  #[cfg(desktop)]
  {
    use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
    use tauri::tray::{TrayIconBuilder, TrayIconEvent};

    // Keep the app running in the menu bar (tray) when the window is closed.
    // Provide a small tray menu to reopen or quit.
    let tray_menu = {
      let menu = MenuBuilder::new(app)
        .item(&MenuItemBuilder::with_id("tray-show", "Open shot.style").build(app)?);

      let menu = {
        #[cfg(any(target_os = "windows", target_os = "linux"))]
        {
          menu.item(&MenuItemBuilder::with_id("tray-capture", "Capture region").build(app)?)
        }
        #[cfg(not(any(target_os = "windows", target_os = "linux")))]
        {
          menu
        }
      };

      menu
        .separator()
        .item(&MenuItemBuilder::with_id("tray-quit", "Quit").build(app)?)
        .build()?
    };

    let icon = app
      .default_window_icon()
      .cloned()
      .expect("missing default window icon");

    let _tray = TrayIconBuilder::new()
      .menu(&tray_menu)
      .icon(icon)
      .on_menu_event(|app, event| {
        match event.id().as_ref() {
          "tray-show" => {
            show_main_window_and_focus(&app);
          }
          #[cfg(any(target_os = "windows", target_os = "linux"))]
          "tray-capture" => {
            let app = app.clone();
            std::thread::spawn(move || {
              let _ = crate::capture::open_capture_overlay(&app, None);
            });
          }
          "tray-quit" => {
            app.exit(0);
          }
          _ => {}
        }
      })
      .on_tray_icon_event(|tray, event| {
        if let TrayIconEvent::Click { .. } = event {
          show_main_window_and_focus(&tray.app_handle());
        }
      })
      .build(app)?;
  }

  Ok(())
}

pub fn handle_window_event(window: &tauri::Window, event: &WindowEvent) {
  // Keep running in the tray/menu bar: closing the window hides it instead of quitting.
  if let WindowEvent::CloseRequested { api, .. } = event {
    // Only the main window participates in tray close behavior.
    // Secondary windows (settings/feedback/etc.) should close normally.
    if window.label() != "main" {
      return;
    }

    let keep_in_tray = window
      .app_handle()
      .state::<KeepInTrayState>()
      .0
      .load(Ordering::SeqCst);

    if keep_in_tray {
      let _ = window.hide();
      api.prevent_close();
    }
  }

  // Track recent interactions like move/resize to prevent accidental auto-hide.
  if let WindowEvent::Moved(_) | WindowEvent::Resized(_) = event {
    window
      .app_handle()
      .state::<LastInteractionState>()
      .0
      .store(now_millis(), Ordering::SeqCst);
  }

  // Track whether the window has ever been focused since launch.
  if let WindowEvent::Focused(true) = event {
    window
      .app_handle()
      .state::<HasBeenFocusedState>()
      .0
      .store(true, Ordering::SeqCst);
  }

  // Auto-hide: hide the window whenever it loses focus if enabled.
  if let WindowEvent::Focused(false) = event {
    // Only auto-hide the main window.
    if window.label() != "main" {
      return;
    }

    // Native dialogs (Save/Open panels) can temporarily steal focus from the main window.
    // In that case we should NOT auto-hide, otherwise operations like Export appear broken.
    let enabled = window
      .app_handle()
      .state::<AutoHideState>()
      .0
      .load(Ordering::SeqCst);
    let has_been_focused = window
      .app_handle()
      .state::<HasBeenFocusedState>()
      .0
      .load(Ordering::SeqCst);
    let last_interaction = window
      .app_handle()
      .state::<LastInteractionState>()
      .0
      .load(Ordering::SeqCst);
    let now = now_millis();

    // Ignore initial focus loss during startup/initialization.
    if enabled && has_been_focused {
      // Ignore transient focus losses during move/resize.
      if last_interaction > 0 && now.saturating_sub(last_interaction) < 600 {
        return;
      }

      let app = window.app_handle().clone();
      let label = window.label().to_string();
      std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(200));
        let now2 = now_millis();
        let recent_interaction = app
          .state::<LastInteractionState>()
          .0
          .load(Ordering::SeqCst);
        // Drag/move can transiently drop focus on some platforms while still
        // being an intentional interaction. Re-check right before hide.
        if recent_interaction > 0 && now2.saturating_sub(recent_interaction) < 900 {
          return;
        }
        if let Some(win) = app.get_webview_window(&label) {
          if win.is_focused().ok() == Some(true) {
            return;
          }
          let _ = win.hide();
        }
      });
    }
  }
}
