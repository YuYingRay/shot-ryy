use std::str::FromStr;
use std::sync::Mutex;
#[cfg(target_os = "windows")]
use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

#[cfg(desktop)]
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use crate::capture::ScreenshotErrorPayload;
use crate::platform;

#[cfg(target_os = "linux")]
use crate::capture::open_capture_overlay;

#[cfg(target_os = "macos")]
use crate::app::{show_main_window_and_focus, show_main_window_no_focus};
#[cfg(any(target_os = "macos", target_os = "windows"))]
use crate::capture::ScreenshotCapturedPayload;
#[cfg(target_os = "windows")]
use crate::app::{show_main_window_and_focus, show_main_window_no_focus};

#[cfg(target_os = "windows")]
static WINDOWS_REGION_CAPTURE_IN_FLIGHT: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Default, Clone)]
struct GlobalShortcutConfig {
  region_accel: Option<String>,
  region_id: Option<u32>,
  instant_accel: Option<String>,
  instant_id: Option<u32>,
  window_accel: Option<String>,
  window_id: Option<u32>,
}

pub struct GlobalShortcutState(Mutex<GlobalShortcutConfig>);

impl Default for GlobalShortcutState {
  fn default() -> Self {
    Self(Mutex::new(GlobalShortcutConfig::default()))
  }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateShortcutsArgs {
  pub region_shortcut: Option<String>,
  pub instant_shortcut: Option<String>,
  pub window_shortcut: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutRegisterStatus {
  pub ok: bool,
  pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateShortcutsResult {
  pub ok: bool,
  pub region: ShortcutRegisterStatus,
  pub instant: ShortcutRegisterStatus,
  pub window: ShortcutRegisterStatus,
}

fn should_keep_unfocused(intent: Option<&str>) -> bool {
  matches!(intent, Some("copyOutput"))
}

fn pref_combo_to_parsed_shortcut(combo: &str, is_macos: bool) -> Option<(String, tauri_plugin_global_shortcut::Shortcut)> {
  let raw = combo.trim();
  if raw.is_empty() {
    return None;
  }

  let parts: Vec<&str> = raw
    .split('+')
    .map(|p| p.trim())
    .filter(|p| !p.is_empty())
    .collect();
  if parts.is_empty() {
    return None;
  }

  let mut has_meta = false;
  let mut has_ctrl = false;
  let mut has_alt = false;
  let mut has_shift = false;
  let mut key: Option<String> = None;

  for part in parts {
    match part {
      "Meta" => has_meta = true,
      "Ctrl" | "Control" => has_ctrl = true,
      "Alt" => has_alt = true,
      "Shift" => has_shift = true,
      _ => {
        if key.is_none() {
          key = Some(match part {
            "Space" => "Space".to_string(),
            "Esc" | "Escape" => "Esc".to_string(),
            other => other.to_string(),
          });
        }
      }
    }
  }

  let key = key?;

  // Candidate modifier spellings. The global shortcut parser has historically accepted
  // a few variants; we try a short prioritized list to be resilient.
  let cmd_variants: &[&str] = if is_macos {
    &["Cmd", "Command", "Meta"]
  } else {
    &["Ctrl", "Control", "CmdOrCtrl", "CommandOrControl"]
  };
  let ctrl_variants: &[&str] = &["Ctrl", "Control"];
  let alt_variants: &[&str] = if is_macos { &["Alt", "Option"] } else { &["Alt"] };
  let shift_variants: &[&str] = &["Shift"];

  let key_variants: Vec<String> = {
    let mut v = Vec::new();
    v.push(key.clone());
    v.push(key.to_uppercase());
    v.push(key.to_lowercase());
    v.into_iter().filter(|s| !s.is_empty()).collect()
  };

  // Build a small, ordered set of full accelerator candidates.
  let mut candidates: Vec<String> = Vec::new();
  for k in key_variants {
    // Preferred form.
    {
      let mut parts: Vec<&str> = Vec::new();
      if has_meta {
        parts.push(cmd_variants[0]);
      }
      if has_ctrl {
        parts.push(ctrl_variants[0]);
      }
      if has_alt {
        parts.push(alt_variants[0]);
      }
      if has_shift {
        parts.push(shift_variants[0]);
      }
      candidates.push(format!("{}+{}", parts.join("+"), k));
    }

    // Cmd/Command variants (mac) or CmdOrCtrl variants (win/linux) when Meta is present.
    if has_meta {
      for &cmd in cmd_variants.iter().take(3) {
        let mut parts: Vec<&str> = Vec::new();
        parts.push(cmd);
        if has_ctrl {
          parts.push(ctrl_variants[0]);
        }
        if has_alt {
          parts.push(alt_variants[0]);
        }
        if has_shift {
          parts.push(shift_variants[0]);
        }
        candidates.push(format!("{}+{}", parts.join("+"), k));
      }
    }
  }

  // De-dupe while preserving order.
  candidates.dedup();

  for accel in candidates {
    if let Ok(hk) = tauri_plugin_global_shortcut::Shortcut::from_str(accel.as_str()) {
      return Some((accel, hk));
    }
  }

  None
}

fn is_macos_reserved_screenshot_combo(accel: &str) -> bool {
  // macOS screenshot system shortcuts we should never hijack.
  // Cmd+Shift+5 opens the system screenshot toolbar.
  // Cmd+Shift+6 captures the Touch Bar (on devices that have one, or generic save if not).
  // We avoid hijacking these to allow the system (or our local handlers when focused) to manage them.
  matches!(accel, "Cmd+Shift+3" | "Cmd+Shift+4" | "Cmd+Shift+5" | "Cmd+Shift+6")
}

#[tauri::command]
pub async fn preferences_update_shortcuts(app: tauri::AppHandle, args: UpdateShortcutsArgs) -> Result<UpdateShortcutsResult, String> {
  #[cfg(desktop)]
  {
    eprintln!("[shortcuts] preferences_update_shortcuts called: region={:?} instant={:?} window={:?}", args.region_shortcut, args.instant_shortcut, args.window_shortcut);

    let is_macos = cfg!(target_os = "macos");

    let region = args
      .region_shortcut
      .as_deref()
      .and_then(|s| pref_combo_to_parsed_shortcut(s, is_macos));
    let instant = args
      .instant_shortcut
      .as_deref()
      .and_then(|s| pref_combo_to_parsed_shortcut(s, is_macos));
    let window = args
      .window_shortcut
      .as_deref()
      .and_then(|s| pref_combo_to_parsed_shortcut(s, is_macos));

    eprintln!(
      "[shortcuts] normalized to hotkeys: region={:?} instant={:?} window={:?}",
      region.as_ref().map(|x| x.0.clone()),
      instant.as_ref().map(|x| x.0.clone()),
      window.as_ref().map(|x| x.0.clone())
    );

    let global = app.global_shortcut();

    // Serialize shortcut updates to avoid interleaving calls that can cause
    // duplicate registrations and Carbon's RegisterEventHotKey failures.
    let shortcut_state = app.state::<GlobalShortcutState>();
    let mut cfg_guard = shortcut_state
      .0
      .lock()
      .map_err(|_| "Failed to lock shortcut state".to_string())?;

    // If nothing changed, avoid churn.
    {
      let cur_r = cfg_guard.region_accel.as_deref();
      let cur_i = cfg_guard.instant_accel.as_deref();
      let cur_w = cfg_guard.window_accel.as_deref();
      let next_r = region.as_ref().map(|x| x.0.as_str());
      let next_i = instant.as_ref().map(|x| x.0.as_str());
      let next_w = window.as_ref().map(|x| x.0.as_str());
      if cur_r == next_r && cur_i == next_i && cur_w == next_w {
        return Ok(UpdateShortcutsResult {
          ok: true,
          region: ShortcutRegisterStatus { ok: true, error: None },
          instant: ShortcutRegisterStatus { ok: true, error: None },
          window: ShortcutRegisterStatus { ok: true, error: None },
        });
      }
    }

    let prev_cfg = cfg_guard.clone();

    // Unregister previous shortcuts we owned.
    for prev in [
      cfg_guard.region_accel.clone(),
      cfg_guard.instant_accel.clone(),
      cfg_guard.window_accel.clone(),
    ] {
      if let Some(s) = prev {
        let _ = global.unregister(s.as_str());
      }
    }
    *cfg_guard = GlobalShortcutConfig::default();

    let mut region_status = ShortcutRegisterStatus { ok: true, error: None };
    let mut instant_status = ShortcutRegisterStatus { ok: true, error: None };
    let mut window_status = ShortcutRegisterStatus { ok: true, error: None };

    let mut next_cfg = GlobalShortcutConfig::default();

    if args.region_shortcut.as_deref().unwrap_or("").trim().is_empty() == false && region.is_none() {
      region_status = ShortcutRegisterStatus { ok: false, error: Some("Invalid shortcut format".to_string()) };
    }
    if args.instant_shortcut.as_deref().unwrap_or("").trim().is_empty() == false && instant.is_none() {
      instant_status = ShortcutRegisterStatus { ok: false, error: Some("Invalid shortcut format".to_string()) };
    }
    if args.window_shortcut.as_deref().unwrap_or("").trim().is_empty() == false && window.is_none() {
      window_status = ShortcutRegisterStatus { ok: false, error: Some("Invalid shortcut format".to_string()) };
    }

    if let Some((accel, hk)) = region.clone() {
      if is_macos && is_macos_reserved_screenshot_combo(accel.as_str()) {
        region_status = ShortcutRegisterStatus { ok: false, error: Some("Reserved by macOS screenshot shortcuts".to_string()) };
      } else {
        match global.register(accel.as_str()) {
          Ok(_) => {
            next_cfg.region_accel = Some(accel.clone());
            next_cfg.region_id = Some(hk.id());
          }
          Err(e) => {
            eprintln!("[shortcuts] failed to register region shortcut {}: {}", accel, e);
            region_status = ShortcutRegisterStatus { ok: false, error: Some(format!("{e}")) };
          }
        }
      }
    }
    if let Some((accel, hk)) = instant.clone() {
      if is_macos && is_macos_reserved_screenshot_combo(accel.as_str()) {
        instant_status = ShortcutRegisterStatus { ok: false, error: Some("Reserved by macOS screenshot shortcuts".to_string()) };
      } else {
        match global.register(accel.as_str()) {
          Ok(_) => {
            next_cfg.instant_accel = Some(accel.clone());
            next_cfg.instant_id = Some(hk.id());
          }
          Err(e) => {
            eprintln!("[shortcuts] failed to register instant shortcut {}: {}", accel, e);
            instant_status = ShortcutRegisterStatus { ok: false, error: Some(format!("{e}")) };
          }
        }
      }
    }
    if let Some((accel, hk)) = window.clone() {
      if is_macos && is_macos_reserved_screenshot_combo(accel.as_str()) {
        window_status = ShortcutRegisterStatus { ok: false, error: Some("Reserved by macOS screenshot shortcuts".to_string()) };
      } else {
        match global.register(accel.as_str()) {
          Ok(_) => {
            next_cfg.window_accel = Some(accel.clone());
            next_cfg.window_id = Some(hk.id());
          }
          Err(e) => {
            eprintln!("[shortcuts] failed to register window shortcut {}: {}", accel, e);
            window_status = ShortcutRegisterStatus { ok: false, error: Some(format!("{e}")) };
          }
        }
      }
    }

    let mut all_ok = region_status.ok && instant_status.ok && window_status.ok;

    // If any new registration failed, restore previous working shortcuts for failed slots
    // so users don't end up with no active shortcut after rebinding.
    if !all_ok {
      if !region_status.ok {
        if let Some(prev) = prev_cfg.region_accel.as_deref() {
          if global.register(prev).is_ok() {
            next_cfg.region_accel = Some(prev.to_string());
            next_cfg.region_id = prev_cfg.region_id;
          }
        }
      }
      if !instant_status.ok {
        if let Some(prev) = prev_cfg.instant_accel.as_deref() {
          if global.register(prev).is_ok() {
            next_cfg.instant_accel = Some(prev.to_string());
            next_cfg.instant_id = prev_cfg.instant_id;
          }
        }
      }
      if !window_status.ok {
        if let Some(prev) = prev_cfg.window_accel.as_deref() {
          if global.register(prev).is_ok() {
            next_cfg.window_accel = Some(prev.to_string());
            next_cfg.window_id = prev_cfg.window_id;
          }
        }
      }

      all_ok = region_status.ok && instant_status.ok && window_status.ok;
    }

    *cfg_guard = next_cfg;

    return Ok(UpdateShortcutsResult {
      ok: all_ok,
      region: region_status,
      instant: instant_status,
      window: window_status,
    });
  }

  #[cfg(not(desktop))]
  {
    Ok(UpdateShortcutsResult {
      ok: false,
      region: ShortcutRegisterStatus { ok: false, error: Some("Global shortcuts are not supported on this platform".to_string()) },
      instant: ShortcutRegisterStatus { ok: false, error: Some("Global shortcuts are not supported on this platform".to_string()) },
      window: ShortcutRegisterStatus { ok: false, error: Some("Global shortcuts are not supported on this platform".to_string()) },
    })
  }
}

#[cfg(desktop)]
pub fn setup_global_shortcuts(handle: &tauri::AppHandle) -> Result<(), tauri::Error> {
  // Register the global shortcut plugin, and route shortcut presses to the renderer
  // by emitting the same events the UI expects.
  handle.plugin(
    tauri_plugin_global_shortcut::Builder::new()
      .with_handler(|app, shortcut, event| {
        if event.state != ShortcutState::Pressed {
          return;
        }

        eprintln!("[shortcuts] pressed id={} shortcut={:?}", shortcut.id, shortcut);

        let mode: Option<&'static str> = app
          .state::<GlobalShortcutState>()
          .0
          .lock()
          .ok()
          .and_then(|cfg| {
            if cfg.region_id == Some(shortcut.id) {
              Some("region")
            } else if cfg.instant_id == Some(shortcut.id) {
              // Reused slot: Cmd+Shift+7 triggers region screenshot + auto-copy in the renderer.
              Some("region-copy")
            } else if cfg.window_id == Some(shortcut.id) {
              Some("window")
            } else {
              None
            }
          });

        let Some(mode) = mode else { return; };

        eprintln!("[shortcuts] resolved mode={}", mode);

        let app = app.clone();
        std::thread::spawn(move || {
          #[cfg(target_os = "macos")]
          {
            let (capture_mode, intent) = if mode == "region-copy" {
              ("region", Some("copyOutput".to_string()))
            } else {
              (mode, None)
            };

            match platform::clipboard_png_data_url_after_screencapture(Some(capture_mode)) {
              Ok(out) => {
                eprintln!("[shortcuts] capture ok (mode={})", capture_mode);
                if should_keep_unfocused(intent.as_deref()) {
                  show_main_window_no_focus(&app);
                } else {
                  show_main_window_and_focus(&app);
                }

                // `clipboard_png_data_url_after_screencapture` historically returned a data URL.
                // Newer builds return a temp file path for reliability. Support both.
                let out_s = out.trim();
                let (data_url, file_path) = if out_s.starts_with("data:") {
                  (Some(out_s.to_string()), None)
                } else {
                  (None, Some(out_s.to_string()))
                };

                eprintln!(
                  "[shortcuts] emitting screenshot-captured (intent={:?}, kind={}, bytes={}, file_path={:?})",
                  intent,
                  if file_path.is_some() { "file" } else { "data" },
                  data_url.as_ref().map(|s| s.len()).unwrap_or(0),
                  file_path
                );
                if let Some(main_win) = app.get_webview_window("main") {
                  let _ = main_win.emit(
                    "screenshot-captured",
                    ScreenshotCapturedPayload {
                      data_url,
                      file_path,
                      source: "global-shortcut".to_string(),
                      intent,
                    },
                  );
                }
              }
              Err(err) => {
                eprintln!("[shortcuts] capture error: {}", err);
                let is_screen_perm = {
                  let e = err.to_lowercase();
                  e.contains("screen recording")
                    || e.contains("screen capture")
                    || e.contains("privacy_screencapture")
                    || e.contains("permission") && e.contains("den")
                };

                let _ = app.emit(
                  "screenshot-error",
                  ScreenshotErrorPayload {
                    error: err,
                    source: Some("global-shortcut".to_string()),
                    kind: if is_screen_perm { Some("permission-screen-recording".to_string()) } else { None },
                    permission_pane: if is_screen_perm { Some("screen-recording".to_string()) } else { None },
                  },
                );
              }
            }
          }

          #[cfg(target_os = "windows")]
          {
            if mode != "region" && mode != "region-copy" {
              let _ = app.emit(
                "screenshot-error",
                ScreenshotErrorPayload {
                  error: "Only region capture is supported.".to_string(),
                  source: Some("global-shortcut".to_string()),
                  kind: None,
                  permission_pane: None,
                },
              );
              return;
            }

            // Prevent stacked native region overlays when users press the shortcut repeatedly.
            if WINDOWS_REGION_CAPTURE_IN_FLIGHT
              .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
              .is_err()
            {
              return;
            }

            struct WindowsCaptureInFlightGuard;
            impl Drop for WindowsCaptureInFlightGuard {
              fn drop(&mut self) {
                WINDOWS_REGION_CAPTURE_IN_FLIGHT.store(false, Ordering::SeqCst);
              }
            }
            let _capture_guard = WindowsCaptureInFlightGuard;

            let intent = if mode == "region-copy" {
              Some("copyOutput".to_string())
            } else {
              None
            };

            match platform::capture_interactive_region_to_file() {
              Ok(Some(file_path)) => {
                if should_keep_unfocused(intent.as_deref()) {
                  show_main_window_no_focus(&app);
                } else {
                  show_main_window_and_focus(&app);
                }

                if let Some(main_win) = app.get_webview_window("main") {
                  let _ = main_win.emit(
                    "screenshot-captured",
                    ScreenshotCapturedPayload {
                      data_url: None,
                      file_path: Some(file_path),
                      source: "global-shortcut-native".to_string(),
                      intent,
                    },
                  );
                }
              }
              Ok(None) => {
                // user canceled selection
              }
              Err(err) => {
                let _ = app.emit(
                  "screenshot-error",
                  ScreenshotErrorPayload {
                    error: err,
                    source: Some("global-shortcut".to_string()),
                    kind: None,
                    permission_pane: None,
                  },
                );
              }
            }
          }

          #[cfg(target_os = "linux")]
          {
            if mode != "region" && mode != "region-copy" {
              let _ = app.emit(
                "screenshot-error",
                ScreenshotErrorPayload {
                  error: "Only region capture is supported.".to_string(),
                  source: Some("global-shortcut".to_string()),
                  kind: None,
                  permission_pane: None,
                },
              );
              return;
            }

            let intent = if mode == "region-copy" {
              Some("copyOutput")
            } else {
              None
            };
            if let Err(err) = open_capture_overlay(&app, intent) {
              let _ = app.emit(
                "screenshot-error",
                ScreenshotErrorPayload {
                  error: err,
                  source: Some("global-shortcut".to_string()),
                  kind: None,
                  permission_pane: None,
                },
              );
            }
          }
        });
      })
      .build(),
  )?;

  Ok(())
}

#[cfg(desktop)]
pub fn register_default_shortcuts(handle: &tauri::AppHandle) {
  // Register default shortcuts on startup so Cmd+Shift+6 works immediately.
  // If registration fails (e.g. another app still owns the shortcut), we'll log it.
  let is_macos = cfg!(target_os = "macos");
  let default_region = if is_macos { "Meta+Shift+8" } else { "Ctrl+Shift+8" };
  let default_instant = if is_macos { "Meta+Shift+9" } else { "Ctrl+Shift+9" };
  let region = pref_combo_to_parsed_shortcut(default_region, is_macos);
  let instant = pref_combo_to_parsed_shortcut(default_instant, is_macos);
  let window: Option<(String, tauri_plugin_global_shortcut::Shortcut)> = None;

  eprintln!(
    "[shortcuts] startup register defaults: region={:?} instant={:?} window={:?}",
    region.as_ref().map(|x| x.0.clone()),
    instant.as_ref().map(|x| x.0.clone()),
    window.as_ref().map(|x| x.0.clone())
  );

  // If the renderer already synced shortcut prefs at startup, it may have
  // registered the defaults already. Avoid re-registering and tripping
  // the plugin's "already registered" error.
  let existing_cfg = handle
    .state::<GlobalShortcutState>()
    .0
    .lock()
    .ok()
    .map(|c| c.clone())
    .unwrap_or_default();

  let global = handle.global_shortcut();
  let mut next_cfg = existing_cfg.clone();

  if next_cfg.region_accel.is_none() {
    if let Some((accel, hk)) = region.clone() {
      match global.register(accel.as_str()) {
        Ok(_) => {
          next_cfg.region_accel = Some(accel.clone());
          next_cfg.region_id = Some(hk.id());
        }
        Err(e) => {
          eprintln!("[shortcuts] startup failed to register region {}: {}", accel, e);
        }
      }
    }
  }
  if next_cfg.instant_accel.is_none() {
    if let Some((accel, hk)) = instant.clone() {
      match global.register(accel.as_str()) {
        Ok(_) => {
          next_cfg.instant_accel = Some(accel.clone());
          next_cfg.instant_id = Some(hk.id());
        }
        Err(e) => {
          eprintln!("[shortcuts] startup failed to register instant {}: {}", accel, e);
        }
      }
    }
  }
  // Window shortcut intentionally disabled.

  if let Ok(mut cfg) = handle.state::<GlobalShortcutState>().0.lock() {
    *cfg = next_cfg;
  }
}

#[cfg(not(desktop))]
pub fn setup_global_shortcuts(_handle: &tauri::AppHandle) -> Result<(), tauri::Error> {
  Ok(())
}

#[cfg(not(desktop))]
pub fn register_default_shortcuts(_handle: &tauri::AppHandle) {}
