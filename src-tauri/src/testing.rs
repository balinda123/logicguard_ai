use rusqlite::{params, Connection, OptionalExtension, Row, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

const BUSINESS_ROLES: &[&str] = &["employee", "manager", "hrbp"];
const LOGIN_MODES: &[&str] = &["automatic", "manual_sso", "manual_otp"];
const SCENARIO_KINDS: &[&str] = &["single_role", "permission", "workflow", "branch"];
const RUN_STATUSES: &[&str] = &[
    "queued",
    "running",
    "waiting_handoff",
    "execution_blocked",
    "business_failed",
    "passed",
    "cancelled",
];
const DEFECT_STATUSES: &[&str] = &[
    "pending_confirmation",
    "pending_fix",
    "pending_validation",
    "closed",
    "not_a_bug",
];
const NOT_CONFIGURED_MASK: &str = "not-configured";
const TEST_ACCOUNT_CREDENTIAL_SERVICE: &str = "com.logicguard.ai.test-account";
const MAX_CREDENTIAL_VALUE_LENGTH: usize = 512;
const MAX_LOGIN_URL_LENGTH: usize = 2048;
const MAX_SELECTOR_LENGTH: usize = 512;
const MAX_MASKED_LOGIN_NAME_LENGTH: usize = 64;
const WORKFLOW_EVENT_PHASES: &[&str] = &[
    "session_started",
    "login_started",
    "step_started",
    "step_completed",
    "assertion_passed",
    "assertion_failed",
    "handoff_required",
    "execution_blocked",
    "run_completed",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LoginAutomationConfig {
    pub login_url: String,
    #[serde(default)]
    pub page_selector: Option<String>,
    #[serde(default)]
    pub username_selector: Option<String>,
    #[serde(default)]
    pub password_selector: Option<String>,
    #[serde(default)]
    pub submit_selector: Option<String>,
    #[serde(default)]
    pub success_selector: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestAccount {
    pub id: String,
    pub display_name: String,
    pub business_role: String,
    pub masked_login_name: String,
    pub credential_ref: String,
    pub login_mode: String,
    pub login_config: LoginAutomationConfig,
    pub is_enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

/// Kept inside the Rust process only. This type must never cross a Tauri boundary.
pub(crate) struct StoredBrowserCredential {
    pub(crate) username: String,
    pub(crate) password: String,
}

/// Combines browser metadata with an OS-keyring credential for the internal executor.
pub(crate) struct AutomaticBrowserLogin {
    pub(crate) login_config: LoginAutomationConfig,
    pub(crate) credential: StoredBrowserCredential,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredCredentialPayload {
    username: String,
    password: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateTestAccountInput {
    pub display_name: String,
    pub business_role: String,
    pub login_mode: String,
    pub login_config: LoginAutomationConfig,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateTestAccountInput {
    pub id: String,
    pub display_name: String,
    pub business_role: String,
    pub login_mode: String,
    pub login_config: LoginAutomationConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountCombination {
    pub id: String,
    pub name: String,
    pub employee_account_id: Option<String>,
    pub manager_account_id: Option<String>,
    pub hrbp_account_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveAccountCombinationInput {
    pub id: Option<String>,
    pub name: String,
    pub employee_account_id: Option<String>,
    pub manager_account_id: Option<String>,
    pub hrbp_account_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowScenario {
    pub id: String,
    pub name: String,
    pub scenario_kind: String,
    pub source_test_case_id: Option<String>,
    pub business_tags_json: String,
    pub preconditions_json: String,
    pub steps_json: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveWorkflowScenarioInput {
    pub id: Option<String>,
    pub name: String,
    pub scenario_kind: String,
    pub source_test_case_id: Option<String>,
    pub business_tags_json: String,
    pub preconditions_json: String,
    pub steps_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRun {
    pub id: String,
    pub scenario_id: String,
    pub account_combination_id: Option<String>,
    pub status: String,
    pub current_step_order: i64,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateWorkflowRunInput {
    pub scenario_id: String,
    pub account_combination_id: Option<String>,
    pub status: String,
    pub current_step_order: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateWorkflowRunInput {
    pub id: String,
    pub status: String,
    pub current_step_order: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRunEvent {
    pub id: String,
    pub run_id: String,
    pub sequence_no: i64,
    pub phase: String,
    pub business_role: Option<String>,
    pub message: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppendWorkflowRunEventInput {
    pub run_id: String,
    pub phase: String,
    pub business_role: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FailureEvidence {
    pub id: String,
    pub run_id: String,
    pub step_id: String,
    pub expected_value: String,
    pub actual_value: String,
    pub screenshot_path: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveFailureEvidenceInput {
    pub id: Option<String>,
    pub run_id: String,
    pub step_id: String,
    pub expected_value: String,
    pub actual_value: String,
    pub screenshot_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DefectDraft {
    pub id: String,
    pub scenario_id: String,
    pub run_id: String,
    pub evidence_id: Option<String>,
    pub status: String,
    pub title: String,
    pub reproduction_steps_json: String,
    pub expected_result: String,
    pub actual_result: String,
    pub impact_summary: String,
    pub business_role: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveDefectDraftInput {
    pub id: Option<String>,
    pub scenario_id: String,
    pub run_id: String,
    pub evidence_id: Option<String>,
    pub status: String,
    pub title: String,
    pub reproduction_steps_json: String,
    pub expected_result: String,
    pub actual_result: String,
    pub impact_summary: String,
    pub business_role: Option<String>,
}

fn db_error(_: rusqlite::Error) -> String {
    "DATABASE_OPERATION_FAILED".to_string()
}

fn required(value: &str, field: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err(format!("{field}_REQUIRED"));
    }
    Ok(())
}

fn normalized_persisted_key(value: &str) -> String {
    value
        .chars()
        .filter(|character| !matches!(character, '_' | '-' | ' '))
        .flat_map(char::to_lowercase)
        .collect()
}

fn is_sensitive_persisted_key(value: &str) -> bool {
    let normalized = normalized_persisted_key(value);
    [
        "password",
        "passwd",
        "pwd",
        "otp",
        "token",
        "accesstoken",
        "apikey",
        "secret",
        "authorization",
        "bearer",
        "username",
        "loginname",
    ]
    .iter()
    .any(|fragment| normalized.contains(fragment))
}

fn has_sensitive_value_after_marker(value: &str, marker: &str) -> bool {
    let normalized = value.to_ascii_lowercase();
    normalized.match_indices(marker).any(|(index, _)| {
        let before = normalized[..index].chars().next_back();
        let after = &normalized[index + marker.len()..];
        let marker_is_word = before
            .map(|character| character.is_ascii_alphanumeric() || character == '_')
            .unwrap_or(false);
        if marker_is_word {
            return false;
        }
        let after_quoted_marker = after
            .trim_start()
            .trim_start_matches(|character| matches!(character, '\"' | '\''))
            .trim_start();
        if after_quoted_marker.starts_with('=') || after_quoted_marker.starts_with(':') {
            return !after_quoted_marker[1..].trim().is_empty();
        }
        if after.chars().next().is_some_and(char::is_whitespace) {
            let next_word = after.trim().split_whitespace().next().unwrap_or_default();
            return !next_word.is_empty()
                && ![
                    "field", "fields", "display", "error", "missing", "invalid", "failed",
                    "required",
                ]
                .contains(&next_word);
        }
        false
    })
}

fn contains_sensitive_persisted_value(value: &str) -> bool {
    [
        "password",
        "passwd",
        "pwd",
        "otp",
        "one-time-code",
        "token",
        "access token",
        "access-token",
        "access_token",
        "refresh token",
        "refresh-token",
        "refresh_token",
        "api key",
        "api-key",
        "api_key",
        "secret",
        "authorization",
        "bearer",
        "username",
        "user-name",
        "user_name",
        "login name",
        "login-name",
        "login_name",
    ]
    .iter()
    .any(|marker| has_sensitive_value_after_marker(value, marker))
}

fn validate_persisted_text(value: &str, field: &str) -> Result<(), String> {
    let contains_sensitive_json_key = serde_json::from_str::<Value>(value)
        .map(|parsed| contains_sensitive_key(&parsed))
        .unwrap_or(false);
    if contains_sensitive_json_key || contains_sensitive_persisted_value(value) {
        Err(format!("SENSITIVE_{field}"))
    } else {
        Ok(())
    }
}

fn validate_screenshot_path(value: &Option<String>) -> Result<(), String> {
    let Some(path) = value else {
        return Ok(());
    };
    validate_persisted_text(path, "SCREENSHOT_PATH")?;
    if path.len() > 512
        || !path.starts_with("failure-evidence/")
        || path.contains("..")
        || path.split('/').any(str::is_empty)
        || !path.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '/' | '.' | '_' | '-')
        })
    {
        return Err("INVALID_SCREENSHOT_PATH".to_string());
    }
    Ok(())
}

fn validate_workflow_event_phase(value: &str) -> Result<(), String> {
    validate_persisted_text(value, "WORKFLOW_EVENT_PHASE")?;
    allowed(value, WORKFLOW_EVENT_PHASES, "WORKFLOW_EVENT_PHASE")
}

fn validate_stable_step_id(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 128
        || !value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
        })
    {
        Err("INVALID_STEP_ID".to_string())
    } else {
        Ok(())
    }
}

fn allowed(value: &str, values: &[&str], field: &str) -> Result<(), String> {
    if values.contains(&value) {
        Ok(())
    } else {
        Err(format!("INVALID_{field}"))
    }
}

fn contains_sensitive_key(value: &Value) -> bool {
    match value {
        Value::Object(map) => map
            .iter()
            .any(|(key, value)| is_sensitive_persisted_key(key) || contains_sensitive_key(value)),
        Value::Array(items) => items.iter().any(contains_sensitive_key),
        _ => false,
    }
}

fn validate_safe_json(value: &str, field: &str) -> Result<(), String> {
    let parsed: Value = serde_json::from_str(value).map_err(|_| format!("INVALID_{field}"))?;
    if contains_sensitive_key(&parsed) {
        return Err("SENSITIVE_JSON_FIELD".to_string());
    }
    Ok(())
}

fn validate_optional_role(value: &Option<String>) -> Result<(), String> {
    if let Some(role) = value {
        allowed(role, BUSINESS_ROLES, "BUSINESS_ROLE")?;
    }
    Ok(())
}

fn validate_untrusted_text(value: &str, max_length: usize, field: &str) -> Result<(), String> {
    if value.is_empty() || value.len() > max_length || value.chars().any(char::is_control) {
        return Err(format!("INVALID_{field}"));
    }
    Ok(())
}

fn validate_optional_selector(value: &Option<String>, field: &str) -> Result<(), String> {
    if let Some(selector) = value {
        validate_untrusted_text(selector, MAX_SELECTOR_LENGTH, field)?;
        // Persisted selector metadata must be an identifier-only CSS fragment, never a text locator.
        if selector.chars().any(char::is_whitespace)
            || !selector.chars().all(|character| {
                character.is_ascii_alphanumeric()
                    || matches!(character, '#' | '.' | '[' | ']' | '_' | '-')
            })
        {
            return Err(format!("INVALID_{field}"));
        }
    }
    Ok(())
}

fn validate_login_config(config: &LoginAutomationConfig) -> Result<(), String> {
    validate_untrusted_text(&config.login_url, MAX_LOGIN_URL_LENGTH, "LOGIN_URL")?;
    let url =
        reqwest::Url::parse(&config.login_url).map_err(|_| "INVALID_LOGIN_URL".to_string())?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("INVALID_LOGIN_URL".to_string());
    }
    validate_optional_selector(&config.page_selector, "PAGE_SELECTOR")?;
    validate_optional_selector(&config.username_selector, "USERNAME_SELECTOR")?;
    validate_optional_selector(&config.password_selector, "PASSWORD_SELECTOR")?;
    validate_optional_selector(&config.submit_selector, "SUBMIT_SELECTOR")?;
    validate_optional_selector(&config.success_selector, "SUCCESS_SELECTOR")
}

fn validate_masked_login_name(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > MAX_MASKED_LOGIN_NAME_LENGTH
        || value
            .chars()
            .any(|character| character.is_whitespace() || character.is_control())
        || value.contains('@')
    {
        return Err("INVALID_MASKED_LOGIN_NAME".to_string());
    }
    let first_star = value
        .find('*')
        .ok_or_else(|| "INVALID_MASKED_LOGIN_NAME".to_string())?;
    let (prefix, mask) = value.split_at(first_star);
    if prefix.is_empty()
        || mask.len() < 3
        || !mask.chars().all(|character| character == '*')
        || !prefix.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-')
        })
    {
        return Err("INVALID_MASKED_LOGIN_NAME".to_string());
    }
    Ok(())
}

fn validate_credential_value(value: &str, field: &str) -> Result<(), String> {
    if value.is_empty() || value.len() > MAX_CREDENTIAL_VALUE_LENGTH || value.chars().any(char::is_control) {
        return Err(format!("INVALID_{field}"));
    }
    Ok(())
}

pub(crate) fn mask_login_name(username: &str) -> String {
    let visible: String = username
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-'))
        .take(2)
        .collect();
    format!("{}***", if visible.is_empty() { "user" } else { &visible })
}

fn read_test_account(row: &Row<'_>) -> rusqlite::Result<TestAccount> {
    let login_config_json: String = row.get(6)?;
    let login_config = serde_json::from_str(&login_config_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(6, rusqlite::types::Type::Text, Box::new(error))
    })?;
    Ok(TestAccount {
        id: row.get(0)?,
        display_name: row.get(1)?,
        business_role: row.get(2)?,
        masked_login_name: row.get(3)?,
        credential_ref: row.get(4)?,
        login_mode: row.get(5)?,
        login_config,
        is_enabled: row.get::<_, i64>(7)? != 0,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

fn read_account_combination(row: &Row<'_>) -> rusqlite::Result<AccountCombination> {
    Ok(AccountCombination {
        id: row.get(0)?,
        name: row.get(1)?,
        employee_account_id: row.get(2)?,
        manager_account_id: row.get(3)?,
        hrbp_account_id: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

fn read_workflow_scenario(row: &Row<'_>) -> rusqlite::Result<WorkflowScenario> {
    Ok(WorkflowScenario {
        id: row.get(0)?,
        name: row.get(1)?,
        scenario_kind: row.get(2)?,
        source_test_case_id: row.get(3)?,
        business_tags_json: row.get(4)?,
        preconditions_json: row.get(5)?,
        steps_json: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

fn read_workflow_run(row: &Row<'_>) -> rusqlite::Result<WorkflowRun> {
    Ok(WorkflowRun {
        id: row.get(0)?,
        scenario_id: row.get(1)?,
        account_combination_id: row.get(2)?,
        status: row.get(3)?,
        current_step_order: row.get(4)?,
        started_at: row.get(5)?,
        finished_at: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

fn read_workflow_event(row: &Row<'_>) -> rusqlite::Result<WorkflowRunEvent> {
    Ok(WorkflowRunEvent {
        id: row.get(0)?,
        run_id: row.get(1)?,
        sequence_no: row.get(2)?,
        phase: row.get(3)?,
        business_role: row.get(4)?,
        message: row.get(5)?,
        created_at: row.get(6)?,
    })
}

fn read_failure_evidence(row: &Row<'_>) -> rusqlite::Result<FailureEvidence> {
    Ok(FailureEvidence {
        id: row.get(0)?,
        run_id: row.get(1)?,
        step_id: row.get(2)?,
        expected_value: row.get(3)?,
        actual_value: row.get(4)?,
        screenshot_path: row.get(5)?,
        created_at: row.get(6)?,
    })
}

fn read_defect_draft(row: &Row<'_>) -> rusqlite::Result<DefectDraft> {
    Ok(DefectDraft {
        id: row.get(0)?,
        scenario_id: row.get(1)?,
        run_id: row.get(2)?,
        evidence_id: row.get(3)?,
        status: row.get(4)?,
        title: row.get(5)?,
        reproduction_steps_json: row.get(6)?,
        expected_result: row.get(7)?,
        actual_result: row.get(8)?,
        impact_summary: row.get(9)?,
        business_role: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
    })
}

pub(crate) fn initialize_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "PRAGMA foreign_keys=ON;
         CREATE TABLE IF NOT EXISTS test_accounts (
           id TEXT PRIMARY KEY,
           display_name TEXT NOT NULL,
           business_role TEXT NOT NULL CHECK(business_role IN ('employee','manager','hrbp')),
           masked_login_name TEXT NOT NULL,
           credential_ref TEXT NOT NULL,
           login_mode TEXT NOT NULL CHECK(login_mode IN ('automatic','manual_sso','manual_otp')),
           login_config_json TEXT NOT NULL,
           is_enabled INTEGER NOT NULL DEFAULT 1 CHECK(is_enabled IN (0,1)),
           created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
           updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
         );
         CREATE TABLE IF NOT EXISTS account_combinations (
           id TEXT PRIMARY KEY,
           name TEXT NOT NULL,
           employee_account_id TEXT REFERENCES test_accounts(id),
           manager_account_id TEXT REFERENCES test_accounts(id),
           hrbp_account_id TEXT REFERENCES test_accounts(id),
           owner_id TEXT NOT NULL REFERENCES users(id),
           created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
           updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
         );
         CREATE TABLE IF NOT EXISTS workflow_scenarios (
           id TEXT PRIMARY KEY,
           name TEXT NOT NULL,
           scenario_kind TEXT NOT NULL CHECK(scenario_kind IN ('single_role','permission','workflow','branch')),
           source_test_case_id TEXT,
           business_tags_json TEXT NOT NULL,
           preconditions_json TEXT NOT NULL,
           steps_json TEXT NOT NULL,
           owner_id TEXT NOT NULL REFERENCES users(id),
           created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
           updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
         );
         CREATE TABLE IF NOT EXISTS workflow_runs (
           id TEXT PRIMARY KEY,
           scenario_id TEXT NOT NULL REFERENCES workflow_scenarios(id),
           account_combination_id TEXT REFERENCES account_combinations(id),
           status TEXT NOT NULL CHECK(status IN ('queued','running','waiting_handoff','execution_blocked','business_failed','passed','cancelled')),
           current_step_order INTEGER NOT NULL DEFAULT 0 CHECK(current_step_order >= 0),
           owner_id TEXT NOT NULL REFERENCES users(id),
           started_at TEXT,
           finished_at TEXT,
           created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
           updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
         );
         CREATE TABLE IF NOT EXISTS workflow_events (
           id TEXT PRIMARY KEY,
           run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
           sequence_no INTEGER NOT NULL,
           phase TEXT NOT NULL,
           business_role TEXT CHECK(business_role IN ('employee','manager','hrbp')),
           message TEXT NOT NULL,
           owner_id TEXT NOT NULL REFERENCES users(id),
           created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
           UNIQUE(run_id, sequence_no)
         );
         CREATE TABLE IF NOT EXISTS failure_evidence (
           id TEXT PRIMARY KEY,
           run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
           step_id TEXT NOT NULL,
           expected_value TEXT NOT NULL,
           actual_value TEXT NOT NULL,
           screenshot_path TEXT,
           owner_id TEXT NOT NULL REFERENCES users(id),
           created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
         );
         CREATE TABLE IF NOT EXISTS defect_drafts (
           id TEXT PRIMARY KEY,
           scenario_id TEXT NOT NULL REFERENCES workflow_scenarios(id),
           run_id TEXT NOT NULL REFERENCES workflow_runs(id),
           evidence_id TEXT REFERENCES failure_evidence(id),
           status TEXT NOT NULL CHECK(status IN ('pending_confirmation','pending_fix','pending_validation','closed','not_a_bug')),
           title TEXT NOT NULL,
           reproduction_steps_json TEXT NOT NULL,
           expected_result TEXT NOT NULL,
           actual_result TEXT NOT NULL,
           impact_summary TEXT NOT NULL,
           business_role TEXT CHECK(business_role IN ('employee','manager','hrbp')),
           owner_id TEXT NOT NULL REFERENCES users(id),
           created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
           updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
         );
         CREATE INDEX IF NOT EXISTS idx_account_combinations_owner ON account_combinations(owner_id);
         CREATE INDEX IF NOT EXISTS idx_workflow_scenarios_owner ON workflow_scenarios(owner_id);
         CREATE INDEX IF NOT EXISTS idx_workflow_runs_owner_status ON workflow_runs(owner_id, status);
         CREATE INDEX IF NOT EXISTS idx_workflow_runs_scenario ON workflow_runs(scenario_id);
         CREATE INDEX IF NOT EXISTS idx_workflow_events_run_owner ON workflow_events(run_id, owner_id, sequence_no);
         CREATE INDEX IF NOT EXISTS idx_failure_evidence_run_owner ON failure_evidence(run_id, owner_id);
         CREATE INDEX IF NOT EXISTS idx_defect_drafts_owner_status ON defect_drafts(owner_id, status);",
    )
    .map_err(db_error)
}

pub(crate) fn ensure_admin_role(role: &str) -> Result<(), String> {
    if role == "admin" {
        Ok(())
    } else {
        Err("ADMIN_REQUIRED".to_string())
    }
}

fn validate_test_account_input(input: &CreateTestAccountInput) -> Result<(), String> {
    required(&input.display_name, "DISPLAY_NAME")?;
    allowed(&input.business_role, BUSINESS_ROLES, "BUSINESS_ROLE")?;
    allowed(&input.login_mode, LOGIN_MODES, "LOGIN_MODE")?;
    validate_login_config(&input.login_config)
}

pub(crate) fn create_test_account_record(
    conn: &Connection,
    actor_role: &str,
    input: &CreateTestAccountInput,
) -> Result<TestAccount, String> {
    ensure_admin_role(actor_role)?;
    validate_test_account_input(input)?;
    let id = Uuid::new_v4().to_string();
    let credential_ref = format!("logicguard.test-account.{id}");
    let login_config_json = serde_json::to_string(&input.login_config)
        .map_err(|_| "INVALID_LOGIN_CONFIG".to_string())?;
    conn.execute(
        "INSERT INTO test_accounts(id, display_name, business_role, masked_login_name, credential_ref, login_mode, login_config_json)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, input.display_name.trim(), input.business_role, NOT_CONFIGURED_MASK, credential_ref, input.login_mode, login_config_json],
    )
    .map_err(db_error)?;
    get_test_account(conn, &id)
}

fn get_test_account(conn: &Connection, id: &str) -> Result<TestAccount, String> {
    conn.query_row(
        "SELECT id, display_name, business_role, masked_login_name, credential_ref, login_mode, login_config_json, is_enabled, created_at, updated_at FROM test_accounts WHERE id=?1",
        [id],
        read_test_account,
    )
    .optional()
    .map_err(db_error)?
    .ok_or_else(|| "NOT_FOUND".to_string())
}

pub(crate) fn list_test_accounts_record(conn: &Connection) -> Result<Vec<TestAccount>, String> {
    let mut statement = conn
        .prepare("SELECT id, display_name, business_role, masked_login_name, credential_ref, login_mode, login_config_json, is_enabled, created_at, updated_at FROM test_accounts ORDER BY is_enabled DESC, business_role, display_name")
        .map_err(db_error)?;
    statement
        .query_map([], read_test_account)
        .map_err(db_error)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(db_error)
}

pub(crate) fn update_test_account_record(
    conn: &Connection,
    actor_role: &str,
    input: &UpdateTestAccountInput,
) -> Result<TestAccount, String> {
    ensure_admin_role(actor_role)?;
    validate_test_account_input(&CreateTestAccountInput {
        display_name: input.display_name.clone(),
        business_role: input.business_role.clone(),
        login_mode: input.login_mode.clone(),
        login_config: input.login_config.clone(),
    })?;
    let login_config_json = serde_json::to_string(&input.login_config)
        .map_err(|_| "INVALID_LOGIN_CONFIG".to_string())?;
    let changed = conn
        .execute(
            "UPDATE test_accounts SET display_name=?1, business_role=?2, login_mode=?3, login_config_json=?4, updated_at=CURRENT_TIMESTAMP WHERE id=?5",
            params![input.display_name.trim(), input.business_role, input.login_mode, login_config_json, input.id],
        )
        .map_err(db_error)?;
    if changed == 0 {
        return Err("NOT_FOUND".to_string());
    }
    get_test_account(conn, &input.id)
}

pub(crate) fn update_masked_login_name_after_credential_write(
    conn: &Connection,
    id: &str,
    masked_login_name: &str,
) -> Result<(), String> {
    validate_masked_login_name(masked_login_name)?;
    let changed = conn
        .execute(
            "UPDATE test_accounts SET masked_login_name=?1, updated_at=CURRENT_TIMESTAMP WHERE id=?2",
            params![masked_login_name, id],
        )
        .map_err(db_error)?;
    if changed == 0 {
        Err("NOT_FOUND".to_string())
    } else {
        Ok(())
    }
}

pub(crate) fn load_automatic_login(
    app: &tauri::AppHandle,
    account_id: &str,
) -> Result<AutomaticBrowserLogin, String> {
    crate::auth::current_user()?;
    let conn = crate::auth::open_db(app)?;
    let account = get_test_account(&conn, account_id)?;
    if !account.is_enabled {
        return Err("TEST_ACCOUNT_DISABLED".to_string());
    }
    if account.login_mode != "automatic" {
        return Err("MANUAL_HANDOFF_REQUIRED".to_string());
    }
    let stored = keyring::Entry::new(TEST_ACCOUNT_CREDENTIAL_SERVICE, &account.credential_ref)
        .map_err(|_| "TEST_ACCOUNT_CREDENTIAL_UNAVAILABLE".to_string())?
        .get_password()
        .map_err(|_| "TEST_ACCOUNT_CREDENTIAL_UNAVAILABLE".to_string())?;
    let payload: StoredCredentialPayload = serde_json::from_str(&stored)
        .map_err(|_| "TEST_ACCOUNT_CREDENTIAL_INVALID".to_string())?;
    validate_credential_value(&payload.username, "USERNAME")
        .map_err(|_| "TEST_ACCOUNT_CREDENTIAL_INVALID".to_string())?;
    validate_credential_value(&payload.password, "PASSWORD")
        .map_err(|_| "TEST_ACCOUNT_CREDENTIAL_INVALID".to_string())?;
    Ok(AutomaticBrowserLogin {
        login_config: account.login_config,
        credential: StoredBrowserCredential {
            username: payload.username,
            password: payload.password,
        },
    })
}

pub(crate) fn disable_test_account_record(
    conn: &Connection,
    actor_role: &str,
    id: &str,
) -> Result<(), String> {
    ensure_admin_role(actor_role)?;
    let changed = conn
        .execute(
            "UPDATE test_accounts SET is_enabled=0, updated_at=CURRENT_TIMESTAMP WHERE id=?1",
            [id],
        )
        .map_err(db_error)?;
    if changed == 0 {
        Err("NOT_FOUND".to_string())
    } else {
        Ok(())
    }
}

fn validate_account_for_role(
    conn: &Connection,
    id: &Option<String>,
    role: &str,
) -> Result<(), String> {
    let Some(id) = id else {
        return Ok(());
    };
    let matches: Option<i64> = conn
        .query_row(
            "SELECT 1 FROM test_accounts WHERE id=?1 AND business_role=?2 AND is_enabled=1",
            params![id, role],
            |row| row.get(0),
        )
        .optional()
        .map_err(db_error)?;
    if matches.is_none() {
        return Err("INVALID_TEST_ACCOUNT".to_string());
    }
    Ok(())
}

fn validate_combination_input(
    conn: &Connection,
    input: &SaveAccountCombinationInput,
) -> Result<(), String> {
    required(&input.name, "NAME")?;
    validate_account_for_role(conn, &input.employee_account_id, "employee")?;
    validate_account_for_role(conn, &input.manager_account_id, "manager")?;
    validate_account_for_role(conn, &input.hrbp_account_id, "hrbp")
}

fn get_account_combination(
    conn: &Connection,
    owner_id: &str,
    id: &str,
) -> Result<AccountCombination, String> {
    conn.query_row(
        "SELECT id, name, employee_account_id, manager_account_id, hrbp_account_id, created_at, updated_at FROM account_combinations WHERE id=?1 AND owner_id=?2",
        params![id, owner_id],
        read_account_combination,
    )
    .optional()
    .map_err(db_error)?
    .ok_or_else(|| "NOT_FOUND".to_string())
}

pub(crate) fn list_account_combinations_record(
    conn: &Connection,
    owner_id: &str,
) -> Result<Vec<AccountCombination>, String> {
    let mut statement = conn
        .prepare("SELECT id, name, employee_account_id, manager_account_id, hrbp_account_id, created_at, updated_at FROM account_combinations WHERE owner_id=?1 ORDER BY updated_at DESC, name")
        .map_err(db_error)?;
    statement
        .query_map([owner_id], read_account_combination)
        .map_err(db_error)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(db_error)
}

pub(crate) fn save_account_combination_record(
    conn: &Connection,
    owner_id: &str,
    input: &SaveAccountCombinationInput,
) -> Result<AccountCombination, String> {
    validate_combination_input(conn, input)?;
    let id = input
        .id
        .clone()
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    if input.id.is_some() {
        let changed = conn
            .execute(
                "UPDATE account_combinations SET name=?1, employee_account_id=?2, manager_account_id=?3, hrbp_account_id=?4, updated_at=CURRENT_TIMESTAMP WHERE id=?5 AND owner_id=?6",
                params![input.name.trim(), input.employee_account_id, input.manager_account_id, input.hrbp_account_id, id, owner_id],
            )
            .map_err(db_error)?;
        if changed == 0 {
            return Err("NOT_FOUND".to_string());
        }
    } else {
        conn.execute(
            "INSERT INTO account_combinations(id, name, employee_account_id, manager_account_id, hrbp_account_id, owner_id) VALUES(?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, input.name.trim(), input.employee_account_id, input.manager_account_id, input.hrbp_account_id, owner_id],
        )
        .map_err(db_error)?;
    }
    get_account_combination(conn, owner_id, &id)
}

pub(crate) fn delete_account_combination_record(
    conn: &Connection,
    owner_id: &str,
    id: &str,
) -> Result<(), String> {
    let changed = conn
        .execute(
            "DELETE FROM account_combinations WHERE id=?1 AND owner_id=?2",
            params![id, owner_id],
        )
        .map_err(db_error)?;
    if changed == 0 {
        Err("NOT_FOUND".to_string())
    } else {
        Ok(())
    }
}

fn validate_scenario_input(input: &SaveWorkflowScenarioInput) -> Result<(), String> {
    required(&input.name, "NAME")?;
    allowed(&input.scenario_kind, SCENARIO_KINDS, "SCENARIO_KIND")?;
    validate_safe_json(&input.business_tags_json, "BUSINESS_TAGS_JSON")?;
    validate_safe_json(&input.preconditions_json, "PRECONDITIONS_JSON")?;
    validate_safe_json(&input.steps_json, "STEPS_JSON")
}

fn get_workflow_scenario(
    conn: &Connection,
    owner_id: &str,
    id: &str,
) -> Result<WorkflowScenario, String> {
    conn.query_row(
        "SELECT id, name, scenario_kind, source_test_case_id, business_tags_json, preconditions_json, steps_json, created_at, updated_at FROM workflow_scenarios WHERE id=?1 AND owner_id=?2",
        params![id, owner_id],
        read_workflow_scenario,
    )
    .optional()
    .map_err(db_error)?
    .ok_or_else(|| "NOT_FOUND".to_string())
}

pub(crate) fn list_workflow_scenarios_record(
    conn: &Connection,
    owner_id: &str,
) -> Result<Vec<WorkflowScenario>, String> {
    let mut statement = conn
        .prepare("SELECT id, name, scenario_kind, source_test_case_id, business_tags_json, preconditions_json, steps_json, created_at, updated_at FROM workflow_scenarios WHERE owner_id=?1 ORDER BY updated_at DESC, name")
        .map_err(db_error)?;
    statement
        .query_map([owner_id], read_workflow_scenario)
        .map_err(db_error)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(db_error)
}

pub(crate) fn save_workflow_scenario_record(
    conn: &Connection,
    owner_id: &str,
    input: &SaveWorkflowScenarioInput,
) -> Result<WorkflowScenario, String> {
    validate_scenario_input(input)?;
    let id = input
        .id
        .clone()
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    if input.id.is_some() {
        let changed = conn
            .execute(
                "UPDATE workflow_scenarios SET name=?1, scenario_kind=?2, source_test_case_id=?3, business_tags_json=?4, preconditions_json=?5, steps_json=?6, updated_at=CURRENT_TIMESTAMP WHERE id=?7 AND owner_id=?8",
                params![input.name.trim(), input.scenario_kind, input.source_test_case_id, input.business_tags_json, input.preconditions_json, input.steps_json, id, owner_id],
            )
            .map_err(db_error)?;
        if changed == 0 {
            return Err("NOT_FOUND".to_string());
        }
    } else {
        conn.execute(
            "INSERT INTO workflow_scenarios(id, name, scenario_kind, source_test_case_id, business_tags_json, preconditions_json, steps_json, owner_id) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![id, input.name.trim(), input.scenario_kind, input.source_test_case_id, input.business_tags_json, input.preconditions_json, input.steps_json, owner_id],
        )
        .map_err(db_error)?;
    }
    get_workflow_scenario(conn, owner_id, &id)
}

pub(crate) fn delete_workflow_scenario_record(
    conn: &Connection,
    owner_id: &str,
    id: &str,
) -> Result<(), String> {
    let changed = conn
        .execute(
            "DELETE FROM workflow_scenarios WHERE id=?1 AND owner_id=?2",
            params![id, owner_id],
        )
        .map_err(db_error)?;
    if changed == 0 {
        Err("NOT_FOUND".to_string())
    } else {
        Ok(())
    }
}

fn ensure_scenario_owned(conn: &Connection, owner_id: &str, id: &str) -> Result<(), String> {
    get_workflow_scenario(conn, owner_id, id).map(|_| ())
}

fn ensure_combination_owned(
    conn: &Connection,
    owner_id: &str,
    id: &Option<String>,
) -> Result<(), String> {
    if let Some(id) = id {
        let combination = get_account_combination(conn, owner_id, id)?;
        validate_account_for_role(conn, &combination.employee_account_id, "employee")?;
        validate_account_for_role(conn, &combination.manager_account_id, "manager")?;
        validate_account_for_role(conn, &combination.hrbp_account_id, "hrbp")
    } else {
        Ok(())
    }
}

fn validate_run_status(status: &str) -> Result<(), String> {
    allowed(status, RUN_STATUSES, "RUN_STATUS")
}

fn is_terminal_run_status(status: &str) -> bool {
    matches!(
        status,
        "execution_blocked" | "business_failed" | "passed" | "cancelled"
    )
}

fn allows_run_transition(current: &str, next: &str) -> bool {
    matches!(
        (current, next),
        ("queued", "running" | "cancelled")
            | (
                "running",
                "waiting_handoff"
                    | "execution_blocked"
                    | "business_failed"
                    | "passed"
                    | "cancelled"
            )
            | (
                "waiting_handoff",
                "running" | "execution_blocked" | "cancelled"
            )
    )
}

fn get_workflow_run(conn: &Connection, owner_id: &str, id: &str) -> Result<WorkflowRun, String> {
    conn.query_row(
        "SELECT id, scenario_id, account_combination_id, status, current_step_order, started_at, finished_at, created_at, updated_at FROM workflow_runs WHERE id=?1 AND owner_id=?2",
        params![id, owner_id],
        read_workflow_run,
    )
    .optional()
    .map_err(db_error)?
    .ok_or_else(|| "NOT_FOUND".to_string())
}

pub(crate) fn create_workflow_run_record(
    conn: &Connection,
    owner_id: &str,
    input: &CreateWorkflowRunInput,
) -> Result<WorkflowRun, String> {
    ensure_scenario_owned(conn, owner_id, &input.scenario_id)?;
    ensure_combination_owned(conn, owner_id, &input.account_combination_id)?;
    if input.status != "queued" || input.current_step_order != 0 {
        return Err("INVALID_INITIAL_WORKFLOW_RUN_STATE".to_string());
    }
    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO workflow_runs(id, scenario_id, account_combination_id, status, current_step_order, owner_id) VALUES(?1, ?2, ?3, 'queued', 0, ?4)",
        params![id, input.scenario_id, input.account_combination_id, owner_id],
    )
    .map_err(db_error)?;
    get_workflow_run(conn, owner_id, &id)
}

pub(crate) fn update_workflow_run_record(
    conn: &Connection,
    owner_id: &str,
    input: &UpdateWorkflowRunInput,
) -> Result<WorkflowRun, String> {
    validate_run_status(&input.status)?;
    if input.current_step_order < 0 {
        return Err("INVALID_CURRENT_STEP_ORDER".to_string());
    }
    let current = get_workflow_run(conn, owner_id, &input.id)?;
    if is_terminal_run_status(&current.status)
        || input.current_step_order < current.current_step_order
    {
        return Err("INVALID_WORKFLOW_RUN_UPDATE".to_string());
    }
    if current.status == input.status {
        if current.status == "queued" && input.current_step_order != 0 {
            return Err("INVALID_WORKFLOW_RUN_UPDATE".to_string());
        }
    } else if !allows_run_transition(&current.status, &input.status) {
        return Err("INVALID_WORKFLOW_RUN_TRANSITION".to_string());
    } else if current.status == "queued" && input.current_step_order != 0 {
        return Err("INVALID_WORKFLOW_RUN_UPDATE".to_string());
    }
    let changed = conn
        .execute(
            "UPDATE workflow_runs SET status=?1, current_step_order=?2, started_at=CASE WHEN started_at IS NULL AND ?1='running' THEN CURRENT_TIMESTAMP ELSE started_at END, finished_at=CASE WHEN finished_at IS NULL AND ?1 IN ('execution_blocked','business_failed','passed','cancelled') THEN CURRENT_TIMESTAMP ELSE finished_at END, updated_at=CURRENT_TIMESTAMP WHERE id=?3 AND owner_id=?4",
            params![input.status, input.current_step_order, input.id, owner_id],
        )
        .map_err(db_error)?;
    if changed == 0 {
        return Err("NOT_FOUND".to_string());
    }
    get_workflow_run(conn, owner_id, &input.id)
}

pub(crate) fn list_workflow_runs_record(
    conn: &Connection,
    owner_id: &str,
) -> Result<Vec<WorkflowRun>, String> {
    let mut statement = conn
        .prepare("SELECT id, scenario_id, account_combination_id, status, current_step_order, started_at, finished_at, created_at, updated_at FROM workflow_runs WHERE owner_id=?1 ORDER BY created_at DESC")
        .map_err(db_error)?;
    statement
        .query_map([owner_id], read_workflow_run)
        .map_err(db_error)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(db_error)
}

pub(crate) fn append_workflow_run_event_record(
    conn: &mut Connection,
    owner_id: &str,
    input: &AppendWorkflowRunEventInput,
) -> Result<WorkflowRunEvent, String> {
    validate_workflow_event_phase(&input.phase)?;
    required(&input.message, "MESSAGE")?;
    validate_persisted_text(&input.message, "WORKFLOW_EVENT_MESSAGE")?;
    validate_optional_role(&input.business_role)?;
    let transaction = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(db_error)?;
    let run_exists: Option<i64> = transaction
        .query_row(
            "SELECT 1 FROM workflow_runs WHERE id=?1 AND owner_id=?2",
            params![input.run_id, owner_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(db_error)?;
    if run_exists.is_none() {
        return Err("NOT_FOUND".to_string());
    }
    let next_sequence: i64 = transaction
        .query_row("SELECT COALESCE(MAX(sequence_no), 0) + 1 FROM workflow_events WHERE run_id=?1 AND owner_id=?2", params![input.run_id, owner_id], |row| row.get(0))
        .map_err(db_error)?;
    let id = Uuid::new_v4().to_string();
    transaction
        .execute(
            "INSERT INTO workflow_events(id, run_id, sequence_no, phase, business_role, message, owner_id) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, input.run_id, next_sequence, input.phase.trim(), input.business_role, input.message.trim(), owner_id],
        )
        .map_err(db_error)?;
    transaction.commit().map_err(db_error)?;
    conn.query_row(
        "SELECT id, run_id, sequence_no, phase, business_role, message, created_at FROM workflow_events WHERE id=?1 AND owner_id=?2",
        params![id, owner_id],
        read_workflow_event,
    )
    .map_err(db_error)
}

pub(crate) fn list_workflow_run_events_record(
    conn: &Connection,
    owner_id: &str,
    run_id: &str,
) -> Result<Vec<WorkflowRunEvent>, String> {
    get_workflow_run(conn, owner_id, run_id)?;
    let mut statement = conn
        .prepare("SELECT id, run_id, sequence_no, phase, business_role, message, created_at FROM workflow_events WHERE run_id=?1 AND owner_id=?2 ORDER BY sequence_no")
        .map_err(db_error)?;
    statement
        .query_map(params![run_id, owner_id], read_workflow_event)
        .map_err(db_error)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(db_error)
}

fn get_failure_evidence(
    conn: &Connection,
    owner_id: &str,
    id: &str,
) -> Result<FailureEvidence, String> {
    conn.query_row(
        "SELECT id, run_id, step_id, expected_value, actual_value, screenshot_path, created_at FROM failure_evidence WHERE id=?1 AND owner_id=?2",
        params![id, owner_id],
        read_failure_evidence,
    )
    .optional()
    .map_err(db_error)?
    .ok_or_else(|| "NOT_FOUND".to_string())
}

fn validate_failure_evidence_input(
    conn: &Connection,
    owner_id: &str,
    input: &SaveFailureEvidenceInput,
) -> Result<(), String> {
    get_workflow_run(conn, owner_id, &input.run_id)?;
    validate_stable_step_id(&input.step_id)?;
    required(&input.expected_value, "EXPECTED_VALUE")?;
    required(&input.actual_value, "ACTUAL_VALUE")?;
    validate_persisted_text(&input.expected_value, "EXPECTED_VALUE")?;
    validate_persisted_text(&input.actual_value, "ACTUAL_VALUE")?;
    validate_screenshot_path(&input.screenshot_path)?;
    Ok(())
}

pub(crate) fn save_failure_evidence_record(
    conn: &Connection,
    owner_id: &str,
    input: &SaveFailureEvidenceInput,
) -> Result<FailureEvidence, String> {
    validate_failure_evidence_input(conn, owner_id, input)?;
    let id = input
        .id
        .clone()
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    if input.id.is_some() {
        let changed = conn
            .execute(
                "UPDATE failure_evidence SET run_id=?1, step_id=?2, expected_value=?3, actual_value=?4, screenshot_path=?5 WHERE id=?6 AND owner_id=?7",
                params![input.run_id, input.step_id.trim(), input.expected_value.trim(), input.actual_value.trim(), input.screenshot_path, id, owner_id],
            )
            .map_err(db_error)?;
        if changed == 0 {
            return Err("NOT_FOUND".to_string());
        }
    } else {
        conn.execute(
            "INSERT INTO failure_evidence(id, run_id, step_id, expected_value, actual_value, screenshot_path, owner_id) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, input.run_id, input.step_id.trim(), input.expected_value.trim(), input.actual_value.trim(), input.screenshot_path, owner_id],
        )
        .map_err(db_error)?;
    }
    get_failure_evidence(conn, owner_id, &id)
}

pub(crate) fn list_failure_evidence_record(
    conn: &Connection,
    owner_id: &str,
    run_id: Option<&str>,
) -> Result<Vec<FailureEvidence>, String> {
    if let Some(run_id) = run_id {
        get_workflow_run(conn, owner_id, run_id)?;
    }
    let mut statement = conn
        .prepare(
            "SELECT id, run_id, step_id, expected_value, actual_value, screenshot_path, created_at FROM failure_evidence WHERE owner_id=?1 AND (?2 IS NULL OR run_id=?2) ORDER BY created_at DESC",
        )
        .map_err(db_error)?;
    statement
        .query_map(params![owner_id, run_id], read_failure_evidence)
        .map_err(db_error)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(db_error)
}

fn validate_defect_draft_input(
    conn: &Connection,
    owner_id: &str,
    input: &SaveDefectDraftInput,
) -> Result<(), String> {
    validate_defect_status(&input.status)?;
    validate_optional_role(&input.business_role)?;
    validate_safe_json(&input.reproduction_steps_json, "REPRODUCTION_STEPS_JSON")?;
    required(&input.title, "TITLE")?;
    required(&input.expected_result, "EXPECTED_RESULT")?;
    required(&input.actual_result, "ACTUAL_RESULT")?;
    required(&input.impact_summary, "IMPACT_SUMMARY")?;
    validate_persisted_text(&input.title, "DEFECT_TITLE")?;
    validate_persisted_text(&input.reproduction_steps_json, "REPRODUCTION_STEPS")?;
    validate_persisted_text(&input.expected_result, "EXPECTED_RESULT")?;
    validate_persisted_text(&input.actual_result, "ACTUAL_RESULT")?;
    validate_persisted_text(&input.impact_summary, "IMPACT_SUMMARY")?;
    ensure_scenario_owned(conn, owner_id, &input.scenario_id)?;
    let run = get_workflow_run(conn, owner_id, &input.run_id)?;
    if run.scenario_id != input.scenario_id {
        return Err("INVALID_RUN_SCENARIO".to_string());
    }
    if let Some(evidence_id) = &input.evidence_id {
        let evidence = get_failure_evidence(conn, owner_id, evidence_id)?;
        if evidence.run_id != input.run_id {
            return Err("INVALID_EVIDENCE_RUN".to_string());
        }
    }
    Ok(())
}

fn validate_defect_status(status: &str) -> Result<(), String> {
    allowed(status, DEFECT_STATUSES, "DEFECT_STATUS")
}

fn allows_defect_status_transition(current: &str, next: &str) -> bool {
    matches!(
        (current, next),
        ("pending_confirmation", "pending_fix" | "not_a_bug")
            | ("pending_fix", "pending_validation")
            | ("pending_validation", "closed" | "pending_fix")
    )
}

fn get_defect_draft(conn: &Connection, owner_id: &str, id: &str) -> Result<DefectDraft, String> {
    conn.query_row(
        "SELECT id, scenario_id, run_id, evidence_id, status, title, reproduction_steps_json, expected_result, actual_result, impact_summary, business_role, created_at, updated_at FROM defect_drafts WHERE id=?1 AND owner_id=?2",
        params![id, owner_id],
        read_defect_draft,
    )
    .optional()
    .map_err(db_error)?
    .ok_or_else(|| "NOT_FOUND".to_string())
}

pub(crate) fn save_defect_draft_record(
    conn: &Connection,
    owner_id: &str,
    input: &SaveDefectDraftInput,
) -> Result<DefectDraft, String> {
    validate_defect_draft_input(conn, owner_id, input)?;
    let id = input
        .id
        .clone()
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    if input.id.is_some() {
        let changed = conn
            .execute(
                "UPDATE defect_drafts SET scenario_id=?1, run_id=?2, evidence_id=?3, title=?4, reproduction_steps_json=?5, expected_result=?6, actual_result=?7, impact_summary=?8, business_role=?9, updated_at=CURRENT_TIMESTAMP WHERE id=?10 AND owner_id=?11",
                params![input.scenario_id, input.run_id, input.evidence_id, input.title.trim(), input.reproduction_steps_json, input.expected_result.trim(), input.actual_result.trim(), input.impact_summary.trim(), input.business_role, id, owner_id],
            )
            .map_err(db_error)?;
        if changed == 0 {
            return Err("NOT_FOUND".to_string());
        }
    } else {
        conn.execute(
            "INSERT INTO defect_drafts(id, scenario_id, run_id, evidence_id, status, title, reproduction_steps_json, expected_result, actual_result, impact_summary, business_role, owner_id) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![id, input.scenario_id, input.run_id, input.evidence_id, "pending_confirmation", input.title.trim(), input.reproduction_steps_json, input.expected_result.trim(), input.actual_result.trim(), input.impact_summary.trim(), input.business_role, owner_id],
        )
        .map_err(db_error)?;
    }
    get_defect_draft(conn, owner_id, &id)
}

pub(crate) fn list_defect_drafts_record(
    conn: &Connection,
    owner_id: &str,
) -> Result<Vec<DefectDraft>, String> {
    let mut statement = conn
        .prepare("SELECT id, scenario_id, run_id, evidence_id, status, title, reproduction_steps_json, expected_result, actual_result, impact_summary, business_role, created_at, updated_at FROM defect_drafts WHERE owner_id=?1 ORDER BY updated_at DESC")
        .map_err(db_error)?;
    statement
        .query_map([owner_id], read_defect_draft)
        .map_err(db_error)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(db_error)
}

pub(crate) fn update_defect_draft_status_record(
    conn: &Connection,
    owner_id: &str,
    id: &str,
    status: &str,
) -> Result<DefectDraft, String> {
    validate_defect_status(status)?;
    let current = get_defect_draft(conn, owner_id, id)?;
    if !allows_defect_status_transition(&current.status, status) {
        return Err("INVALID_DEFECT_STATUS_TRANSITION".to_string());
    }
    let changed = conn
        .execute("UPDATE defect_drafts SET status=?1, updated_at=CURRENT_TIMESTAMP WHERE id=?2 AND owner_id=?3", params![status, id, owner_id])
        .map_err(db_error)?;
    if changed == 0 {
        return Err("NOT_FOUND".to_string());
    }
    get_defect_draft(conn, owner_id, id)
}

#[tauri::command]
pub fn list_test_accounts(app: tauri::AppHandle) -> Result<Vec<TestAccount>, String> {
    crate::auth::current_user()?;
    let conn = crate::auth::open_db(&app)?;
    list_test_accounts_record(&conn)
}

#[tauri::command]
pub fn create_test_account(
    app: tauri::AppHandle,
    input: CreateTestAccountInput,
) -> Result<TestAccount, String> {
    let admin = crate::auth::require_admin()?;
    let conn = crate::auth::open_db(&app)?;
    create_test_account_record(&conn, &admin.role, &input)
}

#[tauri::command]
pub fn update_test_account(
    app: tauri::AppHandle,
    input: UpdateTestAccountInput,
) -> Result<TestAccount, String> {
    let admin = crate::auth::require_admin()?;
    let conn = crate::auth::open_db(&app)?;
    update_test_account_record(&conn, &admin.role, &input)
}

#[tauri::command]
pub fn disable_test_account(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let admin = crate::auth::require_admin()?;
    let conn = crate::auth::open_db(&app)?;
    disable_test_account_record(&conn, &admin.role, &id)
}

#[tauri::command]
pub fn set_test_account_credential(
    app: tauri::AppHandle,
    account_id: String,
    username: String,
    password: String,
) -> Result<(), String> {
    crate::auth::require_admin()?;
    validate_credential_value(&username, "USERNAME")?;
    validate_credential_value(&password, "PASSWORD")?;
    let conn = crate::auth::open_db(&app)?;
    let account = get_test_account(&conn, &account_id)?;
    let masked_login_name = mask_login_name(&username);
    let serialized = serde_json::to_string(&StoredCredentialPayload { username, password })
        .map_err(|_| "TEST_ACCOUNT_CREDENTIAL_SERIALIZATION_FAILED".to_string())?;
    keyring::Entry::new(TEST_ACCOUNT_CREDENTIAL_SERVICE, &account.credential_ref)
        .map_err(|_| "TEST_ACCOUNT_CREDENTIAL_UNAVAILABLE".to_string())?
        .set_password(&serialized)
        .map_err(|_| "TEST_ACCOUNT_CREDENTIAL_WRITE_FAILED".to_string())?;
    update_masked_login_name_after_credential_write(&conn, &account.id, &masked_login_name)
}

#[tauri::command]
pub fn list_account_combinations(app: tauri::AppHandle) -> Result<Vec<AccountCombination>, String> {
    let owner = crate::auth::current_user_id()?;
    let conn = crate::auth::open_db(&app)?;
    list_account_combinations_record(&conn, &owner)
}

#[tauri::command]
pub fn save_account_combination(
    app: tauri::AppHandle,
    input: SaveAccountCombinationInput,
) -> Result<AccountCombination, String> {
    let owner = crate::auth::current_user_id()?;
    let conn = crate::auth::open_db(&app)?;
    save_account_combination_record(&conn, &owner, &input)
}

#[tauri::command]
pub fn delete_account_combination(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let owner = crate::auth::current_user_id()?;
    let conn = crate::auth::open_db(&app)?;
    delete_account_combination_record(&conn, &owner, &id)
}

#[tauri::command]
pub fn list_workflow_scenarios(app: tauri::AppHandle) -> Result<Vec<WorkflowScenario>, String> {
    let owner = crate::auth::current_user_id()?;
    let conn = crate::auth::open_db(&app)?;
    list_workflow_scenarios_record(&conn, &owner)
}

#[tauri::command]
pub fn save_workflow_scenario(
    app: tauri::AppHandle,
    input: SaveWorkflowScenarioInput,
) -> Result<WorkflowScenario, String> {
    let owner = crate::auth::current_user_id()?;
    let conn = crate::auth::open_db(&app)?;
    save_workflow_scenario_record(&conn, &owner, &input)
}

#[tauri::command]
pub fn delete_workflow_scenario(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let owner = crate::auth::current_user_id()?;
    let conn = crate::auth::open_db(&app)?;
    delete_workflow_scenario_record(&conn, &owner, &id)
}

#[tauri::command]
pub fn create_workflow_run(
    app: tauri::AppHandle,
    input: CreateWorkflowRunInput,
) -> Result<WorkflowRun, String> {
    let owner = crate::auth::current_user_id()?;
    let conn = crate::auth::open_db(&app)?;
    create_workflow_run_record(&conn, &owner, &input)
}

#[tauri::command]
pub fn update_workflow_run(
    app: tauri::AppHandle,
    input: UpdateWorkflowRunInput,
) -> Result<WorkflowRun, String> {
    let owner = crate::auth::current_user_id()?;
    let conn = crate::auth::open_db(&app)?;
    update_workflow_run_record(&conn, &owner, &input)
}

#[tauri::command]
pub fn list_workflow_runs(app: tauri::AppHandle) -> Result<Vec<WorkflowRun>, String> {
    let owner = crate::auth::current_user_id()?;
    let conn = crate::auth::open_db(&app)?;
    list_workflow_runs_record(&conn, &owner)
}

#[tauri::command]
pub fn append_workflow_run_event(
    app: tauri::AppHandle,
    input: AppendWorkflowRunEventInput,
) -> Result<WorkflowRunEvent, String> {
    let owner = crate::auth::current_user_id()?;
    let mut conn = crate::auth::open_db(&app)?;
    append_workflow_run_event_record(&mut conn, &owner, &input)
}

#[tauri::command]
pub fn list_workflow_run_events(
    app: tauri::AppHandle,
    run_id: String,
) -> Result<Vec<WorkflowRunEvent>, String> {
    let owner = crate::auth::current_user_id()?;
    let conn = crate::auth::open_db(&app)?;
    list_workflow_run_events_record(&conn, &owner, &run_id)
}

#[tauri::command]
pub fn save_failure_evidence(
    app: tauri::AppHandle,
    input: SaveFailureEvidenceInput,
) -> Result<FailureEvidence, String> {
    let owner = crate::auth::current_user_id()?;
    let conn = crate::auth::open_db(&app)?;
    save_failure_evidence_record(&conn, &owner, &input)
}

#[tauri::command]
pub fn list_failure_evidence(
    app: tauri::AppHandle,
    run_id: Option<String>,
) -> Result<Vec<FailureEvidence>, String> {
    let owner = crate::auth::current_user_id()?;
    let conn = crate::auth::open_db(&app)?;
    list_failure_evidence_record(&conn, &owner, run_id.as_deref())
}

#[tauri::command]
pub fn save_defect_draft(
    app: tauri::AppHandle,
    input: SaveDefectDraftInput,
) -> Result<DefectDraft, String> {
    let owner = crate::auth::current_user_id()?;
    let conn = crate::auth::open_db(&app)?;
    save_defect_draft_record(&conn, &owner, &input)
}

#[tauri::command]
pub fn list_defect_drafts(app: tauri::AppHandle) -> Result<Vec<DefectDraft>, String> {
    let owner = crate::auth::current_user_id()?;
    let conn = crate::auth::open_db(&app)?;
    list_defect_drafts_record(&conn, &owner)
}

#[tauri::command]
pub fn update_defect_draft_status(
    app: tauri::AppHandle,
    id: String,
    status: String,
) -> Result<DefectDraft, String> {
    let owner = crate::auth::current_user_id()?;
    let conn = crate::auth::open_db(&app)?;
    update_defect_draft_status_record(&conn, &owner, &id, &status)
}
