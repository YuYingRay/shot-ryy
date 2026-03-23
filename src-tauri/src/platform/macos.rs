use std::process::Command;

use tauri::Manager;

pub fn setup_platform_app(app: &tauri::App) {
  let handle = app.handle();

  // Menu-bar only by default: keep the app out of the Dock.
  let _ = handle.set_activation_policy(tauri::ActivationPolicy::Accessory);

  if let Some(win) = app.get_webview_window("main") {
    // Make the native titlebar transparent/overlay so it inherits the webview background.
    let _ = win.set_title_bar_style(tauri::TitleBarStyle::Overlay);
    let _ = win.set_title("");
  }
}

pub fn prepare_main_window_show(app: &tauri::AppHandle) {
  let _ = app;
}

pub fn post_main_window_focus(win: &tauri::WebviewWindow) {
  // Some macOS versions can ignore focus requests unless we briefly elevate.
  let _ = win.set_always_on_top(true);
  let _ = win.set_always_on_top(false);
}

pub fn open_url(url: &str) -> Result<(), String> {
  Command::new("/usr/bin/open")
    .arg(url)
    .spawn()
    .map_err(|e| format!("Failed to open browser: {e}"))?;
  Ok(())
}

pub async fn open_system_settings(pane: &str) -> Result<bool, String> {
  let pane = pane.trim().to_lowercase();
  let url = match pane.as_str() {
    "screen-recording" | "screen_recording" | "screencapture" | "screen" => {
      "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
    }
    "files-and-folders" | "files_folders" | "files" => {
      "x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders"
    }
    _ => {
      // Default to Privacy & Security root.
      "x-apple.systempreferences:com.apple.preference.security?Privacy"
    }
  };

  let status = Command::new("/usr/bin/open")
    .arg(url)
    .status()
    .map_err(|e| format!("Failed to open System Settings: {e}"))?;

  if status.success() {
    Ok(true)
  } else {
    Err(format!("open exited with status: {status}"))
  }
}

pub fn clipboard_png_data_url_after_screencapture(mode: Option<&str>) -> Result<String, String> {
  use std::fs;

  // Run macOS screencapture, write to a temp file.
  // Using a temp file is more reliable than clipboard polling and avoids
  // overwriting the user's clipboard with the raw screenshot when the app
  // intends to copy the composed export.
  // Modes:
  // - region: interactive selection
  // - window: interactive window selection (best-effort)
  // - instant: immediate full-screen
  let mut cmd = Command::new("/usr/sbin/screencapture");
  cmd.arg("-x");

  let out_path = {
    let mut p = std::env::temp_dir();
    let id = format!(
      "shotstyle-{}-{}",
      std::process::id(),
      std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or(std::time::Duration::from_millis(0))
        .as_millis()
    );
    p.push(format!("{id}.png"));
    p
  };

  match mode.unwrap_or("region") {
    "instant" => {
      // Full screen to file.
    }
    "window" => {
      // Best-effort: interactive mode; user can click a window.
      // (Some macOS versions support -w to force window capture; if unsupported it will be ignored by screencapture.)
      cmd.arg("-i");
      cmd.arg("-w");
    }
    _ => {
      // region
      cmd.arg("-i");
    }
  }

  // Output to file (PNG).
  cmd.arg(out_path.as_os_str());

  let output = cmd
    .output()
    .map_err(|e| format!("Failed to run screencapture: {e}"))?;

  if !output.status.success() {
    // User cancelled (e.g. Esc) or capture failed.
    let _ = fs::remove_file(&out_path);

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let combined = [stderr.as_str(), stdout.as_str()]
      .iter()
      .map(|s| s.trim())
      .filter(|s| !s.is_empty())
      .collect::<Vec<_>>()
      .join("\n");

    if combined.is_empty() {
      return Err("Screenshot capture canceled".to_string());
    }

    return Err(format!("screencapture failed: {combined}"));
  }

  // Some macOS builds return before the file is fully materialized.
  // Wait briefly for the file to exist, become non-empty, and have a stable size.
  // This avoids races where the file exists but still has partial contents.
  let mut ready = false;
  let mut last_len: Option<u64> = None;
  let mut stable_ticks = 0u32;
  for _ in 0..120 {
    if let Ok(meta) = fs::metadata(&out_path) {
      let len = meta.len();
      if len > 0 {
        if last_len == Some(len) {
          stable_ticks += 1;
        } else {
          stable_ticks = 0;
          last_len = Some(len);
        }

        // Require a couple stable observations (~50ms) before proceeding.
        if stable_ticks >= 2 {
          ready = true;
          break;
        }
      }
    }
    std::thread::sleep(std::time::Duration::from_millis(25));
  }

  if !ready {
    let _ = fs::remove_file(&out_path);
    return Err("Failed to read screenshot file: output file was not created".to_string());
  }

  // Keep the file on disk so the renderer can load it via the asset protocol.
  Ok(out_path.to_string_lossy().to_string())
}

pub fn set_dock_icon_hidden(enabled: bool, app: &tauri::AppHandle) -> Result<(), String> {
  let policy = if enabled {
    tauri::ActivationPolicy::Accessory
  } else {
    tauri::ActivationPolicy::Regular
  };
  app
    .set_activation_policy(policy)
    .map_err(|e| format!("Failed to update activation policy: {e}"))
}

pub fn set_open_at_login_enabled(enabled: bool) -> Result<(), String> {
  use std::env;
  use std::fs;
  use std::io::Write;
  use std::os::unix::fs::PermissionsExt;
  use std::path::PathBuf;

  let home = env::var("HOME").map_err(|_| "HOME is not set".to_string())?;
  let launch_agents_dir = PathBuf::from(home).join("Library").join("LaunchAgents");
  fs::create_dir_all(&launch_agents_dir)
    .map_err(|e| format!("Failed to create LaunchAgents directory: {e}"))?;

  let plist_path = launch_agents_dir.join("com.shotstyle.app.plist");

  if !enabled {
    if plist_path.exists() {
      fs::remove_file(&plist_path)
        .map_err(|e| format!("Failed to remove LaunchAgent file: {e}"))?;
    }
    return Ok(());
  }

  let exe = env::current_exe()
    .map_err(|e| format!("Failed to resolve app executable path: {e}"))?;

  let escaped_exe = exe
    .to_string_lossy()
    .replace('&', "&amp;")
    .replace('<', "&lt;")
    .replace('>', "&gt;")
    .replace('"', "&quot;")
    .replace('\'', "&apos;");

  let plist = format!(
    r#"<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">
<plist version=\"1.0\">
<dict>
  <key>Label</key>
  <string>com.shotstyle.app</string>
  <key>ProgramArguments</key>
  <array>
    <string>{}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
"#,
    escaped_exe
  );

  let mut file = fs::File::create(&plist_path)
    .map_err(|e| format!("Failed to create LaunchAgent plist: {e}"))?;
  file
    .write_all(plist.as_bytes())
    .map_err(|e| format!("Failed to write LaunchAgent plist: {e}"))?;
  let mut perms = file
    .metadata()
    .map_err(|e| format!("Failed to read plist metadata: {e}"))?
    .permissions();
  perms.set_mode(0o644);
  fs::set_permissions(&plist_path, perms)
    .map_err(|e| format!("Failed to set plist permissions: {e}"))?;

  Ok(())
}
