use serde::Serialize;
use std::process::Command;
use tauri::Manager;

use crate::auth;

const CREDENTIAL_SERVICE: &str = "com.logicguard.ai";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageLocations {
    pub app_data_dir: String,
    pub users_db_path: String,
    pub current_user_report_path: String,
    pub chrome_profile_dir: String,
    pub credential_service: String,
    pub credential_account: String,
    pub local_storage_note: String,
}

#[tauri::command]
pub fn get_storage_locations(app: tauri::AppHandle) -> Result<StorageLocations, String> {
    let user = auth::current_user()?;
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;

    Ok(StorageLocations {
        app_data_dir: app_data_dir.display().to_string(),
        users_db_path: app_data_dir.join("logicguard.db").display().to_string(),
        current_user_report_path: app_data_dir
            .join(format!("logicguard_reports_{}.json", user.id))
            .display()
            .to_string(),
        chrome_profile_dir: app_data_dir.join("ChromeProfile").display().to_string(),
        credential_service: CREDENTIAL_SERVICE.to_string(),
        credential_account: user.id,
        local_storage_note: "Tauri WebView localStorage，按当前用户 UUID 命名空间隔离；存放模板、模型名称、Base URL、CDP 端口等非敏感配置。".to_string(),
    })
}

#[tauri::command]
pub fn open_app_data_dir(app: tauri::AppHandle) -> Result<(), String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut cmd = Command::new("explorer.exe");
        cmd.arg(&app_data_dir);
        cmd
    };

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut cmd = Command::new("open");
        cmd.arg(&app_data_dir);
        cmd
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut cmd = Command::new("xdg-open");
        cmd.arg(&app_data_dir);
        cmd
    };

    command.spawn().map_err(|e| format!("打开数据目录失败: {}", e))?;
    Ok(())
}
