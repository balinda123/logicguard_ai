use std::fs;
use tauri::command;
use tauri::Manager;

#[command]
pub fn save_reports_to_file(app: tauri::AppHandle, data: String) -> Result<(), String> {
  let mut path = app.path().app_data_dir().map_err(|e| e.to_string())?;
  fs::create_dir_all(&path).map_err(|e| e.to_string())?;
  path.push("logicguard_reports.json");
  fs::write(path, data).map_err(|e| e.to_string())?;
  Ok(())
}

#[command]
pub fn load_reports_from_file(app: tauri::AppHandle) -> Result<String, String> {
  let mut path = app.path().app_data_dir().map_err(|e| e.to_string())?;
  path.push("logicguard_reports.json");
  if !path.exists() {
    return Ok("[]".to_string());
  }
  let data = fs::read_to_string(path).map_err(|e| e.to_string())?;
  Ok(data)
}
