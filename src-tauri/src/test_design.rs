use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

const ENVIRONMENT_KINDS: &[&str] = &["local", "test"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestSystem {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemEnvironment {
    pub id: String,
    pub system_id: String,
    pub kind: String,
    pub name: String,
    pub base_url: String,
    pub is_enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestDesign {
    pub id: String,
    pub system_id: String,
    pub environment_id: String,
    pub title: String,
    pub status: String,
    pub current_requirement_version_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequirementVersion {
    pub id: String,
    pub design_id: String,
    pub version_no: i64,
    pub source_kind: String,
    pub content: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationBatch {
    pub id: String,
    pub design_id: String,
    pub requirement_version_id: String,
    pub model: String,
    pub template_id: Option<String>,
    pub is_stale: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewRecord {
    pub id: String,
    pub design_id: String,
    pub generation_batch_id: String,
    pub reviewer_id: String,
    pub conclusion: String,
    pub change_summary: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegressionConfig {
    pub id: String,
    pub design_id: String,
    pub suite_id: Option<String>,
    pub account_combination_id: Option<String>,
    pub case_ids_json: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateTestSystemInput {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateEnvironmentInput {
    pub system_id: String,
    pub kind: String,
    pub name: String,
    pub base_url: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateEnvironmentInput {
    pub id: String,
    pub system_id: String,
    pub kind: String,
    pub name: String,
    pub base_url: String,
    pub is_enabled: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateTestDesignInput {
    pub system_id: String,
    pub environment_id: String,
    pub title: String,
    pub status: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateTestDesignInput {
    pub id: String,
    pub system_id: String,
    pub environment_id: String,
    pub title: String,
    pub status: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateRequirementVersionInput {
    pub design_id: String,
    pub source_kind: String,
    pub content: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateGenerationBatchInput {
    pub design_id: String,
    pub requirement_version_id: String,
    pub model: String,
    pub template_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateReviewRecordInput {
    pub design_id: String,
    pub generation_batch_id: String,
    pub conclusion: String,
    pub change_summary: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateRegressionConfigInput {
    pub design_id: String,
    pub suite_id: Option<String>,
    pub account_combination_id: Option<String>,
    pub case_ids_json: String,
}

fn db_error(_: rusqlite::Error) -> String {
    "DATABASE_OPERATION_FAILED".to_string()
}

fn required(value: &str, field: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        Err(format!("{field}_REQUIRED"))
    } else {
        Ok(())
    }
}

fn ensure_admin_role(actor_role: &str) -> Result<(), String> {
    if actor_role == "admin" {
        Ok(())
    } else {
        Err("ADMIN_REQUIRED".to_string())
    }
}

fn validate_environment(kind: &str, name: &str, base_url: &str) -> Result<(), String> {
    if !ENVIRONMENT_KINDS.contains(&kind) {
        return Err("INVALID_ENVIRONMENT_KIND".to_string());
    }
    required(name, "ENVIRONMENT_NAME")?;
    let url = reqwest::Url::parse(base_url).map_err(|_| "INVALID_BASE_URL".to_string())?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("INVALID_BASE_URL".to_string());
    }
    Ok(())
}

fn validate_case_ids_json(value: &str) -> Result<(), String> {
    let parsed: Value =
        serde_json::from_str(value).map_err(|_| "INVALID_CASE_IDS_JSON".to_string())?;
    if parsed
        .as_array()
        .is_some_and(|items| items.iter().all(Value::is_string))
    {
        Ok(())
    } else {
        Err("INVALID_CASE_IDS_JSON".to_string())
    }
}

fn read_system(row: &Row<'_>) -> rusqlite::Result<TestSystem> {
    Ok(TestSystem {
        id: row.get(0)?,
        name: row.get(1)?,
        created_at: row.get(2)?,
        updated_at: row.get(3)?,
    })
}

fn read_environment(row: &Row<'_>) -> rusqlite::Result<SystemEnvironment> {
    Ok(SystemEnvironment {
        id: row.get(0)?,
        system_id: row.get(1)?,
        kind: row.get(2)?,
        name: row.get(3)?,
        base_url: row.get(4)?,
        is_enabled: row.get::<_, i64>(5)? != 0,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

fn read_design(row: &Row<'_>) -> rusqlite::Result<TestDesign> {
    Ok(TestDesign {
        id: row.get(0)?,
        system_id: row.get(1)?,
        environment_id: row.get(2)?,
        title: row.get(3)?,
        status: row.get(4)?,
        current_requirement_version_id: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

fn read_requirement_version(row: &Row<'_>) -> rusqlite::Result<RequirementVersion> {
    Ok(RequirementVersion {
        id: row.get(0)?,
        design_id: row.get(1)?,
        version_no: row.get(2)?,
        source_kind: row.get(3)?,
        content: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

fn read_generation_batch(row: &Row<'_>) -> rusqlite::Result<GenerationBatch> {
    Ok(GenerationBatch {
        id: row.get(0)?,
        design_id: row.get(1)?,
        requirement_version_id: row.get(2)?,
        model: row.get(3)?,
        template_id: row.get(4)?,
        is_stale: row.get::<_, i64>(5)? != 0,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

fn read_review_record(row: &Row<'_>) -> rusqlite::Result<ReviewRecord> {
    Ok(ReviewRecord {
        id: row.get(0)?,
        design_id: row.get(1)?,
        generation_batch_id: row.get(2)?,
        reviewer_id: row.get(3)?,
        conclusion: row.get(4)?,
        change_summary: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

fn read_regression_config(row: &Row<'_>) -> rusqlite::Result<RegressionConfig> {
    Ok(RegressionConfig {
        id: row.get(0)?,
        design_id: row.get(1)?,
        suite_id: row.get(2)?,
        account_combination_id: row.get(3)?,
        case_ids_json: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

pub(crate) fn initialize_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS systems (
           id TEXT PRIMARY KEY,
           name TEXT NOT NULL UNIQUE COLLATE NOCASE,
           created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
           updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
         );
         CREATE TABLE IF NOT EXISTS system_environments (
           id TEXT PRIMARY KEY,
           system_id TEXT NOT NULL REFERENCES systems(id),
           kind TEXT NOT NULL CHECK(kind IN ('local','test')),
           name TEXT NOT NULL,
           base_url TEXT NOT NULL,
           is_enabled INTEGER NOT NULL DEFAULT 1 CHECK(is_enabled IN (0,1)),
           created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
           updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
           UNIQUE(system_id, name COLLATE NOCASE),
           UNIQUE(id, system_id)
         );
         CREATE TABLE IF NOT EXISTS test_designs (
           id TEXT PRIMARY KEY,
           owner_id TEXT NOT NULL REFERENCES users(id),
           system_id TEXT NOT NULL REFERENCES systems(id),
           environment_id TEXT NOT NULL,
           title TEXT NOT NULL,
           status TEXT NOT NULL,
           current_requirement_version_id TEXT,
           created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
           updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
           FOREIGN KEY(environment_id, system_id) REFERENCES system_environments(id, system_id),
           FOREIGN KEY(current_requirement_version_id, id) REFERENCES requirement_versions(id, design_id),
           UNIQUE(id, owner_id),
           UNIQUE(owner_id, environment_id, title COLLATE NOCASE)
         );
         CREATE TABLE IF NOT EXISTS requirement_versions (
           id TEXT PRIMARY KEY,
           design_id TEXT NOT NULL REFERENCES test_designs(id),
           version_no INTEGER NOT NULL CHECK(version_no > 0),
           source_kind TEXT NOT NULL,
           content TEXT NOT NULL,
           created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
           updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
           UNIQUE(design_id, version_no),
           UNIQUE(id, design_id)
         );
         CREATE TABLE IF NOT EXISTS generation_batches (
           id TEXT PRIMARY KEY,
           design_id TEXT NOT NULL REFERENCES test_designs(id),
           requirement_version_id TEXT NOT NULL,
           model TEXT NOT NULL,
           template_id TEXT,
           created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
           updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
           FOREIGN KEY(requirement_version_id, design_id) REFERENCES requirement_versions(id, design_id),
           UNIQUE(id, design_id)
         );
         CREATE TABLE IF NOT EXISTS review_records (
           id TEXT PRIMARY KEY,
           design_id TEXT NOT NULL REFERENCES test_designs(id),
           generation_batch_id TEXT NOT NULL,
           reviewer_id TEXT NOT NULL REFERENCES users(id),
           conclusion TEXT NOT NULL,
           change_summary TEXT NOT NULL,
           created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
           updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
           FOREIGN KEY(generation_batch_id, design_id) REFERENCES generation_batches(id, design_id)
         );
         CREATE TABLE IF NOT EXISTS regression_configs (
           id TEXT PRIMARY KEY,
           design_id TEXT NOT NULL UNIQUE REFERENCES test_designs(id),
           suite_id TEXT,
           account_combination_id TEXT,
           case_ids_json TEXT NOT NULL,
           created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
           updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
         );
         CREATE INDEX IF NOT EXISTS idx_environments_system ON system_environments(system_id, is_enabled);
         CREATE INDEX IF NOT EXISTS idx_designs_owner_scope ON test_designs(owner_id, system_id, environment_id);
         CREATE INDEX IF NOT EXISTS idx_requirement_versions_design ON requirement_versions(design_id, version_no DESC);
         CREATE INDEX IF NOT EXISTS idx_generation_batches_design ON generation_batches(design_id, created_at DESC);
         CREATE INDEX IF NOT EXISTS idx_review_records_design ON review_records(design_id, created_at DESC);",
    )
    .map_err(db_error)
}

fn get_system(conn: &Connection, id: &str) -> Result<TestSystem, String> {
    conn.query_row(
        "SELECT id, name, created_at, updated_at FROM systems WHERE id=?1",
        [id],
        read_system,
    )
    .optional()
    .map_err(db_error)?
    .ok_or_else(|| "NOT_FOUND".to_string())
}

pub(crate) fn list_systems_record(conn: &Connection) -> Result<Vec<TestSystem>, String> {
    let mut statement = conn
        .prepare("SELECT id, name, created_at, updated_at FROM systems ORDER BY name")
        .map_err(db_error)?;
    let result = statement
        .query_map([], read_system)
        .map_err(db_error)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(db_error);
    result
}

pub(crate) fn create_system_record(
    conn: &Connection,
    actor_role: &str,
    name: &str,
) -> Result<TestSystem, String> {
    ensure_admin_role(actor_role)?;
    required(name, "SYSTEM_NAME")?;
    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO systems(id, name) VALUES(?1, ?2)",
        params![id, name.trim()],
    )
    .map_err(db_error)?;
    get_system(conn, &id)
}

pub(crate) fn update_system_record(
    conn: &Connection,
    actor_role: &str,
    input: &UpdateTestSystemInput,
) -> Result<TestSystem, String> {
    ensure_admin_role(actor_role)?;
    required(&input.name, "SYSTEM_NAME")?;
    let changed = conn
        .execute(
            "UPDATE systems SET name=?1, updated_at=CURRENT_TIMESTAMP WHERE id=?2",
            params![input.name.trim(), input.id],
        )
        .map_err(db_error)?;
    if changed == 0 {
        return Err("NOT_FOUND".to_string());
    }
    get_system(conn, &input.id)
}

fn get_environment(conn: &Connection, id: &str) -> Result<SystemEnvironment, String> {
    conn.query_row(
        "SELECT id, system_id, kind, name, base_url, is_enabled, created_at, updated_at FROM system_environments WHERE id=?1",
        [id],
        read_environment,
    )
    .optional()
    .map_err(db_error)?
    .ok_or_else(|| "NOT_FOUND".to_string())
}

pub(crate) fn list_environments_record(
    conn: &Connection,
    system_id: &str,
) -> Result<Vec<SystemEnvironment>, String> {
    get_system(conn, system_id)?;
    let mut statement = conn
        .prepare("SELECT id, system_id, kind, name, base_url, is_enabled, created_at, updated_at FROM system_environments WHERE system_id=?1 ORDER BY is_enabled DESC, kind, name")
        .map_err(db_error)?;
    let result = statement
        .query_map([system_id], read_environment)
        .map_err(db_error)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(db_error);
    result
}

pub(crate) fn create_environment_record(
    conn: &Connection,
    actor_role: &str,
    input: &CreateEnvironmentInput,
) -> Result<SystemEnvironment, String> {
    ensure_admin_role(actor_role)?;
    get_system(conn, &input.system_id)?;
    validate_environment(&input.kind, &input.name, &input.base_url)?;
    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO system_environments(id, system_id, kind, name, base_url) VALUES(?1, ?2, ?3, ?4, ?5)",
        params![id, input.system_id, input.kind, input.name.trim(), input.base_url.trim()],
    )
    .map_err(db_error)?;
    get_environment(conn, &id)
}

pub(crate) fn update_environment_record(
    conn: &Connection,
    actor_role: &str,
    input: &UpdateEnvironmentInput,
) -> Result<SystemEnvironment, String> {
    ensure_admin_role(actor_role)?;
    get_system(conn, &input.system_id)?;
    validate_environment(&input.kind, &input.name, &input.base_url)?;
    let changed = conn
        .execute(
            "UPDATE system_environments SET system_id=?1, kind=?2, name=?3, base_url=?4, is_enabled=?5, updated_at=CURRENT_TIMESTAMP WHERE id=?6",
            params![input.system_id, input.kind, input.name.trim(), input.base_url.trim(), input.is_enabled, input.id],
        )
        .map_err(db_error)?;
    if changed == 0 {
        return Err("NOT_FOUND".to_string());
    }
    get_environment(conn, &input.id)
}

fn validate_scope(conn: &Connection, system_id: &str, environment_id: &str) -> Result<(), String> {
    get_system(conn, system_id)?;
    let environment = get_environment(conn, environment_id)?;
    if environment.system_id != system_id {
        Err("CROSS_SYSTEM_REFERENCE".to_string())
    } else {
        Ok(())
    }
}

fn get_design(conn: &Connection, owner_id: &str, id: &str) -> Result<TestDesign, String> {
    conn.query_row(
        "SELECT id, system_id, environment_id, title, status, current_requirement_version_id, created_at, updated_at FROM test_designs WHERE id=?1 AND owner_id=?2",
        params![id, owner_id],
        read_design,
    )
    .optional()
    .map_err(db_error)?
    .ok_or_else(|| "NOT_FOUND".to_string())
}

pub(crate) fn list_test_designs_record(
    conn: &Connection,
    owner_id: &str,
    system_id: Option<&str>,
    environment_id: Option<&str>,
) -> Result<Vec<TestDesign>, String> {
    if let (Some(system_id), Some(environment_id)) = (system_id, environment_id) {
        validate_scope(conn, system_id, environment_id)?;
    }
    let mut statement = conn
        .prepare("SELECT id, system_id, environment_id, title, status, current_requirement_version_id, created_at, updated_at FROM test_designs WHERE owner_id=?1 AND (?2 IS NULL OR system_id=?2) AND (?3 IS NULL OR environment_id=?3) ORDER BY updated_at DESC, title")
        .map_err(db_error)?;
    let result = statement
        .query_map(params![owner_id, system_id, environment_id], read_design)
        .map_err(db_error)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(db_error);
    result
}

pub(crate) fn create_test_design_record(
    conn: &Connection,
    owner_id: &str,
    input: &CreateTestDesignInput,
) -> Result<TestDesign, String> {
    validate_scope(conn, &input.system_id, &input.environment_id)?;
    required(&input.title, "DESIGN_TITLE")?;
    required(&input.status, "DESIGN_STATUS")?;
    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO test_designs(id, owner_id, system_id, environment_id, title, status) VALUES(?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, owner_id, input.system_id, input.environment_id, input.title.trim(), input.status.trim()],
    )
    .map_err(db_error)?;
    get_design(conn, owner_id, &id)
}

pub(crate) fn update_test_design_record(
    conn: &Connection,
    owner_id: &str,
    input: &UpdateTestDesignInput,
) -> Result<TestDesign, String> {
    get_design(conn, owner_id, &input.id)?;
    validate_scope(conn, &input.system_id, &input.environment_id)?;
    required(&input.title, "DESIGN_TITLE")?;
    required(&input.status, "DESIGN_STATUS")?;
    conn.execute(
        "UPDATE test_designs SET system_id=?1, environment_id=?2, title=?3, status=?4, updated_at=CURRENT_TIMESTAMP WHERE id=?5 AND owner_id=?6",
        params![input.system_id, input.environment_id, input.title.trim(), input.status.trim(), input.id, owner_id],
    )
    .map_err(db_error)?;
    get_design(conn, owner_id, &input.id)
}

pub(crate) fn list_requirement_versions_record(
    conn: &Connection,
    owner_id: &str,
    design_id: &str,
) -> Result<Vec<RequirementVersion>, String> {
    get_design(conn, owner_id, design_id)?;
    let mut statement = conn
        .prepare("SELECT id, design_id, version_no, source_kind, content, created_at, updated_at FROM requirement_versions WHERE design_id=?1 ORDER BY version_no DESC")
        .map_err(db_error)?;
    let result = statement
        .query_map([design_id], read_requirement_version)
        .map_err(db_error)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(db_error);
    result
}

pub(crate) fn create_requirement_version_record(
    conn: &Connection,
    owner_id: &str,
    input: &CreateRequirementVersionInput,
) -> Result<RequirementVersion, String> {
    get_design(conn, owner_id, &input.design_id)?;
    required(&input.source_kind, "REQUIREMENT_SOURCE_KIND")?;
    required(&input.content, "REQUIREMENT_CONTENT")?;
    let transaction = conn.unchecked_transaction().map_err(db_error)?;
    let next_version: i64 = transaction
        .query_row(
            "SELECT COALESCE(MAX(version_no), 0) + 1 FROM requirement_versions WHERE design_id=?1",
            [&input.design_id],
            |row| row.get(0),
        )
        .map_err(db_error)?;
    let id = Uuid::new_v4().to_string();
    transaction
        .execute(
            "INSERT INTO requirement_versions(id, design_id, version_no, source_kind, content) VALUES(?1, ?2, ?3, ?4, ?5)",
            params![id, input.design_id, next_version, input.source_kind.trim(), input.content.trim()],
        )
        .map_err(db_error)?;
    transaction
        .execute(
            "UPDATE test_designs SET current_requirement_version_id=?1, updated_at=CURRENT_TIMESTAMP WHERE id=?2 AND owner_id=?3",
            params![id, input.design_id, owner_id],
        )
        .map_err(db_error)?;
    transaction.commit().map_err(db_error)?;
    conn.query_row(
        "SELECT id, design_id, version_no, source_kind, content, created_at, updated_at FROM requirement_versions WHERE id=?1",
        [id],
        read_requirement_version,
    )
    .map_err(db_error)
}

fn generation_batch_query() -> &'static str {
    "SELECT b.id, b.design_id, b.requirement_version_id, b.model, b.template_id,
            CASE WHEN b.requirement_version_id=d.current_requirement_version_id THEN 0 ELSE 1 END,
            b.created_at, b.updated_at
     FROM generation_batches b JOIN test_designs d ON d.id=b.design_id"
}

pub(crate) fn list_generation_batches_record(
    conn: &Connection,
    owner_id: &str,
    design_id: &str,
) -> Result<Vec<GenerationBatch>, String> {
    get_design(conn, owner_id, design_id)?;
    let sql = format!(
        "{} WHERE b.design_id=?1 ORDER BY b.created_at DESC, b.id DESC",
        generation_batch_query()
    );
    let mut statement = conn.prepare(&sql).map_err(db_error)?;
    let result = statement
        .query_map([design_id], read_generation_batch)
        .map_err(db_error)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(db_error);
    result
}

pub(crate) fn create_generation_batch_record(
    conn: &Connection,
    owner_id: &str,
    input: &CreateGenerationBatchInput,
) -> Result<GenerationBatch, String> {
    get_design(conn, owner_id, &input.design_id)?;
    required(&input.model, "GENERATION_MODEL")?;
    let requirement_design: Option<String> = conn
        .query_row(
            "SELECT design_id FROM requirement_versions WHERE id=?1",
            [&input.requirement_version_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(db_error)?;
    let requirement_design = requirement_design.ok_or_else(|| "NOT_FOUND".to_string())?;
    if requirement_design != input.design_id {
        return Err("CROSS_DESIGN_REFERENCE".to_string());
    }
    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO generation_batches(id, design_id, requirement_version_id, model, template_id) VALUES(?1, ?2, ?3, ?4, ?5)",
        params![id, input.design_id, input.requirement_version_id, input.model.trim(), input.template_id],
    )
    .map_err(db_error)?;
    let sql = format!("{} WHERE b.id=?1", generation_batch_query());
    conn.query_row(&sql, [id], read_generation_batch)
        .map_err(db_error)
}

pub(crate) fn list_review_records_record(
    conn: &Connection,
    owner_id: &str,
    design_id: &str,
) -> Result<Vec<ReviewRecord>, String> {
    get_design(conn, owner_id, design_id)?;
    let mut statement = conn
        .prepare("SELECT id, design_id, generation_batch_id, reviewer_id, conclusion, change_summary, created_at, updated_at FROM review_records WHERE design_id=?1 ORDER BY created_at DESC, id DESC")
        .map_err(db_error)?;
    let result = statement
        .query_map([design_id], read_review_record)
        .map_err(db_error)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(db_error);
    result
}

pub(crate) fn create_review_record(
    conn: &Connection,
    owner_id: &str,
    input: &CreateReviewRecordInput,
) -> Result<ReviewRecord, String> {
    get_design(conn, owner_id, &input.design_id)?;
    required(&input.conclusion, "REVIEW_CONCLUSION")?;
    let batch_design: Option<String> = conn
        .query_row(
            "SELECT design_id FROM generation_batches WHERE id=?1",
            [&input.generation_batch_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(db_error)?;
    let batch_design = batch_design.ok_or_else(|| "NOT_FOUND".to_string())?;
    if batch_design != input.design_id {
        return Err("CROSS_DESIGN_REFERENCE".to_string());
    }
    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO review_records(id, design_id, generation_batch_id, reviewer_id, conclusion, change_summary) VALUES(?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, input.design_id, input.generation_batch_id, owner_id, input.conclusion.trim(), input.change_summary.trim()],
    )
    .map_err(db_error)?;
    conn.query_row(
        "SELECT id, design_id, generation_batch_id, reviewer_id, conclusion, change_summary, created_at, updated_at FROM review_records WHERE id=?1",
        [id],
        read_review_record,
    )
    .map_err(db_error)
}

pub(crate) fn get_regression_config_record(
    conn: &Connection,
    owner_id: &str,
    design_id: &str,
) -> Result<Option<RegressionConfig>, String> {
    get_design(conn, owner_id, design_id)?;
    conn.query_row(
        "SELECT id, design_id, suite_id, account_combination_id, case_ids_json, created_at, updated_at FROM regression_configs WHERE design_id=?1",
        [design_id],
        read_regression_config,
    )
    .optional()
    .map_err(db_error)
}

pub(crate) fn save_regression_config_record(
    conn: &Connection,
    owner_id: &str,
    input: &CreateRegressionConfigInput,
) -> Result<RegressionConfig, String> {
    get_design(conn, owner_id, &input.design_id)?;
    validate_case_ids_json(&input.case_ids_json)?;
    let existing_id: Option<String> = conn
        .query_row(
            "SELECT id FROM regression_configs WHERE design_id=?1",
            [&input.design_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(db_error)?;
    let id = existing_id.unwrap_or_else(|| Uuid::new_v4().to_string());
    conn.execute(
        "INSERT INTO regression_configs(id, design_id, suite_id, account_combination_id, case_ids_json) VALUES(?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(design_id) DO UPDATE SET suite_id=excluded.suite_id, account_combination_id=excluded.account_combination_id, case_ids_json=excluded.case_ids_json, updated_at=CURRENT_TIMESTAMP",
        params![id, input.design_id, input.suite_id, input.account_combination_id, input.case_ids_json],
    )
    .map_err(db_error)?;
    get_regression_config_record(conn, owner_id, &input.design_id)?
        .ok_or_else(|| "NOT_FOUND".to_string())
}

#[tauri::command]
pub fn list_systems(app: tauri::AppHandle) -> Result<Vec<TestSystem>, String> {
    crate::auth::current_user()?;
    list_systems_record(&crate::auth::open_db(&app)?)
}

#[tauri::command]
pub fn create_system(app: tauri::AppHandle, name: String) -> Result<TestSystem, String> {
    let admin = crate::auth::require_admin()?;
    create_system_record(&crate::auth::open_db(&app)?, &admin.role, &name)
}

#[tauri::command]
pub fn update_system(
    app: tauri::AppHandle,
    input: UpdateTestSystemInput,
) -> Result<TestSystem, String> {
    let admin = crate::auth::require_admin()?;
    update_system_record(&crate::auth::open_db(&app)?, &admin.role, &input)
}

#[tauri::command]
pub fn list_system_environments(
    app: tauri::AppHandle,
    system_id: String,
) -> Result<Vec<SystemEnvironment>, String> {
    crate::auth::current_user()?;
    list_environments_record(&crate::auth::open_db(&app)?, &system_id)
}

#[tauri::command]
pub fn create_system_environment(
    app: tauri::AppHandle,
    input: CreateEnvironmentInput,
) -> Result<SystemEnvironment, String> {
    let admin = crate::auth::require_admin()?;
    create_environment_record(&crate::auth::open_db(&app)?, &admin.role, &input)
}

#[tauri::command]
pub fn update_system_environment(
    app: tauri::AppHandle,
    input: UpdateEnvironmentInput,
) -> Result<SystemEnvironment, String> {
    let admin = crate::auth::require_admin()?;
    update_environment_record(&crate::auth::open_db(&app)?, &admin.role, &input)
}

#[tauri::command]
pub fn list_test_designs(
    app: tauri::AppHandle,
    system_id: Option<String>,
    environment_id: Option<String>,
) -> Result<Vec<TestDesign>, String> {
    let owner = crate::auth::current_user_id()?;
    list_test_designs_record(
        &crate::auth::open_db(&app)?,
        &owner,
        system_id.as_deref(),
        environment_id.as_deref(),
    )
}

#[tauri::command]
pub fn create_test_design(
    app: tauri::AppHandle,
    input: CreateTestDesignInput,
) -> Result<TestDesign, String> {
    let owner = crate::auth::current_user_id()?;
    create_test_design_record(&crate::auth::open_db(&app)?, &owner, &input)
}

#[tauri::command]
pub fn update_test_design(
    app: tauri::AppHandle,
    input: UpdateTestDesignInput,
) -> Result<TestDesign, String> {
    let owner = crate::auth::current_user_id()?;
    update_test_design_record(&crate::auth::open_db(&app)?, &owner, &input)
}

#[tauri::command]
pub fn list_requirement_versions(
    app: tauri::AppHandle,
    design_id: String,
) -> Result<Vec<RequirementVersion>, String> {
    let owner = crate::auth::current_user_id()?;
    list_requirement_versions_record(&crate::auth::open_db(&app)?, &owner, &design_id)
}

#[tauri::command]
pub fn create_requirement_version(
    app: tauri::AppHandle,
    input: CreateRequirementVersionInput,
) -> Result<RequirementVersion, String> {
    let owner = crate::auth::current_user_id()?;
    create_requirement_version_record(&crate::auth::open_db(&app)?, &owner, &input)
}

#[tauri::command]
pub fn list_generation_batches(
    app: tauri::AppHandle,
    design_id: String,
) -> Result<Vec<GenerationBatch>, String> {
    let owner = crate::auth::current_user_id()?;
    list_generation_batches_record(&crate::auth::open_db(&app)?, &owner, &design_id)
}

#[tauri::command]
pub fn create_generation_batch(
    app: tauri::AppHandle,
    input: CreateGenerationBatchInput,
) -> Result<GenerationBatch, String> {
    let owner = crate::auth::current_user_id()?;
    create_generation_batch_record(&crate::auth::open_db(&app)?, &owner, &input)
}

#[tauri::command]
pub fn list_review_records(
    app: tauri::AppHandle,
    design_id: String,
) -> Result<Vec<ReviewRecord>, String> {
    let owner = crate::auth::current_user_id()?;
    list_review_records_record(&crate::auth::open_db(&app)?, &owner, &design_id)
}

#[tauri::command]
pub fn create_review(
    app: tauri::AppHandle,
    input: CreateReviewRecordInput,
) -> Result<ReviewRecord, String> {
    let owner = crate::auth::current_user_id()?;
    create_review_record(&crate::auth::open_db(&app)?, &owner, &input)
}

#[tauri::command]
pub fn get_regression_config(
    app: tauri::AppHandle,
    design_id: String,
) -> Result<Option<RegressionConfig>, String> {
    let owner = crate::auth::current_user_id()?;
    get_regression_config_record(&crate::auth::open_db(&app)?, &owner, &design_id)
}

#[tauri::command]
pub fn save_regression_config(
    app: tauri::AppHandle,
    input: CreateRegressionConfigInput,
) -> Result<RegressionConfig, String> {
    let owner = crate::auth::current_user_id()?;
    save_regression_config_record(&crate::auth::open_db(&app)?, &owner, &input)
}
