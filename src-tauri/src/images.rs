use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::collections::HashSet;

#[cfg(target_os = "macos")]
use std::process::{Command, Stdio};

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::Manager;
use uuid::Uuid;

#[cfg(target_os = "macos")]
fn macos_default_tmp_dir() -> Option<PathBuf> {
  // Prefer a stable, user-writable tmp dir on the home volume. This avoids
  // intermittent failures writing to system temp locations and aligns with our
  // dev env defaults (see platform/macos/node/tauriEnv.js).
  let home = std::env::var_os("HOME")?;
  Some(
    PathBuf::from(home)
      .join("Library")
      .join("Caches")
      .join("shotstyle")
      .join("tmp"),
  )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadFileAsDataUrlArgs {
  pub file_path: String,
  pub max_dim: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadFileAsAssetArgs {
  pub file_path: String,
  pub max_dim: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadFileAsAssetResult {
  pub file_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageApplyFxBytesArgs {
  pub bytes: Vec<u8>,
  pub blur_px: Option<f32>,
  pub brightness: Option<f32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageApplyFxResult {
  pub file_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveCustomBackgroundResult {
  pub ok: bool,
  pub name: Option<String>,
  pub file_path: Option<String>,
  pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveCustomBackgroundArgs {
  pub data_url: String,
  pub file_name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomBackgroundItem {
  pub name: String,
  pub file_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteResult {
  pub ok: bool,
  pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteCustomBackgroundArgs {
  pub file_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveExportArgs {
  pub data_url: String,
  pub file_name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveExportResult {
  pub ok: bool,
  pub file_path: Option<String>,
  pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveExportToPathArgs {
  pub data_url: String,
  pub file_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveExportToFolderArgs {
  pub data_url: String,
  pub folder_path: String,
  pub file_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyWatermarkArgs {
  pub base_data_url: String,
  pub watermark_data_url: String,
  pub x: f32,
  pub y: f32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardWriteImageArgs {
  pub data_url: String,
}

fn app_custom_backgrounds_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  let base = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("Failed to resolve app_data_dir: {e}"))?;
  Ok(base.join("shot.style").join("backgrounds"))
}

fn sanitize_file_stem(name: &str) -> String {
  let trimmed = name.trim();
  if trimmed.is_empty() {
    return "shot.style".to_string();
  }
  let cleaned = trimmed
    .replace(['/', '\\'], "-")
    .replace(':', "")
    .replace('*', "")
    .replace('?', "")
    .replace('"', "")
    .replace('<', "")
    .replace('>', "")
    .replace('|', "");
  if cleaned.trim().is_empty() {
    "shot.style".to_string()
  } else {
    cleaned
  }
}

fn ensure_within_base(base: &Path, target: &Path) -> Result<(), String> {
  let base_abs = base.canonicalize().map_err(|e| format!("Failed to resolve base: {e}"))?;
  let target_abs = target.canonicalize().map_err(|e| format!("Failed to resolve target: {e}"))?;
  if !target_abs.starts_with(&base_abs) {
    return Err("Refusing to delete outside of managed directory".to_string());
  }
  Ok(())
}

fn ext_from_mime(mime: &str) -> &'static str {
  let m = mime.to_lowercase();
  if m.contains("jpeg") || m.contains("jpg") {
    "jpg"
  } else if m.contains("webp") {
    "webp"
  } else {
    "png"
  }
}

pub(crate) fn write_temp_png(bytes: &[u8]) -> Result<PathBuf, String> {
  let mut out_path = std::env::temp_dir();
  #[cfg(target_os = "macos")]
  {
    if let Some(dir) = macos_default_tmp_dir() {
      out_path = dir;
    }
  }
  fs::create_dir_all(&out_path).map_err(|e| format!("Failed to create temp dir: {e}"))?;
  let id = Uuid::new_v4().to_string();
  out_path.push(format!("shotstyle-{id}.png"));
  fs::write(&out_path, bytes).map_err(|e| format!("Failed to write temp image: {e}"))?;
  Ok(out_path)
}

fn write_temp_png_from_image(img: &image::DynamicImage) -> Result<PathBuf, String> {
  let mut out: Vec<u8> = Vec::new();
  img
    .write_to(&mut Cursor::new(&mut out), image::ImageFormat::Png)
    .map_err(|e| format!("Failed to encode temp image: {e}"))?;
  write_temp_png(&out)
}

fn write_png_to_path(img: &image::DynamicImage, out_path: &Path) -> Result<(), String> {
  if let Some(parent) = out_path.parent() {
    fs::create_dir_all(parent).map_err(|e| format!("Failed to create output dir: {e}"))?;
  }
  let mut out: Vec<u8> = Vec::new();
  img
    .write_to(&mut Cursor::new(&mut out), image::ImageFormat::Png)
    .map_err(|e| format!("Failed to encode image: {e}"))?;
  fs::write(out_path, out).map_err(|e| format!("Failed to write output image: {e}"))?;
  Ok(())
}

fn apply_brightness_in_place(img: &mut image::RgbaImage, brightness: f32) {
  let b = brightness.clamp(0.25, 3.0);
  if (b - 1.0).abs() < 0.0001 {
    return;
  }
  for px in img.pixels_mut() {
    let r = (px[0] as f32 * b).round().clamp(0.0, 255.0) as u8;
    let g = (px[1] as f32 * b).round().clamp(0.0, 255.0) as u8;
    let bch = (px[2] as f32 * b).round().clamp(0.0, 255.0) as u8;
    px[0] = r;
    px[1] = g;
    px[2] = bch;
  }
}

fn decode_data_url(data_url: &str) -> Result<(String, Vec<u8>), String> {
  let s = data_url.trim();
  let comma = s.find(',').ok_or_else(|| "Invalid data URL".to_string())?;
  let (meta, payload) = s.split_at(comma);
  let payload = &payload[1..];

  let mime = meta
    .strip_prefix("data:")
    .and_then(|m| m.split(';').next())
    .unwrap_or("application/octet-stream")
    .to_string();

  let bytes = if meta.contains(";base64") {
    STANDARD
      .decode(payload)
      .map_err(|e| format!("Failed to decode base64 data URL: {e}"))?
  } else {
    payload.as_bytes().to_vec()
  };

  Ok((mime, bytes))
}

fn bytes_to_data_url(mime: &str, bytes: &[u8]) -> String {
  let b64 = STANDARD.encode(bytes);
  format!("data:{mime};base64,{b64}")
}

fn ensure_unique_path(path: PathBuf) -> PathBuf {
  if !path.exists() {
    return path;
  }
  let parent = path.parent().map(|p| p.to_path_buf()).unwrap_or_else(|| PathBuf::from("."));
  let stem = path
    .file_stem()
    .and_then(|s| s.to_str())
    .unwrap_or("export")
    .to_string();
  let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("").to_string();

  let ts = chrono::Utc::now().timestamp_millis();
  let file_name = if ext.is_empty() {
    format!("{stem}-{ts}")
  } else {
    format!("{stem}-{ts}.{ext}")
  };
  parent.join(file_name)
}

fn read_image_bytes_with_retry(path: &Path, max_attempts: u32, delay_ms: u64) -> Result<Vec<u8>, String> {
  let attempts = max_attempts.max(1);
  let mut last_err: Option<String> = None;

  for attempt in 0..attempts {
    match fs::read(path) {
      Ok(bytes) => {
        if bytes.len() < 16 {
          last_err = Some(format!("file too small ({} bytes)", bytes.len()));
        } else if image::load_from_memory(&bytes).is_ok() {
          return Ok(bytes);
        } else {
          last_err = Some("failed to decode image".to_string());
        }
      }
      Err(e) => {
        last_err = Some(format!("Failed to read file: {e}"));
      }
    }

    if attempt + 1 < attempts {
      std::thread::sleep(std::time::Duration::from_millis(delay_ms));
    }
  }

  Err(format!(
    "Failed to read image after {attempts} attempts: {}",
    last_err.unwrap_or_else(|| "unknown error".to_string())
  ))
}

#[tauri::command]
pub async fn read_file_as_asset(app: tauri::AppHandle, args: ReadFileAsAssetArgs) -> Result<ReadFileAsAssetResult, String> {
  let path = PathBuf::from(&args.file_path);
  if !path.exists() {
    return Err("File does not exist".to_string());
  }

  // If no resize is requested, return the original file path.
  let max_dim = args.max_dim.unwrap_or(0).min(8192);
  if max_dim == 0 {
    return Ok(ReadFileAsAssetResult { file_path: path.to_string_lossy().to_string() });
  }

  // Cache resized outputs by (path, mtime, size, max_dim) so UI thumbnail requests don't
  // repeatedly re-decode/re-transcode the same wallpaper when switching tabs.
  fn cache_key_for(path: &Path, max_dim: u32) -> String {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    path.to_string_lossy().to_string().hash(&mut hasher);
    max_dim.hash(&mut hasher);
    if let Ok(meta) = std::fs::metadata(path) {
      meta.len().hash(&mut hasher);
      if let Ok(mtime) = meta.modified() {
        if let Ok(dur) = mtime.duration_since(std::time::UNIX_EPOCH) {
          dur.as_secs().hash(&mut hasher);
          dur.subsec_nanos().hash(&mut hasher);
        }
      }
    }
    format!("{:016x}", hasher.finish())
  }

  fn shotstyle_cache_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    // Dev/pro override: allow redirecting cache to a different volume.
    // This path is only used for app-generated thumbnails (not user files).
    if let Ok(raw) = std::env::var("SHOTSTYLE_CACHE_DIR") {
      let s = raw.trim();
      if !s.is_empty() {
        let p = PathBuf::from(s);
        if p.is_absolute() {
          if std::fs::create_dir_all(&p).is_ok() {
            return Some(p);
          }
        }
      }
    }
    app.path().app_cache_dir().ok()
  }

  fn cached_png_path(app: &tauri::AppHandle, key: &str) -> Option<PathBuf> {
    let base = shotstyle_cache_dir(app)?;
    Some(base.join("thumb-cache").join(format!("{key}.png")))
  }

  let key = cache_key_for(&path, max_dim);
  if let Some(p) = cached_png_path(&app, &key) {
    if let Ok(meta) = std::fs::metadata(&p) {
      if meta.is_file() && meta.len() > 0 {
        return Ok(ReadFileAsAssetResult { file_path: p.to_string_lossy().to_string() });
      }
    }
  }

  #[cfg(target_os = "macos")]
  {
    // macOS system wallpapers are often HEIC/HEIF. Avoid reading the entire file into memory
    // only to fail decode; use `sips` to rasterize directly.
    let ext = path
      .extension()
      .and_then(|s| s.to_str())
      .unwrap_or("")
      .to_lowercase();
    let is_heic_like = matches!(ext.as_str(), "heic" | "heif" | "avif");

    // macOS dynamic wallpapers can be videos (e.g. .mov). Use QuickLook to extract a still.
    let is_video_like = matches!(ext.as_str(), "mov" | "mp4" | "m4v");
    if is_video_like {
      fn qlmanage_thumbnail_to_png(
        app: &tauri::AppHandle,
        input: &Path,
        max_dim: u32,
        cache_key: &str,
      ) -> Result<PathBuf, String> {
        let cache_path = cached_png_path(app, cache_key)
          .ok_or_else(|| "Failed to resolve cache directory".to_string())?;
        if let Some(parent) = cache_path.parent() {
          fs::create_dir_all(parent).map_err(|e| format!("Failed to create cache dir: {e}"))?;
        }
        if let Ok(meta) = std::fs::metadata(&cache_path) {
          if meta.is_file() && meta.len() > 0 {
            return Ok(cache_path);
          }
        }

        // Write qlmanage outputs next to our cache so rename is cheap and reliable.
        let parent = cache_path
          .parent()
          .ok_or_else(|| "Invalid cache path".to_string())?;
        let out_dir = parent.join("ql-tmp").join(cache_key);
        fs::create_dir_all(&out_dir).map_err(|e| format!("Failed to create qlmanage out dir: {e}"))?;

        let mut tmp_dir = std::env::temp_dir();
        if let Some(dir) = macos_default_tmp_dir() {
          tmp_dir = dir;
        } else if let Some(dir) = shotstyle_cache_dir(app) {
          tmp_dir = dir;
        }
        fs::create_dir_all(&tmp_dir).map_err(|e| format!("Failed to create qlmanage tmp dir: {e}"))?;

        let output = Command::new("qlmanage")
          .env("TMPDIR", &tmp_dir)
          .arg("-t")
          .arg("-f")
          .arg("-s")
          .arg(max_dim.to_string())
          .arg("-o")
          .arg(&out_dir)
          .arg(input)
          .stdout(Stdio::null())
          .output()
          .map_err(|e| format!("Failed to run qlmanage: {e}"))?;

        if !output.status.success() {
          let stderr = String::from_utf8_lossy(&output.stderr);
          let msg = stderr.trim();
          let _ = fs::remove_dir_all(&out_dir);
          if msg.is_empty() {
            return Err("qlmanage thumbnail failed".to_string());
          }
          return Err(format!("qlmanage thumbnail failed: {msg}"));
        }

        // qlmanage writes one or more pngs into out_dir. Pick the first non-empty one.
        let mut picked: Option<PathBuf> = None;
        if let Ok(entries) = std::fs::read_dir(&out_dir) {
          for ent in entries.flatten() {
            let p = ent.path();
            if !p.is_file() {
              continue;
            }
            let ok_ext = p
              .extension()
              .and_then(|s| s.to_str())
              .map(|s| s.eq_ignore_ascii_case("png"))
              .unwrap_or(false);
            if !ok_ext {
              continue;
            }
            if let Ok(meta) = std::fs::metadata(&p) {
              if meta.len() > 0 {
                picked = Some(p);
                break;
              }
            }
          }
        }

        let picked = picked.ok_or_else(|| {
          let _ = fs::remove_dir_all(&out_dir);
          "qlmanage did not produce output".to_string()
        })?;

        fs::rename(&picked, &cache_path)
          .map_err(|e| format!("Failed to move qlmanage output: {e}"))?;

        let _ = fs::remove_dir_all(&out_dir);
        Ok(cache_path)
      }

      let out_path = qlmanage_thumbnail_to_png(&app, &path, max_dim, &key)?;
      return Ok(ReadFileAsAssetResult { file_path: out_path.to_string_lossy().to_string() });
    }
    if is_heic_like {
      fn sips_thumbnail_to_png(app: &tauri::AppHandle, input: &Path, max_dim: u32, cache_key: &str) -> Result<PathBuf, String> {
        let cache_path = cached_png_path(app, cache_key)
          .ok_or_else(|| "Failed to resolve cache directory".to_string())?;
        if let Some(parent) = cache_path.parent() {
          fs::create_dir_all(parent).map_err(|e| format!("Failed to create cache dir: {e}"))?;
        }
        if let Ok(meta) = std::fs::metadata(&cache_path) {
          if meta.is_file() && meta.len() > 0 {
            return Ok(cache_path);
          }
        }

        // `sips` may attempt to write intermediate files into TMPDIR; force it to a writable
        // directory to avoid permission failures.
        let mut tmp_dir = std::env::temp_dir();
        if let Some(dir) = macos_default_tmp_dir() {
          tmp_dir = dir;
        } else if let Some(dir) = shotstyle_cache_dir(app) {
          tmp_dir = dir;
        }
        fs::create_dir_all(&tmp_dir).map_err(|e| format!("Failed to create sips tmp dir: {e}"))?;

        let output = Command::new("sips")
          .env("TMPDIR", &tmp_dir)
          .arg("-Z")
          .arg(max_dim.to_string())
          .arg("-s")
          .arg("format")
          .arg("png")
          .arg(input)
          .arg("--out")
          .arg(&cache_path)
          .stdout(Stdio::null())
          .output()
          .map_err(|e| format!("Failed to run sips: {e}"))?;

        if !output.status.success() {
          let stderr = String::from_utf8_lossy(&output.stderr);
          let msg = stderr.trim();
          if msg.is_empty() {
            return Err("sips conversion failed".to_string());
          }
          return Err(format!("sips conversion failed: {msg}"));
        }
        if !cache_path.exists() {
          return Err("sips did not produce output".to_string());
        }
        Ok(cache_path)
      }

      let out_path = sips_thumbnail_to_png(&app, &path, max_dim, &key)?;
      return Ok(ReadFileAsAssetResult { file_path: out_path.to_string_lossy().to_string() });
    }
  }

  let bytes = fs::read(&path).map_err(|e| format!("Failed to read file: {e}"))?;

  match image::load_from_memory(&bytes) {
    Ok(img) => {
      let resized = img.thumbnail(max_dim, max_dim);
      let out_path = if let Some(cache_path) = cached_png_path(&app, &key) {
        if let Some(parent) = cache_path.parent() {
          fs::create_dir_all(parent).map_err(|e| format!("Failed to create cache dir: {e}"))?;
        }
        write_png_to_path(&resized, &cache_path)?;
        cache_path
      } else {
        write_temp_png_from_image(&resized)?
      };
      Ok(ReadFileAsAssetResult { file_path: out_path.to_string_lossy().to_string() })
    }
    Err(e) => {
      let _ = &e;
      #[cfg(target_os = "macos")]
      {
        // For other macOS decode failures, retry via `sips` into the same stable cache path.
        fn sips_thumbnail_to_png(app: &tauri::AppHandle, input: &Path, max_dim: u32, cache_key: &str) -> Result<PathBuf, String> {
          let cache_path = cached_png_path(app, cache_key)
            .ok_or_else(|| "Failed to resolve cache directory".to_string())?;
          if let Some(parent) = cache_path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create cache dir: {e}"))?;
          }
          if let Ok(meta) = std::fs::metadata(&cache_path) {
            if meta.is_file() && meta.len() > 0 {
              return Ok(cache_path);
            }
          }

          let mut tmp_dir = std::env::temp_dir();
          if let Some(dir) = macos_default_tmp_dir() {
            tmp_dir = dir;
          } else if let Some(dir) = shotstyle_cache_dir(app) {
            tmp_dir = dir;
          }
          fs::create_dir_all(&tmp_dir).map_err(|e| format!("Failed to create sips tmp dir: {e}"))?;

          let output = Command::new("sips")
            .env("TMPDIR", &tmp_dir)
            .arg("-Z")
            .arg(max_dim.to_string())
            .arg("-s")
            .arg("format")
            .arg("png")
            .arg(input)
            .arg("--out")
            .arg(&cache_path)
            .stdout(Stdio::null())
            .output()
            .map_err(|e| format!("Failed to run sips: {e}"))?;

          if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let msg = stderr.trim();
            if msg.is_empty() {
              return Err("sips conversion failed".to_string());
            }
            return Err(format!("sips conversion failed: {msg}"));
          }
          if !cache_path.exists() {
            return Err("sips did not produce output".to_string());
          }
          Ok(cache_path)
        }

        let out_path = sips_thumbnail_to_png(&app, &path, max_dim, &key)?;
        return Ok(ReadFileAsAssetResult { file_path: out_path.to_string_lossy().to_string() });
      }

      #[allow(unreachable_code)]
      Err(format!("Failed to decode image: {e}"))
    }
  }
}

#[tauri::command]
pub async fn image_apply_fx_bytes(_app: tauri::AppHandle, args: ImageApplyFxBytesArgs) -> Result<ImageApplyFxResult, String> {
  if args.bytes.is_empty() {
    return Err("Missing image bytes".to_string());
  }

  let blur = args.blur_px.unwrap_or(0.0).max(0.0);
  let brightness = args.brightness.unwrap_or(1.0);

  let mut img = image::load_from_memory(&args.bytes)
    .map_err(|e| format!("Failed to decode image: {e}"))?;

  if blur > 0.0001 {
    img = img.blur(blur);
  }

  let mut rgba = img.to_rgba8();
  apply_brightness_in_place(&mut rgba, brightness);
  let dyn_img = image::DynamicImage::ImageRgba8(rgba);
  let out_path = write_temp_png_from_image(&dyn_img)?;

  Ok(ImageApplyFxResult { file_path: out_path.to_string_lossy().to_string() })
}

#[tauri::command]
pub async fn clipboard_write_image_data_url(_app: tauri::AppHandle, args: ClipboardWriteImageArgs) -> Result<(), String> {
  let (_mime, bytes) = decode_data_url(&args.data_url)?;

  let img = image::load_from_memory(&bytes)
    .map_err(|e| format!("Failed to decode image: {e}"))?
    .to_rgba8();

  let (w, h) = img.dimensions();
  let rgba = img.into_raw();

  let mut clipboard = arboard::Clipboard::new().map_err(|e| format!("Clipboard init failed: {e}"))?;
  clipboard
    .set_image(arboard::ImageData {
      width: w as usize,
      height: h as usize,
      bytes: std::borrow::Cow::Owned(rgba),
    })
    .map_err(|e| format!("Clipboard write failed: {e}"))?;

  Ok(())
}

#[tauri::command]
pub async fn read_file_as_data_url(_app: tauri::AppHandle, args: ReadFileAsDataUrlArgs) -> Result<String, String> {
  let path = PathBuf::from(&args.file_path);

  let mime = mime_guess::from_path(&path)
    .first_or_octet_stream()
    .to_string();

  // Allow reading arbitrary paths (desktop app behavior). If you want to lock this down later,
  // we can restrict to app_data_dir only.
  let bytes = if mime.starts_with("image/") {
    read_image_bytes_with_retry(&path, 25, 40)?
  } else {
    fs::read(&path).map_err(|e| format!("Failed to read file: {e}"))?
  };

  // Reliability: for images (notably freshly-written screenshots), ensure the file is actually
  // decodable before returning a data URL. Some platforms can observe the path before the writer
  // has flushed all bytes; returning a corrupt data URL would get cached on the JS side.
  if mime.starts_with("image/") {
    image::load_from_memory(&bytes)
      .map_err(|e| format!("Failed to decode image: {e}"))?;
  }

  // Optional thumbnailing for UI (e.g. maxDim: 256)
  if let Some(max_dim) = args.max_dim {
    if max_dim > 0 {
      if let Ok(img) = image::load_from_memory(&bytes) {
        let resized = img.thumbnail(max_dim, max_dim);
        let mut out: Vec<u8> = Vec::new();

        let format = if mime.contains("jpeg") || mime.contains("jpg") {
          image::ImageFormat::Jpeg
        } else if mime.contains("webp") {
          image::ImageFormat::WebP
        } else {
          image::ImageFormat::Png
        };

        if resized
          .write_to(&mut std::io::Cursor::new(&mut out), format)
          .is_ok()
        {
          let out_mime = match format {
            image::ImageFormat::Jpeg => "image/jpeg",
            image::ImageFormat::WebP => "image/webp",
            _ => "image/png",
          };
          return Ok(bytes_to_data_url(out_mime, &out));
        }
      }
    }
  }

  Ok(bytes_to_data_url(&mime, &bytes))
}

#[tauri::command]
pub async fn backgrounds_save_custom(app: tauri::AppHandle, args: SaveCustomBackgroundArgs) -> Result<SaveCustomBackgroundResult, String> {
  let (mime, bytes) = match decode_data_url(&args.data_url) {
    Ok(v) => v,
    Err(e) => {
      return Ok(SaveCustomBackgroundResult {
        ok: false,
        name: None,
        file_path: None,
        error: Some(e),
      })
    }
  };

  let dir = app_custom_backgrounds_dir(&app)?;
  fs::create_dir_all(&dir).map_err(|e| format!("Failed to create dir: {e}"))?;

  let safe_name = args.file_name
    .trim()
    .replace(['/', '\\'], "-")
    .replace(':', "")
    .replace('*', "")
    .replace('?', "")
    .replace('"', "")
    .replace('<', "")
    .replace('>', "")
    .replace('|', "");

  let ext = if safe_name.to_lowercase().ends_with(".png")
    || safe_name.to_lowercase().ends_with(".jpg")
    || safe_name.to_lowercase().ends_with(".jpeg")
    || safe_name.to_lowercase().ends_with(".webp")
  {
    Path::new(&safe_name)
      .extension()
      .and_then(|s| s.to_str())
      .unwrap_or("png")
      .to_string()
  } else if mime.contains("jpeg") {
    "jpg".to_string()
  } else if mime.contains("webp") {
    "webp".to_string()
  } else {
    "png".to_string()
  };

  let stem = Path::new(&safe_name)
    .file_stem()
    .and_then(|s| s.to_str())
    .unwrap_or("background")
    .to_string();

  let mut candidate = dir.join(format!("{stem}.{ext}"));
  if candidate.exists() {
    let ts = chrono::Utc::now().timestamp_millis();
    candidate = dir.join(format!("{stem}-{ts}.{ext}"));
  }

  fs::write(&candidate, bytes).map_err(|e| format!("Failed to write file: {e}"))?;

  Ok(SaveCustomBackgroundResult {
    ok: true,
    name: candidate
      .file_name()
      .and_then(|s| s.to_str())
      .map(|s| s.to_string()),
    file_path: Some(candidate.to_string_lossy().to_string()),
    error: None,
  })
}

#[tauri::command]
pub async fn backgrounds_list_custom(app: tauri::AppHandle) -> Result<Vec<CustomBackgroundItem>, String> {
  let dir = app_custom_backgrounds_dir(&app)?;
  if !dir.exists() {
    return Ok(vec![]);
  }

  let mut out: Vec<CustomBackgroundItem> = vec![];
  for entry in fs::read_dir(&dir).map_err(|e| format!("Failed to read dir: {e}"))? {
    let entry = entry.map_err(|e| format!("Failed to read entry: {e}"))?;
    let path = entry.path();
    if !path.is_file() {
      continue;
    }

    let name = path
      .file_name()
      .and_then(|s| s.to_str())
      .unwrap_or("")
      .to_string();

    if name.is_empty() {
      continue;
    }

    out.push(CustomBackgroundItem {
      name,
      file_path: path.to_string_lossy().to_string(),
    });
  }

  // Sort stable-ish
  out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
  Ok(out)
}

#[tauri::command]
pub async fn backgrounds_delete_custom(app: tauri::AppHandle, args: DeleteCustomBackgroundArgs) -> Result<DeleteResult, String> {
  let dir = app_custom_backgrounds_dir(&app)?;
  let target = PathBuf::from(args.file_path);

  // Safety: only allow deleting inside our managed folder.
  if target.exists() {
    ensure_within_base(&dir, &target)?;
  }

  match fs::remove_file(&target) {
    Ok(_) => Ok(DeleteResult { ok: true, error: None }),
    Err(e) => Ok(DeleteResult { ok: false, error: Some(format!("Failed to delete: {e}")) }),
  }
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListSystemWallpapersArgs {
  pub max_items: Option<u32>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemWallpaperItem {
  pub name: String,
  pub file_path: String,
}

fn is_wallpaper_image(path: &Path) -> bool {
  let ext = path
    .extension()
    .and_then(|s| s.to_str())
    .unwrap_or("")
    .to_lowercase();
  let fname = path
    .file_name()
    .and_then(|s| s.to_str())
    .unwrap_or("")
    .to_lowercase();
  let path_str = path.to_string_lossy().to_lowercase();

  #[cfg(target_os = "windows")]
  {
    // Windows keeps the currently applied wallpaper in extensionless files
    // such as "TranscodedWallpaper" under the user's Themes folder.
    let windows_special = fname == "transcodedwallpaper"
      || fname.starts_with("transcoded_")
      || fname.starts_with("cachedimage_");
    if windows_special {
      return true;
    }
  }

  // Allow macOS' built-in thumbnail directory (fast UI previews).
  let in_macos_thumbnails = path
    .components()
    .any(|c| c.as_os_str().to_string_lossy().to_lowercase() == ".thumbnails");

  // Allow common image formats.
  // macOS dynamic wallpapers can be videos (e.g. .mov); we include those on macOS only.
  let valid_ext = {
    #[cfg(target_os = "macos")]
    {
      matches!(
        ext.as_str(),
        "jpg" | "jpeg" | "png" | "webp" | "bmp" | "heic" | "heif" | "avif" | "mov" | "mp4" | "m4v"
      )
    }
    #[cfg(not(target_os = "macos"))]
    {
      matches!(
        ext.as_str(),
        "jpg" | "jpeg" | "png" | "webp" | "bmp" | "heic" | "heif" | "avif"
      )
    }
  };
  // Exclude explicit thumbnail files, but do NOT exclude macOS' .thumbnails directory.
  let is_thumb = (fname.contains("thumb") || fname.contains("thumbnail") || path_str.contains("/thumb")) && !in_macos_thumbnails;

  valid_ext && !is_thumb
}

fn collect_images_recursive(root: &Path, out: &mut Vec<PathBuf>, max: usize) {
  if out.len() >= max {
    return;
  }
  if !root.exists() {
    return;
  }

  // Safety/perf: prevent runaway traversal.
  let max_depth: u8 = 10;
  let max_dirs: usize = 2_500;
  let mut visited_dirs: usize = 0;

  let mut stack: Vec<(PathBuf, u8)> = vec![(root.to_path_buf(), 0)];
  while let Some((dir, depth)) = stack.pop() {
    if out.len() >= max {
      break;
    }
    if visited_dirs >= max_dirs {
      break;
    }
    visited_dirs += 1;

    let entries = match std::fs::read_dir(&dir) {
      Ok(v) => v,
      Err(_) => continue,
    };
    for entry in entries.flatten() {
      if out.len() >= max {
        break;
      }
      let path = entry.path();

      // Skip symlinks to avoid cycles and accidental escapes.
      let ftype = match entry.file_type() {
        Ok(t) => t,
        Err(_) => continue,
      };
      if ftype.is_symlink() {
        continue;
      }

      if ftype.is_dir() {
        #[cfg(target_os = "macos")]
        {
          // Do not treat macOS internal wallpaper stores as generic subfolders when scanning
          // the visible Desktop Pictures root. We explicitly scan .wallpapers separately, and
          // .thumbnails are only for previews (not actual selectable assets).
          let dir_name = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();
          if dir_name == ".thumbnails" || dir_name == ".wallpapers" {
            continue;
          }
        }
        if depth < max_depth {
          stack.push((path, depth + 1));
        }
        continue;
      }

      if ftype.is_file() && is_wallpaper_image(&path) {
        out.push(path);
      }
    }
  }
}

#[tauri::command]
pub async fn wallpapers_list_system(args: ListSystemWallpapersArgs) -> Result<Vec<SystemWallpaperItem>, String> {
  let max = args.max_items.unwrap_or(300).clamp(1, 500) as usize;

  let mut roots: Vec<PathBuf> = vec![];

  #[cfg(target_os = "macos")]
  {
    // Modern macOS stores the actual assets under hidden subfolders.
    // - .wallpapers: full assets (often .heic/.png and also .mov for dynamic wallpapers)
    // - .thumbnails: small HEIC previews (fast to decode and good for UI)
    // Keep the root as a fallback for any directly-present images.
    // We intentionally only scan system wallpaper roots here (not user Pictures/library paths).
    roots.push(PathBuf::from("/System/Library/Desktop Pictures/.wallpapers"));
    roots.push(PathBuf::from("/System/Library/Desktop Pictures/.thumbnails"));
    roots.push(PathBuf::from("/System/Library/Desktop Pictures"));
    // Older macOS versions may use this location.
    roots.push(PathBuf::from("/Library/Desktop Pictures"));
  }

  #[cfg(target_os = "windows")]
  {
    roots.push(PathBuf::from(r"C:\Windows\Web\Wallpaper"));
    roots.push(PathBuf::from(r"C:\Windows\Web\Screen"));
    roots.push(PathBuf::from(r"C:\Windows\Web\4K\Wallpaper"));

    // User theme wallpaper locations.
    // Commonly contains TranscodedWallpaper / CachedFiles and user-selected images.
    if let Ok(appdata) = std::env::var("APPDATA") {
      let p = PathBuf::from(appdata).join("Microsoft").join("Windows").join("Themes");
      roots.push(p);
    }
    if let Ok(localappdata) = std::env::var("LOCALAPPDATA") {
      let p = PathBuf::from(localappdata).join("Microsoft").join("Windows").join("Themes");
      roots.push(p);
    }

    // Also include the currently configured wallpaper path from registry when available.
    // This catches custom/user-selected wallpapers outside the standard folders.
    if let Ok(output) = std::process::Command::new("reg")
      .args([
        "query",
        r"HKCU\Control Panel\Desktop",
        "/v",
        "WallPaper",
      ])
      .output()
    {
      if output.status.success() {
        let text = String::from_utf8_lossy(&output.stdout);
        for line in text.lines() {
          if !line.to_lowercase().contains("wallpaper") {
            continue;
          }
          // Typical format: <name>    REG_SZ    <value>
          let value = line
            .split("REG_SZ")
            .nth(1)
            .map(|s| s.trim())
            .unwrap_or("");
          if !value.is_empty() {
            let p = PathBuf::from(value);
            if p.is_file() {
              roots.push(p);
            } else if p.parent().is_some() {
              roots.push(p.parent().unwrap_or_else(|| Path::new("")).to_path_buf());
            }
          }
        }
      }
    }
  }

  #[cfg(target_os = "linux")]
  {
    roots.push(PathBuf::from("/usr/share/backgrounds"));
    roots.push(PathBuf::from("/usr/share/wallpapers"));
    roots.push(PathBuf::from("/usr/local/share/backgrounds"));
    roots.push(PathBuf::from("/usr/local/share/wallpapers"));

    // Per-user wallpaper locations used by common desktop environments.
    // GNOME: ~/.local/share/backgrounds
    // KDE:   ~/.local/share/wallpapers
    if let Ok(home) = std::env::var("HOME") {
      roots.push(PathBuf::from(&home).join(".local").join("share").join("backgrounds"));
      roots.push(PathBuf::from(&home).join(".local").join("share").join("wallpapers"));
    }

    // XDG user data dir override.
    if let Ok(xdg_data_home) = std::env::var("XDG_DATA_HOME") {
      roots.push(PathBuf::from(&xdg_data_home).join("backgrounds"));
      roots.push(PathBuf::from(&xdg_data_home).join("wallpapers"));
    }
  }

  let mut paths: Vec<PathBuf> = vec![];
  let mut seen: HashSet<String> = HashSet::new();

  for r in roots {
    let before = paths.len();
    collect_images_recursive(&r, &mut paths, max);

    // De-dupe by normalized string path (best-effort, avoids repeats when roots overlap).
    // Note: keep ordering stable by removing duplicates after each root scan.
    if paths.len() != before {
      let mut deduped: Vec<PathBuf> = Vec::with_capacity(paths.len());
      for p in paths.drain(..) {
        let key = p.to_string_lossy().to_lowercase();
        if seen.insert(key) {
          deduped.push(p);
        }
      }
      paths = deduped;
    }

    if paths.len() >= max {
      break;
    }
  }

  // Stable sort by filename for deterministic UI.
  paths.sort_by(|a, b| {
    let an = a.file_name().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
    let bn = b.file_name().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
    an.cmp(&bn)
  });

  let mut out: Vec<SystemWallpaperItem> = vec![];
  for p in paths.into_iter().take(max) {
    let name = p
      .file_name()
      .and_then(|s| s.to_str())
      .unwrap_or("Wallpaper")
      .to_string();
    out.push(SystemWallpaperItem {
      name,
      file_path: p.to_string_lossy().to_string(),
    });
  }
  Ok(out)
}

#[cfg(test)]
mod system_wallpapers_tests {
  use super::*;

  fn make_temp_dir(prefix: &str) -> PathBuf {
    let base = std::env::temp_dir();
    let dir = base.join(format!("{prefix}-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).expect("create temp dir");
    dir
  }

  fn touch_file(path: &Path) {
    if let Some(parent) = path.parent() {
      std::fs::create_dir_all(parent).expect("create parent dir");
    }
    std::fs::write(path, b"x").expect("write file");
  }

  #[test]
  fn is_wallpaper_image_accepts_common_formats_and_excludes_thumbs() {
    assert!(is_wallpaper_image(Path::new("/a/b/c.jpg")));
    assert!(is_wallpaper_image(Path::new("/a/b/c.jpeg")));
    assert!(is_wallpaper_image(Path::new("/a/b/c.png")));
    assert!(is_wallpaper_image(Path::new("/a/b/c.webp")));
    assert!(is_wallpaper_image(Path::new("/a/b/c.bmp")));
    assert!(is_wallpaper_image(Path::new("/a/b/c.heic")));
    assert!(is_wallpaper_image(Path::new("/a/b/c.avif")));

    assert!(!is_wallpaper_image(Path::new("/a/b/thumbs/c.jpg")));
    assert!(!is_wallpaper_image(Path::new("/a/b/c_thumb.png")));
    assert!(!is_wallpaper_image(Path::new("/a/b/c.thumb.png")));
    assert!(!is_wallpaper_image(Path::new("/a/b/c.txt")));
  }

  #[test]
  fn collect_images_recursive_respects_max_and_filters() {
    let dir = make_temp_dir("shotstyle-wallpaper-test");

    // Valid
    touch_file(&dir.join("one.jpg"));
    touch_file(&dir.join("sub/two.png"));

    // Invalid / excluded
    touch_file(&dir.join("thumbs/three.jpg"));
    touch_file(&dir.join("four.txt"));

    let mut out: Vec<PathBuf> = vec![];
    collect_images_recursive(&dir, &mut out, 1);
    assert_eq!(out.len(), 1);
    assert!(out[0].to_string_lossy().to_lowercase().ends_with("one.jpg") || out[0].to_string_lossy().to_lowercase().ends_with("two.png"));

    // Now collect with a higher max.
    let mut out2: Vec<PathBuf> = vec![];
    collect_images_recursive(&dir, &mut out2, 10);
    let paths = out2.iter().map(|p| p.to_string_lossy().to_lowercase()).collect::<Vec<_>>();
    assert!(paths.iter().any(|p| p.ends_with("one.jpg")));
    assert!(paths.iter().any(|p| p.ends_with("two.png")));
    assert!(!paths.iter().any(|p| p.contains("thumbs")));
    assert!(!paths.iter().any(|p| p.ends_with("four.txt")));

    let _ = std::fs::remove_dir_all(&dir);
  }
}

#[tauri::command]
pub async fn exports_save_to_downloads(app: tauri::AppHandle, args: SaveExportArgs) -> Result<SaveExportResult, String> {
  let (mime, bytes) = match decode_data_url(&args.data_url) {
    Ok(v) => v,
    Err(e) => {
      return Ok(SaveExportResult { ok: false, file_path: None, error: Some(e) })
    }
  };

  let base_dir = app
    .path()
    .download_dir()
    .or_else(|_| app.path().desktop_dir())
    .or_else(|_| app.path().app_data_dir())
    .map_err(|e| format!("Failed to resolve output directory: {e}"))?;

  let out_dir = base_dir.join("shot.style");
  fs::create_dir_all(&out_dir).map_err(|e| format!("Failed to create export dir: {e}"))?;

  let raw_name = sanitize_file_stem(&args.file_name);
  let requested_path = Path::new(&raw_name);
  let stem = requested_path
    .file_stem()
    .and_then(|s| s.to_str())
    .unwrap_or("shot.style")
    .to_string();

  let ext = requested_path
    .extension()
    .and_then(|s| s.to_str())
    .map(|s| s.to_lowercase())
    .filter(|s| s == "png" || s == "jpg" || s == "jpeg" || s == "webp")
    .unwrap_or_else(|| ext_from_mime(&mime).to_string());

  let file_name = if ext == "jpeg" { format!("{stem}.jpg") } else { format!("{stem}.{ext}") };
  let out_path = ensure_unique_path(out_dir.join(file_name));

  match fs::write(&out_path, bytes) {
    Ok(_) => Ok(SaveExportResult { ok: true, file_path: Some(out_path.to_string_lossy().to_string()), error: None }),
    Err(e) => Ok(SaveExportResult { ok: false, file_path: None, error: Some(format!("Failed to write file: {e}")) }),
  }
}

#[tauri::command]
pub async fn exports_save_to_path(_app: tauri::AppHandle, args: SaveExportToPathArgs) -> Result<SaveExportResult, String> {
  let (mime, bytes) = match decode_data_url(&args.data_url) {
    Ok(v) => v,
    Err(e) => {
      return Ok(SaveExportResult { ok: false, file_path: None, error: Some(e) })
    }
  };

  let mut out_path = PathBuf::from(args.file_path);

  // If the dialog returns a path without extension, add one based on the data URL MIME.
  let missing_ext = out_path
    .extension()
    .and_then(|s| s.to_str())
    .map(|s| s.trim().is_empty())
    .unwrap_or(true);

  if missing_ext {
    let ext = ext_from_mime(&mime);
    let ext = if ext == "jpeg" { "jpg" } else { ext };
    out_path.set_extension(ext);
  }

  if let Some(parent) = out_path.parent() {
    if !parent.as_os_str().is_empty() {
      fs::create_dir_all(parent).map_err(|e| format!("Failed to create output dir: {e}"))?;
    }
  }

  match fs::write(&out_path, bytes) {
    Ok(_) => Ok(SaveExportResult { ok: true, file_path: Some(out_path.to_string_lossy().to_string()), error: None }),
    Err(e) => Ok(SaveExportResult { ok: false, file_path: None, error: Some(format!("Failed to write file: {e}")) }),
  }
}

#[tauri::command]
pub async fn exports_save_to_folder(_app: tauri::AppHandle, args: SaveExportToFolderArgs) -> Result<SaveExportResult, String> {
  let (mime, bytes) = match decode_data_url(&args.data_url) {
    Ok(v) => v,
    Err(e) => {
      return Ok(SaveExportResult { ok: false, file_path: None, error: Some(e) })
    }
  };

  let folder = PathBuf::from(args.folder_path);
  if folder.as_os_str().is_empty() {
    return Ok(SaveExportResult { ok: false, file_path: None, error: Some("Missing folder path".to_string()) });
  }

  fs::create_dir_all(&folder).map_err(|e| format!("Failed to create output dir: {e}"))?;

  let raw_name = sanitize_file_stem(&args.file_name);
  let requested_path = Path::new(&raw_name);
  let stem = requested_path
    .file_stem()
    .and_then(|s| s.to_str())
    .unwrap_or("shot.style")
    .to_string();

  let ext = requested_path
    .extension()
    .and_then(|s| s.to_str())
    .map(|s| s.to_lowercase())
    .filter(|s| s == "png" || s == "jpg" || s == "jpeg" || s == "webp")
    .unwrap_or_else(|| ext_from_mime(&mime).to_string());

  let file_name = if ext == "jpeg" { format!("{stem}.jpg") } else { format!("{stem}.{ext}") };
  let out_path = ensure_unique_path(folder.join(file_name));

  match fs::write(&out_path, bytes) {
    Ok(_) => Ok(SaveExportResult { ok: true, file_path: Some(out_path.to_string_lossy().to_string()), error: None }),
    Err(e) => Ok(SaveExportResult { ok: false, file_path: None, error: Some(format!("Failed to write file: {e}")) }),
  }
}

#[tauri::command]
pub async fn exports_apply_watermark(_app: tauri::AppHandle, args: ApplyWatermarkArgs) -> Result<String, String> {
  let (base_mime, base_bytes) = decode_data_url(&args.base_data_url)?;
  let (_wm_mime, wm_bytes) = decode_data_url(&args.watermark_data_url)?;

  let mut base = image::load_from_memory(&base_bytes)
    .map_err(|e| format!("Failed to decode base image: {e}"))?
    .to_rgba8();

  let watermark = image::load_from_memory(&wm_bytes)
    .map_err(|e| format!("Failed to decode watermark image: {e}"))?
    .to_rgba8();

  let (base_w, base_h) = base.dimensions();
  let (wm_w, wm_h) = watermark.dimensions();

  let x0 = args.x.round().max(0.0) as i64;
  let y0 = args.y.round().max(0.0) as i64;

  for wy in 0..wm_h {
    let by = y0 + wy as i64;
    if by < 0 || by >= base_h as i64 { continue; }
    for wx in 0..wm_w {
      let bx = x0 + wx as i64;
      if bx < 0 || bx >= base_w as i64 { continue; }

      let wm_px = watermark.get_pixel(wx, wy);
      let wa = wm_px[3] as f32 / 255.0;
      if wa <= 0.0 { continue; }

      let base_px = base.get_pixel_mut(bx as u32, by as u32);
      let ba = base_px[3] as f32 / 255.0;

      let out_a = wa + (ba * (1.0 - wa));
      if out_a <= 0.0 {
        base_px.0 = [0, 0, 0, 0];
        continue;
      }

      let br = base_px[0] as f32 / 255.0;
      let bg = base_px[1] as f32 / 255.0;
      let bb = base_px[2] as f32 / 255.0;
      let wr = wm_px[0] as f32 / 255.0;
      let wg = wm_px[1] as f32 / 255.0;
      let wb = wm_px[2] as f32 / 255.0;

      let out_r = (wr * wa + br * ba * (1.0 - wa)) / out_a;
      let out_g = (wg * wa + bg * ba * (1.0 - wa)) / out_a;
      let out_b = (wb * wa + bb * ba * (1.0 - wa)) / out_a;

      base_px[0] = (out_r * 255.0).round().clamp(0.0, 255.0) as u8;
      base_px[1] = (out_g * 255.0).round().clamp(0.0, 255.0) as u8;
      base_px[2] = (out_b * 255.0).round().clamp(0.0, 255.0) as u8;
      base_px[3] = (out_a * 255.0).round().clamp(0.0, 255.0) as u8;
    }
  }

  let format = if base_mime.to_lowercase().contains("jpeg") || base_mime.to_lowercase().contains("jpg") {
    image::ImageFormat::Jpeg
  } else if base_mime.to_lowercase().contains("webp") {
    image::ImageFormat::WebP
  } else {
    image::ImageFormat::Png
  };

  let mut out: Vec<u8> = Vec::new();
  let dyn_img = image::DynamicImage::ImageRgba8(base);
  dyn_img
    .write_to(&mut Cursor::new(&mut out), format)
    .map_err(|e| format!("Failed to encode output image: {e}"))?;

  Ok(bytes_to_data_url(&base_mime, &out))
}
