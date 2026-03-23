fn main() {
  // On macOS, Rust/tauri may use `copyfile(3)` under the hood when copying files.
  // If the target directory is on a filesystem that doesn't support extended
  // attributes (common on external build volumes), macOS can emit AppleDouble
  // sidecar files like `._default.json`, which then get picked up and parsed as
  // JSON and fail with "stream did not contain valid UTF-8".
  std::env::set_var("COPYFILE_DISABLE", "1");

  tauri_build::build()
}
