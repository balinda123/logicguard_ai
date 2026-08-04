use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

const MIGRATION_VERSION: &str = "test-design-v1";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LegacyRecord {
    pub source_key: String,
    pub kind: String,
    pub login_url: Option<String>,
    pub data: Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LegacyMigrationPayload {
    pub default_system_name: String,
    pub shared_test_base_url: Option<String>,
    pub records: Vec<LegacyRecord>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LegacyMigrationResult {
    pub migration_version: String,
    pub imported_records: usize,
    pub imported_cases: usize,
    pub quarantined_records: usize,
    pub verified: bool,
}

fn initialize_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS legacy_import_records (
           owner_id TEXT NOT NULL REFERENCES users(id),
           source_key TEXT NOT NULL,
           kind TEXT NOT NULL,
           payload_json TEXT NOT NULL,
           imported_entity_id TEXT,
           created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
           PRIMARY KEY(owner_id, source_key)
         );
         CREATE TABLE IF NOT EXISTS migration_quarantine (
           id TEXT PRIMARY KEY,
           owner_id TEXT NOT NULL REFERENCES users(id),
           source_key TEXT NOT NULL,
           kind TEXT NOT NULL,
           reason TEXT NOT NULL,
           payload_json TEXT NOT NULL,
           created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
           UNIQUE(owner_id, source_key)
         );
         CREATE TABLE IF NOT EXISTS migration_markers (
           owner_id TEXT NOT NULL REFERENCES users(id),
           migration_version TEXT NOT NULL,
           source_count INTEGER NOT NULL,
           imported_count INTEGER NOT NULL,
           quarantined_count INTEGER NOT NULL,
           reconciled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
           PRIMARY KEY(owner_id, migration_version)
         );",
    )
    .map_err(|error| error.to_string())
}

fn origin(raw: &str) -> Option<(String, String)> {
    let url = reqwest::Url::parse(raw).ok()?;
    let host = url.host_str()?.to_ascii_lowercase();
    let port = url.port().map(|value| format!(":{value}")).unwrap_or_default();
    Some((host, format!("{}://{}{}", url.scheme(), url.host_str()?, port)))
}

fn classify_environment(login_url: Option<&str>, shared_url: Option<&str>) -> Option<(&'static str, String)> {
    if let Some(raw) = login_url {
        let (host, base_url) = origin(raw)?;
        if matches!(host.as_str(), "localhost" | "127.0.0.1" | "::1") {
            return Some(("local", base_url));
        }
        let shared_host = shared_url.and_then(origin).map(|value| value.0);
        if shared_host.as_deref() == Some(host.as_str()) {
            return Some(("test", shared_url.and_then(origin).map(|value| value.1).unwrap_or(base_url)));
        }
        return None;
    }
    shared_url.and_then(origin).map(|value| ("test", value.1))
}

fn ensure_scope(tx: &rusqlite::Transaction<'_>, system_name: &str, kind: &str, base_url: &str) -> Result<(String, String), String> {
    let system_id = tx
        .query_row("SELECT id FROM systems WHERE name=?1 COLLATE NOCASE", [system_name], |row| row.get(0))
        .optional()
        .map_err(|error| error.to_string())?
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    tx.execute(
        "INSERT OR IGNORE INTO systems(id,name) VALUES(?1,?2)",
        params![system_id, system_name],
    )
    .map_err(|error| error.to_string())?;
    let environment_id = tx
        .query_row(
            "SELECT id FROM system_environments WHERE system_id=?1 AND kind=?2 AND base_url=?3",
            params![system_id, kind, base_url],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let name = if kind == "local" { "本地启动" } else { "测试环境" };
    tx.execute(
        "INSERT OR IGNORE INTO system_environments(id,system_id,kind,name,base_url) VALUES(?1,?2,?3,?4,?5)",
        params![environment_id, system_id, kind, name, base_url],
    )
    .map_err(|error| error.to_string())?;
    Ok((system_id, environment_id))
}

fn import_case(
    tx: &rusqlite::Transaction<'_>,
    owner_id: &str,
    record: &LegacyRecord,
    system_id: &str,
    environment_id: &str,
) -> Result<String, String> {
    let module = record.data.get("module").and_then(Value::as_str).unwrap_or("未分类");
    let title = format!("历史导入设计单 · {module}");
    let design_id = tx
        .query_row(
            "SELECT id FROM test_designs WHERE owner_id=?1 AND environment_id=?2 AND title=?3",
            params![owner_id, environment_id, title],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    tx.execute(
        "INSERT OR IGNORE INTO test_designs(id,owner_id,system_id,environment_id,title,status) VALUES(?1,?2,?3,?4,?5,'historical')",
        params![design_id, owner_id, system_id, environment_id, title],
    )
    .map_err(|error| error.to_string())?;
    let requirement_id = tx
        .query_row(
            "SELECT id FROM requirement_versions WHERE design_id=?1 ORDER BY version_no LIMIT 1",
            [&design_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    tx.execute(
        "INSERT OR IGNORE INTO requirement_versions(id,design_id,version_no,source_kind,content) VALUES(?1,?2,1,'legacy','历史导入数据（原始需求缺失）')",
        params![requirement_id, design_id],
    )
    .map_err(|error| error.to_string())?;
    tx.execute(
        "UPDATE test_designs SET current_requirement_version_id=?1 WHERE id=?2 AND current_requirement_version_id IS NULL",
        params![requirement_id, design_id],
    )
    .map_err(|error| error.to_string())?;
    let case_id = Uuid::new_v4().to_string();
    let status = record.data.get("status").and_then(Value::as_str).filter(|value| matches!(*value, "draft" | "confirmed" | "archived")).unwrap_or("draft");
    tx.execute(
        "INSERT INTO test_cases(id,design_id,requirement_version_id,payload_json,status,legacy_source_key) VALUES(?1,?2,?3,?4,?5,?6)",
        params![case_id, design_id, requirement_id, record.data.to_string(), status, record.source_key],
    )
    .map_err(|error| error.to_string())?;
    Ok(case_id)
}

pub(crate) fn import(
    conn: &mut Connection,
    owner_id: &str,
    payload: &LegacyMigrationPayload,
) -> Result<LegacyMigrationResult, String> {
    crate::test_design::initialize_schema(conn)?;
    initialize_schema(conn)?;
    if payload.default_system_name.trim().is_empty() {
        return Err("DEFAULT_SYSTEM_NAME_REQUIRED".to_string());
    }
    let transaction = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|error| error.to_string())?;
    let mut imported_records = 0usize;
    let mut imported_cases = 0usize;
    let mut quarantined_records = 0usize;

    for record in &payload.records {
        if record.source_key.trim().is_empty() || !matches!(record.kind.as_str(), "case" | "suite" | "report") {
            return Err("INVALID_LEGACY_RECORD".to_string());
        }
        let already_seen: Option<i64> = transaction
            .query_row("SELECT 1 FROM legacy_import_records WHERE owner_id=?1 AND source_key=?2 UNION SELECT 1 FROM migration_quarantine WHERE owner_id=?1 AND source_key=?2", params![owner_id, record.source_key], |row| row.get(0))
            .optional()
            .map_err(|error| error.to_string())?;
        if already_seen.is_some() {
            continue;
        }
        let Some((kind, base_url)) = classify_environment(record.login_url.as_deref(), payload.shared_test_base_url.as_deref()) else {
            transaction.execute(
                "INSERT INTO migration_quarantine(id,owner_id,source_key,kind,reason,payload_json) VALUES(?1,?2,?3,?4,'ENVIRONMENT_UNRESOLVED',?5)",
                params![Uuid::new_v4().to_string(), owner_id, record.source_key, record.kind, record.data.to_string()],
            ).map_err(|error| error.to_string())?;
            quarantined_records += 1;
            continue;
        };
        let (system_id, environment_id) = ensure_scope(&transaction, payload.default_system_name.trim(), kind, &base_url)?;
        let imported_entity_id = if record.kind == "case" {
            imported_cases += 1;
            Some(import_case(&transaction, owner_id, record, &system_id, &environment_id)?)
        } else {
            None
        };
        transaction.execute(
            "INSERT INTO legacy_import_records(owner_id,source_key,kind,payload_json,imported_entity_id) VALUES(?1,?2,?3,?4,?5)",
            params![owner_id, record.source_key, record.kind, record.data.to_string(), imported_entity_id],
        ).map_err(|error| error.to_string())?;
        imported_records += 1;
    }

    let accounted: i64 = transaction.query_row(
        "SELECT (SELECT COUNT(*) FROM legacy_import_records WHERE owner_id=?1) + (SELECT COUNT(*) FROM migration_quarantine WHERE owner_id=?1)",
        [owner_id],
        |row| row.get(0),
    ).map_err(|error| error.to_string())?;
    let unique_source_count: i64 = transaction.query_row(
        "SELECT COUNT(DISTINCT source_key) FROM (SELECT source_key FROM legacy_import_records WHERE owner_id=?1 UNION ALL SELECT source_key FROM migration_quarantine WHERE owner_id=?1)",
        [owner_id],
        |row| row.get(0),
    ).map_err(|error| error.to_string())?;
    let verified = accounted == unique_source_count;
    if !verified {
        return Err("MIGRATION_RECONCILIATION_FAILED".to_string());
    }
    transaction.execute(
        "INSERT INTO migration_markers(owner_id,migration_version,source_count,imported_count,quarantined_count) VALUES(?1,?2,?3,(SELECT COUNT(*) FROM legacy_import_records WHERE owner_id=?1),(SELECT COUNT(*) FROM migration_quarantine WHERE owner_id=?1)) ON CONFLICT(owner_id,migration_version) DO UPDATE SET source_count=excluded.source_count,imported_count=excluded.imported_count,quarantined_count=excluded.quarantined_count,reconciled_at=CURRENT_TIMESTAMP",
        params![owner_id, MIGRATION_VERSION, unique_source_count],
    ).map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;

    Ok(LegacyMigrationResult {
        migration_version: MIGRATION_VERSION.to_string(),
        imported_records,
        imported_cases,
        quarantined_records,
        verified,
    })
}

#[tauri::command]
pub fn import_legacy_test_data(
    app: tauri::AppHandle,
    payload: LegacyMigrationPayload,
) -> Result<LegacyMigrationResult, String> {
    let owner = crate::auth::current_user_id()?;
    let mut conn = crate::auth::open_db(&app)?;
    import(&mut conn, &owner, &payload)
}
