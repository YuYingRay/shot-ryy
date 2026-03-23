use std::process::Command;

pub fn open_url(url: &str) -> Result<(), String> {
  let launchers: [(&str, &[&str]); 3] = [
    ("xdg-open", &[url]),
    ("gio", &["open", url]),
    ("sensible-browser", &[url]),
  ];

  let mut last_error: Option<String> = None;
  for (bin, args) in launchers {
    match Command::new(bin).args(args).spawn() {
      Ok(_) => return Ok(()),
      Err(err) => last_error = Some(format!("{bin}: {err}")),
    }
  }

  Err(format!(
    "Failed to open browser with known launchers ({})",
    last_error.unwrap_or_else(|| "unknown launcher error".to_string())
  ))
}
