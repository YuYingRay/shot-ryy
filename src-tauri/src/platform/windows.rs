use std::fs;
use std::path::Path;
use std::process::Command;
use std::os::windows::process::CommandExt;
use std::sync::Once;

const CREATE_NO_WINDOW: u32 = 0x08000000;

use tauri::Manager;

// Warm up System.Drawing / System.Windows.Forms once at startup so the first
// real capture call doesn't pay the full assembly-load penalty.
static PREWARM_CAPTURE_RUNTIME_ONCE: Once = Once::new();

pub fn prewarm_capture_interactive_runtime() {
  PREWARM_CAPTURE_RUNTIME_ONCE.call_once(|| {
    std::thread::spawn(|| {
      let _ = Command::new("powershell")
        .args([
          "-NoLogo", "-NoProfile", "-NonInteractive", "-Sta",
          "-ExecutionPolicy", "Bypass",
          "-Command",
          "Add-Type -AssemblyName System.Windows.Forms; \
           Add-Type -AssemblyName System.Drawing; \
           [void][System.Windows.Forms.SystemInformation]::VirtualScreen.Width",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
    });
  });
}

pub fn configure_capture_overlay_window(win: &tauri::WebviewWindow) {
  // Windows: a maximized borderless window often excludes the taskbar work-area,
  // which causes the screenshot (full monitor) to be scaled/letterboxed.
  // Fullscreen ensures 1:1 alignment with the captured monitor image.
  let _ = win.set_fullscreen(true);
}

fn escape_ps_single_quoted(value: &str) -> String {
  value.replace('\'', "''")
}

fn wait_for_file_ready(path: &Path) -> Result<(), String> {
  for _ in 0..50 {
    if let Ok(meta) = fs::metadata(path) {
      if meta.len() > 0 { return Ok(()); }
    }
    std::thread::sleep(std::time::Duration::from_millis(10));
  }
  Err("Timed out waiting for screenshot file".to_string())
}

fn make_capture_out_path() -> std::path::PathBuf {
  let mut p = std::env::temp_dir();
  p.push(format!(
    "shotstyle-win-capture-{}-{}.png",
    std::process::id(),
    std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .unwrap_or_default()
      .as_millis()
  ));
  p
}

pub fn capture_overlay_screenshot_to_file(app: &tauri::AppHandle) -> Result<String, String> {
  let monitor_bounds = app
    .get_webview_window("capture")
    .and_then(|w| w.current_monitor().ok().flatten())
    .map(|m| {
      let pos = m.position();
      let size = m.size();
      (pos.x, pos.y, size.width, size.height)
    });

  let out_path = make_capture_out_path();
  let path_str = out_path.to_string_lossy().to_string();
  let escaped = escape_ps_single_quoted(&path_str);

  let script = if let Some((x, y, w, h)) = monitor_bounds {
    format!("$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Drawing; $bmp=New-Object System.Drawing.Bitmap({w},{h}); $g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen({x},{y},0,0,$bmp.Size); $bmp.Save('{escaped}',[System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose()")
  } else {
    format!("$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Drawing; Add-Type -AssemblyName System.Windows.Forms; $vs=[System.Windows.Forms.SystemInformation]::VirtualScreen; $bmp=New-Object System.Drawing.Bitmap($vs.Width,$vs.Height); $g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($vs.Left,$vs.Top,0,0,$bmp.Size); $bmp.Save('{escaped}',[System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose()")
  };

  let output = Command::new("powershell")
    .args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Sta", "-ExecutionPolicy", "Bypass", "-Command", &script])
    .creation_flags(CREATE_NO_WINDOW)
    .output()
    .map_err(|e| format!("Failed to run PowerShell screenshot capture: {e}"))?;

  if !output.status.success() {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    return Err(if stderr.is_empty() {
      "Windows screenshot capture failed".to_string()
    } else {
      format!("Windows screenshot capture failed: {stderr}")
    });
  }

  wait_for_file_ready(&out_path)?;
  Ok(path_str)
}

pub fn capture_interactive_region_to_file() -> Result<Option<String>, String> {
  let mut out_path = std::env::temp_dir();
  let id = format!(
    "shotstyle-win-region-{}-{}",
    std::process::id(),
    std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .unwrap_or(std::time::Duration::from_millis(0))
      .as_millis()
  );
  out_path.push(format!("{id}.png"));

  let escaped = escape_ps_single_quoted(&out_path.to_string_lossy());
  let script = format!(
    "$ErrorActionPreference='Stop'; \
Add-Type -AssemblyName System.Windows.Forms; \
Add-Type -AssemblyName System.Drawing; \
$vs=[System.Windows.Forms.SystemInformation]::VirtualScreen; \
$script:sel=[System.Drawing.Rectangle]::Empty; \
$script:start=$null; \
$form=New-Object System.Windows.Forms.Form; \
$form.FormBorderStyle=[System.Windows.Forms.FormBorderStyle]::None; \
$form.AutoScaleMode=[System.Windows.Forms.AutoScaleMode]::None; \
$form.StartPosition=[System.Windows.Forms.FormStartPosition]::Manual; \
$form.ShowInTaskbar=$false; \
$form.TopMost=$true; \
$form.KeyPreview=$true; \
$form.BackColor=[System.Drawing.Color]::Black; \
$form.Opacity=0.20; \
$form.Cursor=[System.Windows.Forms.Cursors]::Cross; \
$form.Bounds=New-Object System.Drawing.Rectangle($vs.Left,$vs.Top,$vs.Width,$vs.Height); \
$form.Add_KeyDown({{ if($_.KeyCode -eq [System.Windows.Forms.Keys]::Escape){{ $form.Tag='cancel'; $form.Close(); }} }}); \
$form.Add_MouseDown({{ $script:start=New-Object System.Drawing.Point($_.X,$_.Y); $script:sel=New-Object System.Drawing.Rectangle($_.X,$_.Y,0,0); }}); \
$form.Add_MouseMove({{ if($script:start -ne $null){{ $x=[Math]::Min($script:start.X,$_.X); $y=[Math]::Min($script:start.Y,$_.Y); $w=[Math]::Abs($_.X-$script:start.X); $h=[Math]::Abs($_.Y-$script:start.Y); $script:sel=New-Object System.Drawing.Rectangle($x,$y,$w,$h); $form.Invalidate(); }} }}); \
$form.Add_MouseUp({{ if($script:start -ne $null){{ $form.Tag='ok'; $form.Close(); }} }}); \
$form.Add_Paint({{ param($s,$e) if($script:sel.Width -gt 0 -and $script:sel.Height -gt 0){{ $pen=New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(240,51,154,240),2); $brush=New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(60,51,154,240)); $e.Graphics.FillRectangle($brush,$script:sel); $e.Graphics.DrawRectangle($pen,$script:sel); $pen.Dispose(); $brush.Dispose(); }} }}); \
[void]$form.ShowDialog(); \
if($form.Tag -ne 'ok' -or $script:sel.Width -lt 3 -or $script:sel.Height -lt 3){{ Write-Output ''; exit 0 }}; \
$scaleX = if($form.ClientSize.Width -gt 0) {{ [double]$vs.Width / [double]$form.ClientSize.Width }} else {{ 1.0 }}; \
$scaleY = if($form.ClientSize.Height -gt 0) {{ [double]$vs.Height / [double]$form.ClientSize.Height }} else {{ 1.0 }}; \
$sx = [int][Math]::Round($script:sel.X * $scaleX); \
$sy = [int][Math]::Round($script:sel.Y * $scaleY); \
$sw = [int][Math]::Round($script:sel.Width * $scaleX); \
$sh = [int][Math]::Round($script:sel.Height * $scaleY); \
if($sw -lt 1 -or $sh -lt 1){{ Write-Output ''; exit 0 }}; \
$bmp=New-Object System.Drawing.Bitmap($sw,$sh); \
$g=[System.Drawing.Graphics]::FromImage($bmp); \
$g.CopyFromScreen(($vs.Left + $sx),($vs.Top + $sy),0,0,$bmp.Size); \
$bmp.Save('{escaped}', [System.Drawing.Imaging.ImageFormat]::Png); \
$g.Dispose(); $bmp.Dispose(); \
Write-Output '{escaped}'"
  );

  let output = Command::new("powershell")
    .args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Sta", "-ExecutionPolicy", "Bypass", "-Command", &script])
    .creation_flags(CREATE_NO_WINDOW)
    .output()
    .map_err(|e| format!("Failed to run interactive region capture: {e}"))?;

  if !output.status.success() {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    return Err(if stderr.is_empty() {
      "Interactive region capture failed".to_string()
    } else {
      format!("Interactive region capture failed: {stderr}")
    });
  }

  let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
  if stdout.is_empty() {
    return Ok(None);
  }

  let selected = Path::new(&stdout);
  if !selected.exists() {
    return Ok(None);
  }

  wait_for_file_ready(selected)?;
  Ok(Some(stdout))
}

pub fn open_url(url: &str) -> Result<(), String> {
  // Primary path: Shell URL handler without involving cmd parsing.
  if Command::new("rundll32")
    .args(["url.dll,FileProtocolHandler", url])
    .spawn()
    .is_ok()
  {
    return Ok(());
  }

  // Fallback path: `start` is a cmd built-in; empty title avoids argument shifts.
  Command::new("cmd")
    .args(["/C", "start", "", url])
    .spawn()
    .map_err(|e| format!("Failed to open browser: {e}"))?;
  Ok(())
}
