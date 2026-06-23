use std::fs;
use tauri::command;
use tauri::Manager;

#[command]
pub fn save_reports_to_file(app: tauri::AppHandle, data: String) -> Result<(), String> {
  let user_id = crate::auth::current_user_id()?;
  let parsed: serde_json::Value = serde_json::from_str(&data).map_err(|e| format!("报告数据格式错误: {}", e))?;
  if !parsed.is_array() { return Err("报告数据必须是数组".to_string()); }
  let mut path = app.path().app_data_dir().map_err(|e| e.to_string())?;
  fs::create_dir_all(&path).map_err(|e| e.to_string())?;
  path.push(format!("logicguard_reports_{}.json", user_id));
  let temp_path = path.with_extension("json.tmp");
  fs::write(&temp_path, data).map_err(|e| e.to_string())?;
  if path.exists() { fs::remove_file(&path).map_err(|e| e.to_string())?; }
  fs::rename(temp_path, path).map_err(|e| e.to_string())?;
  Ok(())
}

#[command]
pub fn load_reports_from_file(app: tauri::AppHandle) -> Result<String, String> {
  let user_id = crate::auth::current_user_id()?;
  let mut path = app.path().app_data_dir().map_err(|e| e.to_string())?;
  path.push(format!("logicguard_reports_{}.json", user_id));
  if !path.exists() {
    return Ok("[]".to_string());
  }
  let data = fs::read_to_string(path).map_err(|e| e.to_string())?;
  Ok(data)
}
