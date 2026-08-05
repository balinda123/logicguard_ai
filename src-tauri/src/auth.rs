use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::sync::{Mutex, OnceLock};
use tauri::Manager;
use uuid::Uuid;

const CREDENTIAL_SERVICE: &str = "com.logicguard.ai";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionUser {
    pub id: String,
    pub username: String,
    pub role: String,
    pub disabled: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus {
    pub initialized: bool,
    pub user: Option<SessionUser>,
}

fn session() -> &'static Mutex<Option<SessionUser>> {
    static SESSION: OnceLock<Mutex<Option<SessionUser>>> = OnceLock::new();
    SESSION.get_or_init(|| Mutex::new(None))
}

pub(crate) fn open_db(app: &tauri::AppHandle) -> Result<Connection, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut conn = Connection::open(dir.join("logicguard.db")).map_err(|e| e.to_string())?;
    conn.execute_batch(
        "PRAGMA foreign_keys=ON;
         CREATE TABLE IF NOT EXISTS users (
           id TEXT PRIMARY KEY,
           username TEXT NOT NULL UNIQUE COLLATE NOCASE,
           password_hash TEXT NOT NULL,
           role TEXT NOT NULL CHECK(role IN ('admin','user')),
           disabled INTEGER NOT NULL DEFAULT 0,
           created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
         );",
    )
    .map_err(|e| e.to_string())?;
    crate::testing::initialize_schema(&conn)?;
    crate::test_design::initialize_schema(&conn)?;
    crate::test_design::ensure_trial_management_scope(&mut conn)?;
    Ok(conn)
}

fn hash_password(password: &str) -> Result<String, String> {
    if password.len() < 8 {
        return Err("密码至少需要 8 个字符".to_string());
    }
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|e| e.to_string())
}

pub(crate) fn require_admin() -> Result<SessionUser, String> {
    let user = current_user()?;
    if user.role != "admin" {
        return Err("仅管理员可以执行此操作".to_string());
    }
    Ok(user)
}

pub fn current_user() -> Result<SessionUser, String> {
    session()
        .lock()
        .map_err(|_| "会话锁异常".to_string())?
        .clone()
        .ok_or_else(|| "AUTH_REQUIRED: 请先登录".to_string())
}

pub fn current_user_id() -> Result<String, String> {
    Ok(current_user()?.id)
}

pub fn current_api_key() -> Result<String, String> {
    let user = current_user()?;
    keyring::Entry::new(CREDENTIAL_SERVICE, &user.id)
        .map_err(|e| format!("凭据库初始化失败: {}", e))?
        .get_password()
        .map_err(|_| "KEY_MISSING: 请在系统设置中配置 API Key".to_string())
}

#[tauri::command]
pub fn auth_status(app: tauri::AppHandle) -> Result<AuthStatus, String> {
    let conn = open_db(&app)?;
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let user = session()
        .lock()
        .map_err(|_| "会话锁异常".to_string())?
        .clone();
    Ok(AuthStatus {
        initialized: count > 0,
        user,
    })
}

#[tauri::command]
pub fn initialize_admin(
    app: tauri::AppHandle,
    username: String,
    password: String,
) -> Result<SessionUser, String> {
    let conn = open_db(&app)?;
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if count > 0 {
        return Err("管理员已经初始化".to_string());
    }
    let user = SessionUser {
        id: Uuid::new_v4().to_string(),
        username: username.trim().to_string(),
        role: "admin".to_string(),
        disabled: false,
    };
    if user.username.len() < 3 {
        return Err("用户名至少需要 3 个字符".to_string());
    }
    let hash = hash_password(&password)?;
    conn.execute(
        "INSERT INTO users(id,username,password_hash,role) VALUES(?1,?2,?3,'admin')",
        params![user.id, user.username, hash],
    )
    .map_err(|e| e.to_string())?;
    *session().lock().map_err(|_| "会话锁异常".to_string())? = Some(user.clone());
    Ok(user)
}

#[tauri::command]
pub fn login(
    app: tauri::AppHandle,
    username: String,
    password: String,
) -> Result<SessionUser, String> {
    let conn = open_db(&app)?;
    let row: Option<(String, String, String, String, i64)> = conn
        .query_row(
            "SELECT id,username,password_hash,role,disabled FROM users WHERE username=?1",
            [username.trim()],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let (id, username, hash, role, disabled) = row.ok_or_else(|| "用户名或密码错误".to_string())?;
    if disabled != 0 {
        return Err("该账号已被禁用".to_string());
    }
    let parsed = PasswordHash::new(&hash).map_err(|_| "密码数据损坏".to_string())?;
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .map_err(|_| "用户名或密码错误".to_string())?;
    let user = SessionUser {
        id,
        username,
        role,
        disabled: false,
    };
    *session().lock().map_err(|_| "会话锁异常".to_string())? = Some(user.clone());
    Ok(user)
}

#[tauri::command]
pub fn logout() -> Result<(), String> {
    *session().lock().map_err(|_| "会话锁异常".to_string())? = None;
    Ok(())
}

#[tauri::command]
pub fn list_users(app: tauri::AppHandle) -> Result<Vec<SessionUser>, String> {
    require_admin()?;
    let conn = open_db(&app)?;
    let mut stmt = conn
        .prepare("SELECT id,username,role,disabled FROM users ORDER BY disabled, role, username")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(SessionUser {
                id: r.get(0)?,
                username: r.get(1)?,
                role: r.get(2)?,
                disabled: r.get::<_, i64>(3)? != 0,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_user(
    app: tauri::AppHandle,
    username: String,
    password: String,
) -> Result<SessionUser, String> {
    require_admin()?;
    if username.trim().len() < 3 {
        return Err("用户名至少需要 3 个字符".to_string());
    }
    let user = SessionUser {
        id: Uuid::new_v4().to_string(),
        username: username.trim().to_string(),
        role: "user".to_string(),
        disabled: false,
    };
    let hash = hash_password(&password)?;
    open_db(&app)?
        .execute(
            "INSERT INTO users(id,username,password_hash,role) VALUES(?1,?2,?3,'user')",
            params![user.id, user.username, hash],
        )
        .map_err(|e| e.to_string())?;
    Ok(user)
}

#[tauri::command]
pub fn disable_user(app: tauri::AppHandle, user_id: String) -> Result<(), String> {
    let admin = require_admin()?;
    if admin.id == user_id {
        return Err("不能禁用当前管理员".to_string());
    }
    open_db(&app)?
        .execute("UPDATE users SET disabled=1 WHERE id=?1", [user_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn reset_user_password(
    app: tauri::AppHandle,
    user_id: String,
    password: String,
) -> Result<(), String> {
    require_admin()?;
    let hash = hash_password(&password)?;
    open_db(&app)?
        .execute(
            "UPDATE users SET password_hash=?1 WHERE id=?2",
            params![hash, user_id],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn save_api_key(api_key: String) -> Result<(), String> {
    if api_key.trim().len() < 10 {
        return Err("API Key 格式不正确".to_string());
    }
    let user = current_user()?;
    keyring::Entry::new(CREDENTIAL_SERVICE, &user.id)
        .map_err(|e| e.to_string())?
        .set_password(api_key.trim())
        .map_err(|e| format!("保存系统凭据失败: {}", e))
}

#[tauri::command]
pub fn credential_status() -> Result<bool, String> {
    Ok(current_api_key().is_ok())
}
