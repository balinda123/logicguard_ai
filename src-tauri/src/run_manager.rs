use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::{HashMap, HashSet}, path::PathBuf, sync::{Arc, Mutex}, time::{Duration, Instant}};
use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;
use tokio::{io::{AsyncBufReadExt, AsyncWriteExt, BufReader}, process::{Child, Command}, sync::Notify};
use uuid::Uuid;
use zeroize::Zeroize;
use crate::interaction_guard::{GuardLease, InteractionGuard, LOCK_UNAVAILABLE};

const ACTIVE_STATUSES: &[&str] = &["queued", "preflight", "running", "pause_requested", "paused", "waiting_handoff"];
const SECRET_WORDS: &[&str] = &["password", "token", "otp", "secret", "credential"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunStatus { Queued, Preflight, Running, PauseRequested, Paused, WaitingHandoff, Passed, BusinessFailed, Blocked, Cancelled, Interrupted }

impl RunStatus {
    fn as_str(self) -> &'static str { match self {
        Self::Queued => "queued", Self::Preflight => "preflight", Self::Running => "running",
        Self::PauseRequested => "pause_requested", Self::Paused => "paused", Self::WaitingHandoff => "waiting_handoff",
        Self::Passed => "passed", Self::BusinessFailed => "business_failed", Self::Blocked => "blocked",
        Self::Cancelled => "cancelled", Self::Interrupted => "interrupted",
    }}
    fn parse(value: &str) -> Result<Self, String> { match value {
        "queued" => Ok(Self::Queued), "preflight" => Ok(Self::Preflight), "running" => Ok(Self::Running),
        "pause_requested" => Ok(Self::PauseRequested), "paused" => Ok(Self::Paused), "waiting_handoff" => Ok(Self::WaitingHandoff),
        "passed" => Ok(Self::Passed), "business_failed" => Ok(Self::BusinessFailed), "blocked" => Ok(Self::Blocked),
        "cancelled" => Ok(Self::Cancelled), "interrupted" => Ok(Self::Interrupted),
        _ => Err(format!("INVALID_RUN_STATUS: {value}")),
    }}
    pub fn is_terminal(self) -> bool { matches!(self, Self::Passed | Self::BusinessFailed | Self::Blocked | Self::Cancelled | Self::Interrupted) }
}

pub fn can_transition(from: RunStatus, to: RunStatus) -> bool {
    use RunStatus::*;
    matches!((from, to),
        (Queued, Preflight | Cancelled | Interrupted) |
        (Preflight, Running | WaitingHandoff | Blocked | Cancelled | Interrupted) |
        (Running, PauseRequested | WaitingHandoff | Passed | BusinessFailed | Blocked | Cancelled | Interrupted) |
        (PauseRequested, Paused | BusinessFailed | Blocked | Cancelled | Interrupted) |
        (Paused, Queued | Blocked | Cancelled | Interrupted) |
        (WaitingHandoff, Queued | Blocked | Cancelled | Interrupted))
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecutionPlan { pub commands: Vec<Value> }

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartRunInput { pub execution_plan: ExecutionPlan, pub snapshot: Value }

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RunAccountSnapshot {
    id: String,
    role: String,
    role_name: String,
    display_name: String,
    login_mode: String,
    allowed_origin: String,
    #[serde(default)]
    handoff_origins: Vec<String>,
    login_page_url: String,
    page_locator: Option<String>,
    identity_locator: Option<String>,
    private_locator: Option<String>,
    submit_locator: Option<String>,
    success_locator: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RunRoleStepSnapshot { command_index: usize, role: String, account_id: String }

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AccountOrchestrationSnapshot {
    system_id: String,
    environment_id: String,
    combination_id: String,
    accounts: Vec<RunAccountSnapshot>,
    role_steps: Vec<RunRoleStepSnapshot>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct IsolatedLoginPayload {
    allowed_origin: String,
    handoff_origins: Vec<String>,
    login_url: String,
    page_locator: Option<String>,
    identity_locator: Option<String>,
    private_locator: Option<String>,
    submit_locator: Option<String>,
    success_locator: Option<String>,
    expected_account_label: String,
    expected_system_label: String,
    role_name: String,
    username: String,
    password: String,
}

impl Drop for IsolatedLoginPayload {
    fn drop(&mut self) { self.username.zeroize(); self.password.zeroize(); }
}

struct SecretProcessValue(String);
impl Drop for SecretProcessValue { fn drop(&mut self){self.0.zeroize();} }

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionRun {
    pub id: String, pub owner_id: String, pub status: RunStatus, pub current_step: i64,
    pub checkpoint: Option<Value>, pub snapshot: Value, pub execution_plan: ExecutionPlan,
    pub error_category: Option<String>, pub error_message: Option<String>, pub worker_pid: Option<u32>,
    pub lease_owner: Option<String>, pub lease_expires_at: Option<String>, pub started_at: Option<String>,
    pub finished_at: Option<String>, pub created_at: String, pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionRunEvent { pub run_id: String, pub sequence: i64, pub kind: String, pub data: Value, pub created_at: String }

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionIssue {
    pub id: String, pub run_id: String, pub status: String, pub title: String,
    pub reproduction_steps: Vec<String>, pub expected_result: String, pub actual_result: String,
    pub impact: String, pub role: Option<String>, pub system_id: Option<String>,
    pub environment_id: Option<String>, pub created_at: String, pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RunModelSnapshot { provider: String, model: String, base_url: Option<String> }

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateExecutionIssueInput {
    pub id: String, pub title: String, pub reproduction_steps: Vec<String>,
    pub expected_result: String, pub actual_result: String, pub impact: String,
    pub role: Option<String>,
}

#[derive(Debug, Clone, Serialize)] struct RunUpdatePayload { run: ExecutionRun }
#[derive(Debug, Clone, Serialize)] struct RunEventPayload { event: ExecutionRunEvent }

pub fn initialize_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "PRAGMA foreign_keys=ON;
         CREATE TABLE IF NOT EXISTS execution_runs (
           id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN
             ('queued','preflight','running','pause_requested','paused','waiting_handoff','passed','business_failed','blocked','cancelled','interrupted')),
           current_step INTEGER NOT NULL DEFAULT 0 CHECK(current_step >= 0), checkpoint_json TEXT,
           snapshot_json TEXT NOT NULL, execution_plan_json TEXT NOT NULL, error_category TEXT, error_message TEXT,
           worker_pid INTEGER, lease_owner TEXT, lease_expires_at TEXT, started_at TEXT, finished_at TEXT,
           browser_pid INTEGER,
           created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
         );
         CREATE INDEX IF NOT EXISTS idx_execution_runs_owner_created ON execution_runs(owner_id, created_at DESC);
         CREATE INDEX IF NOT EXISTS idx_execution_runs_status ON execution_runs(status);
         CREATE TABLE IF NOT EXISTS execution_events (
           run_id TEXT NOT NULL REFERENCES execution_runs(id) ON DELETE CASCADE, sequence INTEGER NOT NULL,
           kind TEXT NOT NULL, data_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
           PRIMARY KEY(run_id, sequence)
         );
         CREATE TABLE IF NOT EXISTS execution_issues (
           id TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE REFERENCES execution_runs(id) ON DELETE CASCADE,
           owner_id TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN
             ('pending_confirmation','pending_fix','pending_validation','closed','not_a_bug')),
           title TEXT NOT NULL, reproduction_steps_json TEXT NOT NULL, expected_result TEXT NOT NULL,
           actual_result TEXT NOT NULL, impact TEXT NOT NULL,
           role TEXT CHECK(role IN ('employee','manager','hrbp')), system_id TEXT, environment_id TEXT,
           created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
         );
         CREATE INDEX IF NOT EXISTS idx_execution_issues_owner_status ON execution_issues(owner_id, status, updated_at DESC);"
    ).map_err(|e| e.to_string())?;
    let _ = conn.execute("ALTER TABLE execution_runs ADD COLUMN browser_pid INTEGER", []);
    Ok(())
}

fn json_text(value: &Value) -> Result<String, String> { serde_json::to_string(value).map_err(|e| e.to_string()) }
fn plan_text(value: &ExecutionPlan) -> Result<String, String> { serde_json::to_string(value).map_err(|e| e.to_string()) }

#[cfg(test)]
pub fn insert_run_for_test(conn: &Connection, id: &str, status: RunStatus, plan: &ExecutionPlan, snapshot: &Value) -> Result<(), String> {
    conn.execute("INSERT INTO execution_runs(id,owner_id,status,snapshot_json,execution_plan_json) VALUES(?1,'test-owner',?2,?3,?4)",
        params![id, status.as_str(), json_text(snapshot)?, plan_text(plan)?]).map_err(|e| e.to_string())?;
    Ok(())
}

fn read_run(row: &rusqlite::Row<'_>) -> rusqlite::Result<ExecutionRun> {
    let status: String = row.get(2)?; let checkpoint: Option<String> = row.get(4)?;
    let snapshot: String = row.get(5)?; let plan: String = row.get(6)?;
    Ok(ExecutionRun {
        id: row.get(0)?, owner_id: row.get(1)?, status: RunStatus::parse(&status).map_err(|e| rusqlite::Error::FromSqlConversionFailure(2, rusqlite::types::Type::Text, std::io::Error::new(std::io::ErrorKind::InvalidData,e).into()))?,
        current_step: row.get(3)?, checkpoint: checkpoint.map(|v| serde_json::from_str(&v)).transpose().map_err(|e| rusqlite::Error::FromSqlConversionFailure(4, rusqlite::types::Type::Text, e.into()))?,
        snapshot: serde_json::from_str(&snapshot).map_err(|e| rusqlite::Error::FromSqlConversionFailure(5, rusqlite::types::Type::Text, e.into()))?,
        execution_plan: serde_json::from_str(&plan).map_err(|e| rusqlite::Error::FromSqlConversionFailure(6, rusqlite::types::Type::Text, e.into()))?,
        error_category: row.get(7)?, error_message: row.get(8)?, worker_pid: row.get(9)?, lease_owner: row.get(10)?,
        lease_expires_at: row.get(11)?, started_at: row.get(12)?, finished_at: row.get(13)?, created_at: row.get(14)?, updated_at: row.get(15)?,
    })
}

const RUN_COLUMNS: &str = "id,owner_id,status,current_step,checkpoint_json,snapshot_json,execution_plan_json,error_category,error_message,worker_pid,lease_owner,lease_expires_at,started_at,finished_at,created_at,updated_at";

pub fn load_run(conn: &Connection, id: &str) -> Result<Option<ExecutionRun>, String> {
    conn.query_row(&format!("SELECT {RUN_COLUMNS} FROM execution_runs WHERE id=?1"), [id], read_run).optional().map_err(|e| e.to_string())
}

fn list_run_records(conn: &Connection, owner: &str, active_only: bool) -> Result<Vec<ExecutionRun>, String> {
    let sql = if active_only {
        format!("SELECT {RUN_COLUMNS} FROM execution_runs WHERE owner_id=?1 AND status IN ('queued','preflight','running','pause_requested','paused','waiting_handoff') ORDER BY created_at")
    } else { format!("SELECT {RUN_COLUMNS} FROM execution_runs WHERE owner_id=?1 ORDER BY created_at DESC") };
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows=stmt.query_map([owner], read_run).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

const EXECUTION_ISSUE_STATUSES: &[&str] = &[
    "pending_confirmation", "pending_fix", "pending_validation", "closed", "not_a_bug",
];

fn issue_status_is_valid(status: &str) -> bool {
    EXECUTION_ISSUE_STATUSES.contains(&status)
}

fn issue_status_transition_allowed(current: &str, next: &str) -> bool {
    matches!(
        (current, next),
        ("pending_confirmation", "pending_fix" | "not_a_bug")
            | ("pending_fix", "pending_validation")
            | ("pending_validation", "closed" | "pending_fix")
    )
}

fn issue_role(value: Option<&String>) -> Result<Option<&str>, String> {
    match value.map(String::as_str) {
        Some("employee" | "manager" | "hrbp") => Ok(value.map(String::as_str)),
        Some(_) => Err("INVALID_ISSUE_ROLE".to_string()),
        None => Ok(None),
    }
}

fn issue_step(command: &Value, index: usize) -> String {
    let detail = command.get("instruction").and_then(Value::as_str)
        .or_else(|| command.get("step").and_then(|step| step.get("action")).and_then(Value::as_str))
        .or_else(|| command.get("step").and_then(|step| step.get("url")).and_then(Value::as_str));
    detail.map(sanitize).filter(|text| !text.is_empty()).unwrap_or_else(|| format!("执行第 {} 个测试步骤", index + 1))
}

fn read_execution_issue(row: &rusqlite::Row<'_>) -> rusqlite::Result<ExecutionIssue> {
    let reproduction_steps_json: String = row.get(4)?;
    Ok(ExecutionIssue {
        id: row.get(0)?, run_id: row.get(1)?, status: row.get(2)?, title: row.get(3)?,
        reproduction_steps: serde_json::from_str(&reproduction_steps_json).unwrap_or_default(),
        expected_result: row.get(5)?, actual_result: row.get(6)?, impact: row.get(7)?,
        role: row.get(8)?, system_id: row.get(9)?, environment_id: row.get(10)?,
        created_at: row.get(11)?, updated_at: row.get(12)?,
    })
}

const EXECUTION_ISSUE_COLUMNS: &str = "id,run_id,status,title,reproduction_steps_json,expected_result,actual_result,impact,role,system_id,environment_id,created_at,updated_at";

fn create_business_issue(conn: &Connection, run: &ExecutionRun) -> Result<(), String> {
    let suite_name = run.snapshot.get("suiteName").and_then(Value::as_str)
        .or_else(|| run.snapshot.get("designTitle").and_then(Value::as_str))
        .unwrap_or("测试运行");
    let title = format!("{}：业务验证失败", sanitize(suite_name));
    let steps = run.execution_plan.commands.iter().enumerate().map(|(index, command)| issue_step(command, index)).collect::<Vec<_>>();
    let role = run.checkpoint.as_ref().and_then(|checkpoint| checkpoint.get("activeRole")).and_then(Value::as_str)
        .filter(|role| matches!(*role, "employee" | "manager" | "hrbp"));
    let actual_result = sanitize(run.error_message.as_deref().unwrap_or("测试执行中的业务断言未通过。"));
    let reproduction_steps_json = serde_json::to_string(&steps).map_err(|error| error.to_string())?;
    conn.execute(
        "INSERT OR IGNORE INTO execution_issues(id,run_id,owner_id,status,title,reproduction_steps_json,expected_result,actual_result,impact,role,system_id,environment_id) VALUES(?1,?2,?3,'pending_confirmation',?4,?5,?6,?7,?8,?9,?10,?11)",
        params![Uuid::new_v4().to_string(), run.id, run.owner_id, title, reproduction_steps_json,
            "所选测试用例应按预期完成并通过业务断言。", actual_result,
            "当前测试运行已停止，需确认是否为产品缺陷。", role,
            run.snapshot.get("systemId").and_then(Value::as_str),
            run.snapshot.get("environmentId").and_then(Value::as_str)],
    ).map_err(|error| error.to_string())?;
    Ok(())
}

fn backfill_business_issues(conn: &Connection, owner_id: &str) -> Result<(), String> {
    let run_ids = {
        let mut statement = conn.prepare("SELECT id FROM execution_runs WHERE owner_id=?1 AND status='business_failed' ORDER BY created_at")
            .map_err(|error| error.to_string())?;
        let ids = statement.query_map([owner_id], |row| row.get::<_, String>(0)).map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())?;
        ids
    };
    for run_id in run_ids {
        if let Some(run) = load_run(conn, &run_id)? {
            create_business_issue(conn, &run)?;
        }
    }
    Ok(())
}

fn list_execution_issue_records(conn: &Connection, owner_id: &str) -> Result<Vec<ExecutionIssue>, String> {
    backfill_business_issues(conn, owner_id)?;
    let mut statement = conn.prepare(&format!("SELECT {EXECUTION_ISSUE_COLUMNS} FROM execution_issues WHERE owner_id=?1 ORDER BY updated_at DESC"))
        .map_err(|error| error.to_string())?;
    let issues = statement.query_map([owner_id], read_execution_issue).map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())?;
    Ok(issues)
}

fn get_execution_issue(conn: &Connection, owner_id: &str, id: &str) -> Result<ExecutionIssue, String> {
    conn.query_row(&format!("SELECT {EXECUTION_ISSUE_COLUMNS} FROM execution_issues WHERE id=?1 AND owner_id=?2"), params![id, owner_id], read_execution_issue)
        .optional().map_err(|error| error.to_string())?.ok_or_else(|| "NOT_FOUND".to_string())
}

fn update_execution_issue_record(conn: &Connection, owner_id: &str, input: &UpdateExecutionIssueInput) -> Result<ExecutionIssue, String> {
    if input.title.trim().is_empty() || input.expected_result.trim().is_empty() || input.actual_result.trim().is_empty() || input.impact.trim().is_empty() {
        return Err("ISSUE_CONTENT_REQUIRED".to_string());
    }
    let role = issue_role(input.role.as_ref())?;
    let steps = input.reproduction_steps.iter().map(|step| sanitize(step)).filter(|step| !step.is_empty()).collect::<Vec<_>>();
    if steps.is_empty() { return Err("ISSUE_STEPS_REQUIRED".to_string()); }
    let steps_json = serde_json::to_string(&steps).map_err(|error| error.to_string())?;
    let changed = conn.execute(
        "UPDATE execution_issues SET title=?1,reproduction_steps_json=?2,expected_result=?3,actual_result=?4,impact=?5,role=?6,updated_at=CURRENT_TIMESTAMP WHERE id=?7 AND owner_id=?8",
        params![sanitize(&input.title), steps_json, sanitize(&input.expected_result), sanitize(&input.actual_result), sanitize(&input.impact), role, input.id, owner_id],
    ).map_err(|error| error.to_string())?;
    if changed == 0 { return Err("NOT_FOUND".to_string()); }
    get_execution_issue(conn, owner_id, &input.id)
}

fn update_execution_issue_status_record(conn: &Connection, owner_id: &str, id: &str, status: &str) -> Result<ExecutionIssue, String> {
    if !issue_status_is_valid(status) { return Err("INVALID_ISSUE_STATUS".to_string()); }
    let current = get_execution_issue(conn, owner_id, id)?;
    if !issue_status_transition_allowed(&current.status, status) { return Err("INVALID_ISSUE_STATUS_TRANSITION".to_string()); }
    conn.execute("UPDATE execution_issues SET status=?1,updated_at=CURRENT_TIMESTAMP WHERE id=?2 AND owner_id=?3", params![status, id, owner_id])
        .map_err(|error| error.to_string())?;
    get_execution_issue(conn, owner_id, id)
}

fn delete_run_record(conn: &Connection, owner: &str, id: &str) -> Result<(), String> {
    let run = load_run(conn, id)?.filter(|run| run.owner_id == owner).ok_or("NOT_FOUND")?;
    if !run.status.is_terminal() { return Err("RUN_NOT_TERMINAL".into()); }
    let changed = conn.execute("DELETE FROM execution_runs WHERE id=?1 AND owner_id=?2", params![id, owner]).map_err(|error| error.to_string())?;
    if changed == 1 { Ok(()) } else { Err("NOT_FOUND".into()) }
}

pub fn append_event(conn: &mut Connection, run_id: &str, kind: &str, data: &Value) -> Result<ExecutionRunEvent, String> {
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
    let sequence: i64 = tx.query_row("SELECT COALESCE(MAX(sequence),0)+1 FROM execution_events WHERE run_id=?1", [run_id], |r| r.get(0)).map_err(|e| e.to_string())?;
    tx.execute("INSERT INTO execution_events(run_id,sequence,kind,data_json) VALUES(?1,?2,?3,?4)", params![run_id, sequence, kind, json_text(data)?]).map_err(|e| e.to_string())?;
    let created_at: String = tx.query_row("SELECT created_at FROM execution_events WHERE run_id=?1 AND sequence=?2", params![run_id, sequence], |r| r.get(0)).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(ExecutionRunEvent { run_id: run_id.into(), sequence, kind: kind.into(), data: data.clone(), created_at })
}

fn events_after(conn: &Connection, run_id: &str, after: i64) -> Result<Vec<ExecutionRunEvent>, String> {
    let mut stmt = conn.prepare("SELECT run_id,sequence,kind,data_json,created_at FROM execution_events WHERE run_id=?1 AND sequence>?2 ORDER BY sequence").map_err(|e| e.to_string())?;
    let rows=stmt.query_map(params![run_id, after], |r| { let raw: String = r.get(3)?; Ok(ExecutionRunEvent { run_id:r.get(0)?, sequence:r.get(1)?, kind:r.get(2)?, data:serde_json::from_str(&raw).map_err(|e| rusqlite::Error::FromSqlConversionFailure(3,rusqlite::types::Type::Text,e.into()))?, created_at:r.get(4)? }) }).map_err(|e|e.to_string())?;
    rows.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())
}

#[cfg(test)]
pub fn replace_snapshot_for_test(conn: &Connection, id: &str, snapshot: &Value) -> Result<(), String> {
    let changed = conn.execute("UPDATE execution_runs SET snapshot_json=?1 WHERE id=?2 AND 0", params![json_text(snapshot)?, id]).map_err(|e| e.to_string())?;
    if changed == 0 { Err("SNAPSHOT_IMMUTABLE".into()) } else { Ok(()) }
}

pub fn recover_interrupted(conn: &Connection) -> Result<usize, String> {
    conn.execute(&format!("UPDATE execution_runs SET status='interrupted',error_category='interrupted',error_message='Application restarted without a recoverable worker',worker_pid=NULL,browser_pid=NULL,lease_owner=NULL,lease_expires_at=NULL,finished_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE status IN ({})", ACTIVE_STATUSES.iter().map(|_| "?").collect::<Vec<_>>().join(",")), rusqlite::params_from_iter(ACTIVE_STATUSES.iter().copied())).map_err(|e|e.to_string())
}

pub fn releases_interaction_guard(status: RunStatus) -> bool {
    status.is_terminal() || matches!(status, RunStatus::Paused | RunStatus::WaitingHandoff)
}

pub fn status_after_guard_acquisition(acquired: bool) -> RunStatus {
    if acquired { RunStatus::Running } else { RunStatus::Blocked }
}

fn contains_secret(value: &Value) -> bool { match value {
    Value::String(v) => { let lower=v.to_ascii_lowercase(); SECRET_WORDS.iter().any(|word| lower.contains(word)) || ((v.contains("{{") || v.contains("${")) && lower.contains('}')) },
    Value::Array(items) => items.iter().any(contains_secret),
    Value::Object(map) => map.iter().any(|(key,value)| SECRET_WORDS.iter().any(|word| key.to_ascii_lowercase().contains(word)) || contains_secret(value)),
    _ => false,
}}

fn contains_snapshot_secret(value:&Value,key:Option<&str>)->bool{match value{
    Value::String(text) if key.map(|name|name.ends_with("Locator")).unwrap_or(false)=>text.contains("{{")||text.contains("${")||text.to_ascii_lowercase().contains("bearer "),
    Value::String(_)=>contains_secret(value),
    Value::Array(items)=>items.iter().any(|item|contains_snapshot_secret(item,key)),
    Value::Object(map)=>map.iter().any(|(name,item)|SECRET_WORDS.iter().any(|word|name.to_ascii_lowercase().contains(word))||contains_snapshot_secret(item,Some(name))),
    _=>false,
}}

fn valid_origin(raw: &str) -> bool {
    let Ok(url)=reqwest::Url::parse(raw) else{return false};
    let host=url.host_str().unwrap_or_default();
    let allowed_scheme=url.scheme()=="https" || (url.scheme()=="http" && matches!(host,"localhost"|"127.0.0.1"|"::1"));
    allowed_scheme && url.username().is_empty() && url.password().is_none() && url.path()=="/" && url.query().is_none() && url.fragment().is_none()
}

fn validate_locator(locator:&Value)->Result<(),String>{
    let object=locator.as_object().ok_or("INVALID_LOCATOR")?;
    let allowed:HashSet<&str>=["kind","value","name","exact"].into_iter().collect();
    if object.keys().any(|key|!allowed.contains(key.as_str())){return Err("UNKNOWN_LOCATOR_FIELD".into())}
    let kind=object.get("kind").and_then(Value::as_str).ok_or("UNKNOWN_LOCATOR")?;
    if !matches!(kind,"role"|"label"|"text"|"placeholder"|"testId"|"css"){return Err("UNKNOWN_LOCATOR".into())}
    if !object.get("value").and_then(Value::as_str).map(|v|!v.trim().is_empty()&&v.len()<=1024).unwrap_or(false){return Err("EMPTY_LOCATOR_VALUE".into())}
    if object.contains_key("name") && (kind!="role" || !object.get("name").and_then(Value::as_str).map(|v|!v.trim().is_empty()).unwrap_or(false)){return Err("INVALID_LOCATOR_NAME".into())}
    if object.contains_key("exact") && (kind=="css" || !object.get("exact").map(Value::is_boolean).unwrap_or(false)){return Err("INVALID_LOCATOR_EXACT".into())}
    Ok(())
}

fn validate_step(step:&Value)->Result<(),String>{
    let object=step.as_object().ok_or("INVALID_STEP")?;
    let action=object.get("action").and_then(Value::as_str).ok_or("UNKNOWN_ACTION")?;
    let allowed:HashSet<&str>=match action{
        "navigate"=>["action","url"].into_iter().collect(),
        "click"|"read"=>["action","locator"].into_iter().collect(),
        "fill"|"select"=>["action","locator","value"].into_iter().collect(),
        "press"=>["action","locator","key"].into_iter().collect(),
        "wait"=>["action","locator","durationMs"].into_iter().collect(),
        "assert"=>["action","locator","condition","expected"].into_iter().collect(),
        _=>return Err("UNKNOWN_ACTION".into()),
    };
    if object.keys().any(|key|!allowed.contains(key.as_str())){return Err("UNKNOWN_STEP_FIELD".into())}
    if action=="navigate" && !object.get("url").and_then(Value::as_str).map(|v|reqwest::Url::parse(v).map(|u|matches!(u.scheme(),"http"|"https")&&u.username().is_empty()&&u.password().is_none()).unwrap_or(false)).unwrap_or(false){return Err("INVALID_URL".into())}
    if let Some(locator)=object.get("locator"){validate_locator(locator)?}
    if action!="navigate" && action!="wait" && !object.contains_key("locator"){return Err("INVALID_LOCATOR".into())}
    if action=="wait" {
        let locator=object.get("locator").map(Value::is_object).unwrap_or(false);let duration=object.get("durationMs").and_then(Value::as_u64).map(|v|(1..=60_000).contains(&v)).unwrap_or(false);
        if locator==duration{return Err("INVALID_WAIT_TARGET".into())}
    }
    if matches!(action,"fill"|"select") && !object.get("value").and_then(Value::as_str).map(|v|!v.trim().is_empty()&&v.len()<=4096).unwrap_or(false){return Err("EMPTY_VALUE".into())}
    if action=="press" && !object.get("key").and_then(Value::as_str).map(|v|!v.trim().is_empty()&&v.len()<=64).unwrap_or(false){return Err("INVALID_KEY".into())}
    if action=="assert" {
        let condition=object.get("condition").and_then(Value::as_str).ok_or("INVALID_ASSERT_CONDITION")?;
        if !matches!(condition,"visible"|"hidden"|"equals"|"contains"){return Err("INVALID_ASSERT_CONDITION".into())}
        let expected=object.get("expected").and_then(Value::as_str).map(|v|!v.trim().is_empty()).unwrap_or(false);
        if matches!(condition,"equals"|"contains")!=expected{return Err("INVALID_ASSERT_EXPECTED".into())}
    }
    Ok(())
}

pub fn validate_plan(plan: &ExecutionPlan) -> Result<(), String> {
    if plan.commands.is_empty() || plan.commands.len() > 500 { return Err("INVALID_EXECUTION_PLAN_LENGTH".into()); }
    for command in &plan.commands {
        if contains_secret(command) { return Err("SECRET_NOT_ALLOWED".into()); }
        let object = command.as_object().ok_or("COMMAND_MUST_BE_OBJECT")?;
        let kind = object.get("command").and_then(Value::as_str).ok_or("MISSING_COMMAND")?;
        if !matches!(kind, "execute" | "observe" | "act" | "agent" | "assert_page") { return Err("UNKNOWN_COMMAND".into()); }
        let allowed: HashSet<&str> = match kind {
            "execute" => ["command","step","allowedOrigins","timeoutMs"].into_iter().collect(),
            "observe" => ["command","instruction","allowedOrigins","timeoutMs"].into_iter().collect(),
            "act" => ["command","title","details","instruction","fallbackGoal","maxActions","allowedOrigins","timeoutMs"].into_iter().collect(),
            "assert_page" => ["command","title","details","assertions","allowedOrigins","timeoutMs"].into_iter().collect(),
            _ => ["command","title","details","goal","allowedOrigins","timeoutMs","maxActions"].into_iter().collect(),
        };
        if object.keys().any(|key| !allowed.contains(key.as_str())) { return Err("UNKNOWN_COMMAND_FIELD".into()); }
        let origins = object.get("allowedOrigins").and_then(Value::as_array).ok_or("MISSING_ALLOWED_ORIGINS")?;
        if origins.is_empty() || origins.len() > 20 || origins.iter().any(|v| !v.as_str().map(valid_origin).unwrap_or(false)) { return Err("INVALID_ALLOWED_ORIGINS".into()); }
        let timeout = object.get("timeoutMs").and_then(Value::as_u64).ok_or("INVALID_TIMEOUT_MS")?;
        if timeout == 0 || timeout > 300_000 { return Err("INVALID_TIMEOUT_MS".into()); }
        if kind == "execute" { validate_step(object.get("step").ok_or("INVALID_STEP")?)?; }
        if matches!(kind,"observe"|"act") && !object.get("instruction").and_then(Value::as_str).map(|v|!v.trim().is_empty()).unwrap_or(false) { return Err("INVALID_INSTRUCTION".into()); }
        if kind=="act" {
            let has_fallback=object.get("fallbackGoal").is_some();
            if has_fallback&&!object.get("fallbackGoal").and_then(Value::as_str).map(|value|!value.trim().is_empty()&&value.len()<=4096).unwrap_or(false){return Err("INVALID_FALLBACK_GOAL".into())}
            if has_fallback!=object.get("maxActions").is_some(){return Err("INVALID_MAX_ACTIONS".into())}
            if has_fallback&&!(1..=8).contains(&object.get("maxActions").and_then(Value::as_u64).unwrap_or(0)){return Err("INVALID_MAX_ACTIONS".into())}
        }
        if kind=="assert_page" {
            let assertions=object.get("assertions").and_then(Value::as_array).ok_or("INVALID_PAGE_ASSERTIONS")?;
            if assertions.is_empty()||assertions.len()>8{return Err("INVALID_PAGE_ASSERTIONS".into())}
            for assertion in assertions {
                let item=assertion.as_object().ok_or("INVALID_PAGE_ASSERTION")?;
                if item.keys().any(|key|!matches!(key.as_str(),"type"|"expected")){return Err("UNKNOWN_PAGE_ASSERTION_FIELD".into())}
                if !item.get("type").and_then(Value::as_str).map(|value|matches!(value,"text_contains"|"text_absent"|"url_contains")).unwrap_or(false){return Err("INVALID_PAGE_ASSERTION_TYPE".into())}
                if !item.get("expected").and_then(Value::as_str).map(|value|!value.trim().is_empty()&&value.len()<=500).unwrap_or(false){return Err("INVALID_PAGE_ASSERTION_EXPECTED".into())}
            }
        }
        // 展示字段适用于 Agent、快速动作和结构化断言；所有命令共用相同长度边界，避免执行日志被异常内容撑爆。
        if object.get("title").is_some()&&!object.get("title").and_then(Value::as_str).map(|value|!value.trim().is_empty()&&value.len()<=160).unwrap_or(false){return Err("INVALID_COMMAND_TITLE".into())}
        if let Some(details)=object.get("details"){
            let values=details.as_array().ok_or("INVALID_COMMAND_DETAILS")?;
            if values.is_empty()||values.len()>10||values.iter().any(|value|!value.as_str().map(|item|!item.trim().is_empty()&&item.len()<=500).unwrap_or(false)){return Err("INVALID_COMMAND_DETAILS".into())}
        }
        if kind == "agent" {
            if !object.get("goal").and_then(Value::as_str).map(|v|!v.trim().is_empty()).unwrap_or(false) { return Err("INVALID_GOAL".into()); }
            if !(1..=20).contains(&object.get("maxActions").and_then(Value::as_u64).unwrap_or(0)) { return Err("INVALID_MAX_ACTIONS".into()); }
        }
    }
    Ok(())
}

#[derive(Default)] pub struct LeaseCoordinator { owner: Option<String> }
impl LeaseCoordinator {
    pub fn try_acquire(&mut self, run_id: &str) -> bool { if self.owner.is_none() { self.owner=Some(run_id.into()); true } else { self.owner.as_deref()==Some(run_id) } }
    pub fn release(&mut self, run_id: &str) { if self.owner.as_deref()==Some(run_id) { self.owner=None; } }
}

#[derive(Default)] pub struct RunControl { pause_requested: bool, cancelled: bool }
#[derive(Debug, PartialEq, Eq)] pub enum ControlDecision { Continue, PauseAt(i64), Cancel }
impl RunControl {
    pub fn request_pause(&mut self) { self.pause_requested=true; }
    fn cancel(&mut self) { self.cancelled=true; }
    #[cfg(test)]
    pub fn status_during_command(&self) -> RunStatus { if self.pause_requested { RunStatus::PauseRequested } else { RunStatus::Running } }
    pub fn after_command(&self, checkpoint:i64)->ControlDecision { if self.cancelled {ControlDecision::Cancel} else if self.pause_requested {ControlDecision::PauseAt(checkpoint)} else {ControlDecision::Continue} }
}
#[cfg(test)]
pub fn resume_target(revalidation: Result<(),String>)->RunStatus { if revalidation.is_ok(){RunStatus::Queued}else{RunStatus::Blocked} }
#[cfg(test)]
pub fn completion_for_stop(cancelled:bool, recovered:bool)->RunStatus { if cancelled{RunStatus::Cancelled}else if recovered{RunStatus::Interrupted}else{RunStatus::Blocked} }

#[derive(Debug,Clone,Copy,PartialEq,Eq)] pub enum ErrorCategory { InvalidRequest, ModelResponse, RateLimited, Timeout, Connection, BusinessAssertion, Cancelled, Interrupted }
impl ErrorCategory { fn as_str(self)->&'static str { match self { Self::InvalidRequest=>"invalid_request",Self::ModelResponse=>"model_response",Self::RateLimited=>"rate_limited",Self::Timeout=>"timeout",Self::Connection=>"connection",Self::BusinessAssertion=>"business_assertion",Self::Cancelled=>"cancelled",Self::Interrupted=>"interrupted" } } }
#[derive(Debug,PartialEq,Eq)] pub enum RetryDecision { RetryAfter(u64), Blocked, BusinessFailed, Cancelled, Interrupted }
pub struct RetryPolicy { pub max_attempts:u32, pub base_delay_ms:u64 }
impl RetryPolicy { pub fn decision(&self,attempt:u32,category:ErrorCategory)->RetryDecision { match category { ErrorCategory::BusinessAssertion=>RetryDecision::BusinessFailed, ErrorCategory::Cancelled=>RetryDecision::Cancelled, ErrorCategory::Interrupted=>RetryDecision::Interrupted, ErrorCategory::ModelResponse|ErrorCategory::RateLimited|ErrorCategory::Timeout|ErrorCategory::Connection if attempt<self.max_attempts=>RetryDecision::RetryAfter(self.base_delay_ms.saturating_mul(1u64 << attempt.saturating_sub(1))), _=>RetryDecision::Blocked } } }

fn account_orchestration(snapshot:&Value, command_count:usize)->Result<Option<AccountOrchestrationSnapshot>,String>{
    let Some(raw)=snapshot.get("accountOrchestration") else{return Ok(None)};
    let value:AccountOrchestrationSnapshot=serde_json::from_value(raw.clone()).map_err(|_|"INVALID_ACCOUNT_ORCHESTRATION".to_string())?;
    if value.system_id!=snapshot.get("systemId").and_then(Value::as_str).unwrap_or_default()
        || value.environment_id!=snapshot.get("environmentId").and_then(Value::as_str).unwrap_or_default()
        || value.combination_id.trim().is_empty() || value.accounts.is_empty() || value.role_steps.is_empty(){return Err("ACCOUNT_SNAPSHOT_SCOPE_MISMATCH".into())}
    let mut ids=HashSet::new();
    for account in &value.accounts{
        if !ids.insert(account.id.as_str()) || account.role.trim().is_empty() || account.role.len()>64
            || account.role_name.trim().is_empty() || account.display_name.trim().is_empty()
            || !matches!(account.login_mode.as_str(),"automatic"|"manual_sso"|"manual_otp")
            || !valid_origin(&account.allowed_origin)
            || account.handoff_origins.len()>8 || account.handoff_origins.iter().any(|origin|!valid_origin(origin))
            || reqwest::Url::parse(&account.login_page_url).ok().map(|url|url.username().is_empty()&&url.password().is_none()&&matches!(url.scheme(),"http"|"https")&&url.origin().ascii_serialization()==account.allowed_origin).unwrap_or(false)==false{return Err("INVALID_ACCOUNT_SNAPSHOT".into())}
    }
    let mut previous=None;
    for step in &value.role_steps{
        if step.command_index>=command_count || previous.map(|index|step.command_index<=index).unwrap_or(false){return Err("INVALID_ROLE_STEP_ORDER".into())}
        let account=value.accounts.iter().find(|account|account.id==step.account_id).ok_or("ACCOUNT_SNAPSHOT_MISMATCH")?;
        if account.role!=step.role{return Err("ACCOUNT_SNAPSHOT_MISMATCH".into())}
        previous=Some(step.command_index);
    }
    Ok(Some(value))
}

fn role_account_at(orchestration:&AccountOrchestrationSnapshot,index:usize)->Option<&RunAccountSnapshot>{
    let role_step=orchestration.role_steps.iter().rev().find(|step|step.command_index<=index)?;
    orchestration.accounts.iter().find(|account|account.id==role_step.account_id && account.role==role_step.role)
}

fn command_with_navigation_handoff(command:&Value,orchestration:Option<&AccountOrchestrationSnapshot>)->Value{
    let mut result=command.clone();
    let is_navigation=command.get("command").and_then(Value::as_str)==Some("execute")
        && command.get("step").and_then(|step|step.get("action")).and_then(Value::as_str)==Some("navigate");
    if !is_navigation{return result}
    let Some(accounts)=orchestration.map(|value|&value.accounts) else{return result};
    let Some(origins)=result.get_mut("allowedOrigins").and_then(Value::as_array_mut) else{return result};
    let mut known=origins.iter().filter_map(Value::as_str).map(str::to_string).collect::<HashSet<_>>();
    // 可信登录域名只扩展导航命令，允许 302 落到 SSO 后交给登录器判断；业务动作仍使用计划中的业务域名白名单。
    for origin in accounts.iter().flat_map(|account|account.handoff_origins.iter()){
        if known.insert(origin.clone()){origins.push(Value::String(origin.clone()));}
    }
    result
}

fn checkpoint_text<'a>(run:&'a ExecutionRun,key:&str)->Option<&'a str>{run.checkpoint.as_ref()?.get(key)?.as_str()}

fn run_model(snapshot:&Value)->Result<RunModelSnapshot,String>{
    // 历史运行快照没有模型字段；仅为这些存量记录保留旧默认值，新任务始终固化用户当前配置。
    let Some(raw)=snapshot.get("llmRuntime").cloned() else{return Ok(default_worker_model())};
    let value:RunModelSnapshot=serde_json::from_value(raw).map_err(|_|"INVALID_RUN_MODEL".to_string())?;
    validate_worker_model(value)
}

fn validate_worker_model(value:RunModelSnapshot)->Result<RunModelSnapshot,String>{
    if !matches!(value.provider.as_str(),"gemini"|"openai_compat") || value.model.trim().is_empty() || value.model.len()>128{return Err("INVALID_RUN_MODEL".into())}
    if let Some(base)=&value.base_url{let url=reqwest::Url::parse(base).map_err(|_|"INVALID_RUN_MODEL".to_string())?;if !matches!(url.scheme(),"http"|"https")||!url.username().is_empty()||url.password().is_some(){return Err("INVALID_RUN_MODEL".into())}}
    Ok(value)
}

fn default_worker_model()->RunModelSnapshot{
    RunModelSnapshot{provider:"gemini".into(),model:"gemini-2.0-flash".into(),base_url:None}
}

async fn isolated_login(app:&AppHandle,account:&RunAccountSnapshot,system_id:&str,environment_id:&str,expected_system_label:&str,mode:&str,model:&RunModelSnapshot)->Result<Value,String>{
    let (node,index)=crate::browser::runtime_assets()?;
    let worker=stagehand_worker_asset(&index,"login-worker.js","STAGEHAND_LOGIN_WORKER_MISSING")?;
    let (username,password)=if mode!="login"{(String::new(),String::new())}else{
        let login=crate::testing::load_automatic_login_for_snapshot(app,&account.id,system_id,environment_id,&account.role,&account.login_mode)?;
        let mut credential=login.credential;
        (std::mem::take(&mut credential.username),std::mem::take(&mut credential.password))
    };
    let payload=IsolatedLoginPayload{allowed_origin:account.allowed_origin.clone(),handoff_origins:account.handoff_origins.clone(),login_url:account.login_page_url.clone(),page_locator:account.page_locator.clone(),identity_locator:account.identity_locator.clone(),private_locator:account.private_locator.clone(),submit_locator:account.submit_locator.clone(),success_locator:account.success_locator.clone(),expected_account_label:account.display_name.clone(),expected_system_label:expected_system_label.to_string(),role_name:account.role_name.clone(),username,password};
    let serialized=SecretProcessValue(serde_json::to_string(&payload).map_err(|_|"LOGIN_PAYLOAD_SERIALIZATION_FAILED".to_string())?);
    let api_key=crate::auth::current_api_key().ok().map(SecretProcessValue);
    let mut command=Command::new(node);
    command.arg(worker).env("LOGICGUARD_CDP_URL","http://127.0.0.1:9222").env("LOGICGUARD_LOGIN_MODE",mode).env("LOGICGUARD_LOGIN_PAYLOAD",&serialized.0).env("LLM_PROVIDER",&model.provider).env("LLM_MODEL",&model.model);
    if let Some(base_url)=&model.base_url{command.env("LLM_BASE_URL",base_url);}
    if let Some(key)=&api_key{command.env("LLM_API_KEY",&key.0);}
    let output=tokio::time::timeout(Duration::from_secs(45),command.output()).await.map_err(|_|"LOGIN_REQUIRES_HANDOFF".to_string())?.map_err(|_|"LOGIN_REQUIRES_HANDOFF".to_string())?;
    let envelope:Value=serde_json::from_slice(&output.stdout).map_err(|_|"LOGIN_REQUIRES_HANDOFF".to_string())?;
    if envelope.get("ok").and_then(Value::as_bool)==Some(true){Ok(envelope.get("data").cloned().unwrap_or(Value::Null))}else{Err(envelope.get("error").and_then(|value|value.get("code")).and_then(Value::as_str).unwrap_or("LOGIN_REQUIRES_HANDOFF").to_string())}
}

struct ControlEntry { state:Mutex<RunControl>, cancelled:Notify }
impl Default for ControlEntry { fn default()->Self{Self{state:Mutex::new(RunControl::default()),cancelled:Notify::new()}} }

#[derive(Clone)] pub struct RunManager { app:AppHandle, db_path:PathBuf, leases:Arc<Mutex<LeaseCoordinator>>, controls:Arc<Mutex<HashMap<String,Arc<ControlEntry>>>>, interaction_guard:Arc<dyn InteractionGuard>, guard_leases:Arc<Mutex<HashMap<String,GuardLease>>> }

impl RunManager {
    pub fn new(app:AppHandle,db_path:PathBuf)->Result<Self,String>{ let conn=Connection::open(&db_path).map_err(|e|e.to_string())?; initialize_schema(&conn)?;let interaction_guard=crate::interaction_guard::platform_guard();{let mut stmt=conn.prepare("SELECT id,browser_pid FROM execution_runs WHERE browser_pid IS NOT NULL AND status IN ('queued','preflight','running','pause_requested','paused','waiting_handoff')").map_err(|e|e.to_string())?;let stale=stmt.query_map([],|row|Ok((row.get::<_,String>(0)?,row.get::<_,u32>(1)?))).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;for (run_id,pid) in stale{if let Ok(lease)=interaction_guard.acquire(&run_id,pid){let _=interaction_guard.release(&lease);}}}let _=interaction_guard.force_release_stale();recover_interrupted(&conn)?; Ok(Self{app,db_path,leases:Default::default(),controls:Default::default(),interaction_guard,guard_leases:Default::default()}) }
    fn db(&self)->Result<Connection,String>{ let conn=Connection::open(&self.db_path).map_err(|e|e.to_string())?; initialize_schema(&conn)?; Ok(conn) }
    fn owned(&self,id:&str)->Result<ExecutionRun,String>{ let owner=crate::auth::current_user_id()?; load_run(&self.db()?,id)?.filter(|r|r.owner_id==owner).ok_or_else(||"NOT_FOUND".into()) }
    fn control(&self,id:&str)->Result<Arc<ControlEntry>,String>{ self.controls.lock().map_err(|_|"RUN_CONTROL_LOCK".to_string())?.get(id).cloned().ok_or_else(||"RUN_NOT_ACTIVE".into()) }
    fn emit_run(&self,run:&ExecutionRun){ let _=self.app.emit("run://updated",RunUpdatePayload{run:run.clone()}); }
    fn emit_event(&self,event:&ExecutionRunEvent){ let _=self.app.emit("run://event",RunEventPayload{event:event.clone()}); }
    fn record_event(&self,id:&str,kind:&str,data:Value)->Result<(),String>{ let mut conn=self.db()?;let event=append_event(&mut conn,id,kind,&data)?; self.emit_event(&event); Ok(()) }
    fn persist_worker(&self,id:&str,worker:&WorkerProcess)->Result<(),String>{self.db()?.execute("UPDATE execution_runs SET worker_pid=?1,lease_owner=?2,lease_expires_at=datetime('now','+10 minutes'),updated_at=CURRENT_TIMESTAMP WHERE id=?2",params![worker.child.id(),id]).map_err(|e|e.to_string())?;Ok(())}
    fn acquire_interaction_guard(&self,id:&str)->Result<(),String>{let pid=crate::browser::dedicated_browser_pid(9222).ok_or_else(||LOCK_UNAVAILABLE.to_string())?;let lease=self.interaction_guard.acquire(id,pid).map_err(|_|LOCK_UNAVAILABLE.to_string())?;self.db()?.execute("UPDATE execution_runs SET browser_pid=?1,lease_owner=?2,lease_expires_at=datetime('now','+10 minutes'),updated_at=CURRENT_TIMESTAMP WHERE id=?2",params![pid,id]).map_err(|e|e.to_string())?;self.guard_leases.lock().map_err(|_|LOCK_UNAVAILABLE.to_string())?.insert(id.to_string(),lease);Ok(())}
    fn release_interaction_guard(&self,id:&str)->Result<(),String>{let lease=self.guard_leases.lock().map_err(|_|LOCK_UNAVAILABLE.to_string())?.get(id).cloned();if let Some(lease)=lease{self.interaction_guard.release(&lease)?;self.guard_leases.lock().map_err(|_|LOCK_UNAVAILABLE.to_string())?.remove(id);}self.db()?.execute("UPDATE execution_runs SET browser_pid=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?1",[id]).map_err(|e|e.to_string())?;Ok(())}
    fn transition(&self,id:&str,to:RunStatus,category:Option<&str>,message:Option<&str>)->Result<ExecutionRun,String>{
        let mut conn=self.db()?; let transaction=conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|error|error.to_string())?; let current=load_run(&transaction,id)?.ok_or("NOT_FOUND")?;
        let status_changed=current.status!=to;
        if current.status!=to && !can_transition(current.status,to){return Err(format!("INVALID_RUN_TRANSITION: {} -> {}",current.status.as_str(),to.as_str()));}
        transaction.execute("UPDATE execution_runs SET status=?1,error_category=?2,error_message=?3,started_at=CASE WHEN ?1='running' THEN COALESCE(started_at,CURRENT_TIMESTAMP) ELSE started_at END,finished_at=CASE WHEN ?1 IN ('passed','business_failed','blocked','cancelled','interrupted') THEN CURRENT_TIMESTAMP ELSE finished_at END,updated_at=CURRENT_TIMESTAMP WHERE id=?4",params![to.as_str(),category,message,id]).map_err(|e|e.to_string())?;
        let run=load_run(&transaction,id)?.ok_or("NOT_FOUND")?; if to==RunStatus::BusinessFailed{create_business_issue(&transaction,&run)?;} transaction.commit().map_err(|error|error.to_string())?; self.emit_run(&run); self.record_event(id,to.as_str(),json!({"status":to}))?;if releases_interaction_guard(to){self.release_interaction_guard(id)?;}if status_changed{self.notify_attention_state(&run);} Ok(run)
    }
    fn notify_attention_state(&self,run:&ExecutionRun){
        let suite=run.snapshot.get("suiteName").and_then(Value::as_str).or_else(||run.snapshot.get("designTitle").and_then(Value::as_str)).unwrap_or("当前测试");
        let message=match run.status{RunStatus::Paused=>Some(("测试已暂停",format!("{suite} 已暂停，浏览器现在可以手动操作。"))),RunStatus::WaitingHandoff=>Some(("测试需要人工操作",format!("{suite} 正在等待你完成登录或确认。"))),RunStatus::Cancelled=>Some(("测试已停止",format!("{suite} 已终止执行。"))),_=>None};
        // 原生通知只是状态广播的补充通道；系统关闭通知权限时必须静默失败，不能回滚已持久化的运行状态。
        if let Some((title,body))=message{let _=self.app.notification().builder().title(title).body(body).show();}
    }
    pub fn start(&self,input:StartRunInput)->Result<String,String>{
        validate_plan(&input.execution_plan)?; if !input.snapshot.is_object(){return Err("SNAPSHOT_MUST_BE_OBJECT".into());}if contains_snapshot_secret(&input.snapshot,None){return Err("SECRET_NOT_ALLOWED".into());}account_orchestration(&input.snapshot,input.execution_plan.commands.len())?;
        let owner=crate::auth::current_user_id()?; let id=Uuid::new_v4().to_string(); let conn=self.db()?;
        conn.execute("INSERT INTO execution_runs(id,owner_id,status,snapshot_json,execution_plan_json) VALUES(?1,?2,'queued',?3,?4)",params![id,owner,json_text(&input.snapshot)?,plan_text(&input.execution_plan)?]).map_err(|e|e.to_string())?;
        self.controls.lock().map_err(|_|"RUN_CONTROL_LOCK".to_string())?.insert(id.clone(),Arc::new(ControlEntry::default()));
        self.record_event(&id,"queued",json!({}))?; if let Some(run)=load_run(&conn,&id)?{self.emit_run(&run)};
        let manager=self.clone(); let spawned=id.clone(); tauri::async_runtime::spawn(async move { manager.execute_queued(spawned).await; }); Ok(id)
    }
    async fn execute_queued(&self,id:String){
        let acquired=self.leases.lock().map(|mut l|l.try_acquire(&id)).unwrap_or(false); if !acquired{return;}
        let result=self.execute_with_lease(&id).await; if let Err(message)=result { if let Ok(run)=self.owned(&id) { if !run.status.is_terminal(){let _=self.transition(&id,RunStatus::Interrupted,Some("interrupted"),Some(&sanitize(&message)));} } }
        let _=self.release_interaction_guard(&id);if let Ok(mut leases)=self.leases.lock(){leases.release(&id)}; if let Ok(conn)=self.db(){let _=conn.execute("UPDATE execution_runs SET worker_pid=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?1",[&id]);}
        self.spawn_next();
    }
    fn spawn_next(&self){ if let Ok(conn)=self.db(){ if let Ok(Some(id))=conn.query_row("SELECT id FROM execution_runs WHERE status='queued' ORDER BY created_at LIMIT 1",[],|r|r.get::<_,String>(0)).optional(){let manager=self.clone();tauri::async_runtime::spawn(async move{manager.execute_queued(id).await;});} } }
    async fn execute_with_lease(&self,id:&str)->Result<(),String>{
        self.transition(id,RunStatus::Preflight,None,None)?; let run=self.owned(id)?; validate_plan(&run.execution_plan).map_err(|e|{let _=self.transition(id,RunStatus::Blocked,Some("invalid_request"),Some(&e));e})?;
        if let Err(error)=crate::browser::ensure_dedicated_browser(&self.app,9222){self.transition(id,RunStatus::Blocked,Some("browser_unavailable"),Some(&sanitize(&error)))?;return Ok(())}
        let orchestration=account_orchestration(&run.snapshot,run.execution_plan.commands.len()).map_err(|error|{let _=self.transition(id,RunStatus::Blocked,Some("invalid_request"),Some(&error));error})?;
        let model=run_model(&run.snapshot).map_err(|error|{let _=self.transition(id,RunStatus::Blocked,Some("invalid_request"),Some(&error));error})?;
        let mut active_account_id=checkpoint_text(&run,"activeAccountId").map(str::to_string);
        if run.checkpoint.as_ref().and_then(|value|value.get("handoffPending")).and_then(Value::as_bool)==Some(true){
            let account=orchestration.as_ref().and_then(|value|role_account_at(value,run.current_step as usize)).ok_or("ACCOUNT_SNAPSHOT_MISMATCH")?;
            if let Err(error)=isolated_login(&self.app,account,run.snapshot["systemId"].as_str().unwrap_or_default(),run.snapshot["environmentId"].as_str().unwrap_or_default(),run.snapshot["systemName"].as_str().unwrap_or_default(),"verify",&model).await{
                self.record_event(id,"handoff_required",json!({"step":run.current_step,"role":&account.role,"reason":sanitize(&error)}))?;
                self.transition(id,RunStatus::WaitingHandoff,None,Some("Manual login verification required"))?;return Ok(())
            }
            active_account_id=Some(account.id.clone());
            self.db()?.execute("UPDATE execution_runs SET checkpoint_json=?1,updated_at=CURRENT_TIMESTAMP WHERE id=?2",params![json_text(&json!({"nextStep":run.current_step,"activeAccountId":&account.id,"handoffPending":false}))?,id]).map_err(|error|error.to_string())?;
            self.record_event(id,"identity_verified",json!({"step":run.current_step,"role":&account.role}))?;
        }
        let allowed_origins=plan_allowed_origins(&run.execution_plan);
        let mut worker=WorkerProcess::spawn(&self.app,&allowed_origins,&model).await.map_err(|e|{let category=classify_message(&e);let _=self.transition(id,RunStatus::Blocked,Some(category.as_str()),Some(&sanitize(&e)));e})?;
        self.persist_worker(id,&worker)?;if let Err(failure)=worker.set_control_marker(&marker_for_run(&run,run.current_step)).await{worker.terminate().await;self.transition(id,RunStatus::Blocked,Some("blocked"),Some(&sanitize(&failure.message)))?;return Ok(())}
        let guard_result=self.acquire_interaction_guard(id);if status_after_guard_acquisition(guard_result.is_ok())==RunStatus::Blocked{let error=guard_result.err().unwrap_or_else(||LOCK_UNAVAILABLE.to_string());let _=worker.remove_control_marker().await;worker.terminate().await;self.transition(id,RunStatus::Blocked,Some("blocked"),Some(LOCK_UNAVAILABLE))?;return Err(error)}
        self.transition(id,RunStatus::Running,None,None)?; let policy=RetryPolicy{max_attempts:3,base_delay_ms:250};
        for (index,command) in run.execution_plan.commands.iter().enumerate().skip(run.current_step as usize){
            let worker_command=command_with_navigation_handoff(command,orchestration.as_ref());
            let control=self.control(id)?;
            let cancelled={control.state.lock().map_err(|_|"RUN_CONTROL_LOCK".to_string())?.cancelled};
            if cancelled {let _=worker.remove_control_marker().await;worker.terminate().await;self.release_interaction_guard(id)?;self.transition(id,RunStatus::Cancelled,Some("cancelled"),Some("Terminated by user"))?; return Ok(()); }
            if let Err(failure)=worker.set_control_marker(&marker_for_run(&run,index as i64)).await{worker.terminate().await;self.transition(id,RunStatus::Blocked,Some("blocked"),Some(&sanitize(&failure.message)))?;return Ok(())}
            if let Some(account)=orchestration.as_ref().and_then(|value|role_account_at(value,index)){
                if active_account_id.as_deref()!=Some(account.id.as_str()){
                    let system_id=run.snapshot["systemId"].as_str().unwrap_or_default();
                    let environment_id=run.snapshot["environmentId"].as_str().unwrap_or_default();
                    // 首个业务账号先识别现有页面；后续账号切换必须重新登录，不能沿用上一身份的会话。
                    let login_result=if active_account_id.is_none(){
                        match isolated_login(&self.app,account,system_id,environment_id,run.snapshot["systemName"].as_str().unwrap_or_default(),"assess",&model).await{
                            Ok(value) if value.get("status").and_then(Value::as_str)==Some("authenticated")=>Ok(value),
                            Ok(value) if value.get("status").and_then(Value::as_str)==Some("login_required") && value.get("evidence").and_then(Value::as_str)!=Some("trusted_handoff_origin") && account.login_mode=="automatic"=>isolated_login(&self.app,account,system_id,environment_id,run.snapshot["systemName"].as_str().unwrap_or_default(),"login",&model).await,
                            Ok(_)=>Err("LOGIN_STATE_UNCERTAIN".into()),
                            Err(error)=>Err(error),
                        }
                    }else if account.login_mode=="automatic"{isolated_login(&self.app,account,system_id,environment_id,run.snapshot["systemName"].as_str().unwrap_or_default(),"login",&model).await}else{Err("MANUAL_HANDOFF_REQUIRED".into())};
                    if let Err(error)=login_result{
                        self.db()?.execute("UPDATE execution_runs SET checkpoint_json=?1,updated_at=CURRENT_TIMESTAMP WHERE id=?2",params![json_text(&json!({"nextStep":index,"handoffPending":true,"pendingRole":&account.role,"accountId":&account.id}))?,id]).map_err(|cause|cause.to_string())?;
                        self.record_event(id,"handoff_required",json!({"step":index,"role":&account.role,"reason":sanitize(&error)}))?;
                        let _=worker.remove_control_marker().await;worker.terminate().await;self.transition(id,RunStatus::WaitingHandoff,None,Some("Manual login required"))?;return Ok(())
                    }
                    active_account_id=Some(account.id.clone());
                    self.record_event(id,"role_switched",json!({"step":index,"role":&account.role,"roleName":&account.role_name,"accountId":&account.id}))?;
                }
            }
            let command_kind=command.get("command").and_then(Value::as_str).unwrap_or("unknown");
            let command_title=command.get("title").and_then(Value::as_str).unwrap_or(command_kind);
            let command_started=Instant::now();
            self.record_event(id,"command_started",json!({"step":index,"command":command_kind,"title":command_title}))?;
            let mut attempt=1; loop { match worker.send(index,&worker_command,&control.cancelled,|data|{let _=self.record_event(id,"progress",json!({"step":index,"data":data}));}).await {
                Ok(data)=>{self.record_event(id,"progress",json!({"step":index,"data":data}))?;break},
                Err(failure)=>match policy.decision(attempt,failure.category){
                    RetryDecision::RetryAfter(delay)=>{self.record_event(id,"retry",json!({"step":index,"attempt":attempt,"category":failure.category.as_str()}))?;worker.terminate().await;tokio::time::sleep(Duration::from_millis(delay)).await;worker=WorkerProcess::spawn(&self.app,&allowed_origins,&model).await.map_err(|e|sanitize(&e))?;self.persist_worker(id,&worker)?;worker.set_control_marker(&marker_for_run(&run,index as i64)).await.map_err(|failure|failure.message)?;attempt+=1;},
                    RetryDecision::BusinessFailed=>{worker.terminate().await;self.transition(id,RunStatus::BusinessFailed,Some(failure.category.as_str()),Some(&failure.message))?;return Ok(())},
                    RetryDecision::Cancelled=>{worker.terminate().await;self.release_interaction_guard(id)?;self.transition(id,RunStatus::Cancelled,Some("cancelled"),Some(&failure.message))?;return Ok(())},
                    RetryDecision::Interrupted=>{worker.terminate().await;self.transition(id,RunStatus::Interrupted,Some("interrupted"),Some(&failure.message))?;return Ok(())},
                    RetryDecision::Blocked=>{worker.terminate().await;self.transition(id,RunStatus::Blocked,Some(failure.category.as_str()),Some(&failure.message))?;return Ok(())},
                }
            }}
            self.record_event(id,"command_completed",json!({"step":index,"command":command_kind,"title":command_title,"elapsedMs":command_started.elapsed().as_millis()}))?;
            let checkpoint=(index+1) as i64; self.db()?.execute("UPDATE execution_runs SET current_step=?1,checkpoint_json=?2,updated_at=CURRENT_TIMESTAMP WHERE id=?3",params![checkpoint,json_text(&json!({"nextStep":checkpoint,"activeAccountId":active_account_id,"handoffPending":false}))?,id]).map_err(|e|e.to_string())?;
            let decision={control.state.lock().map_err(|_|"RUN_CONTROL_LOCK".to_string())?.after_command(checkpoint)};
            match decision{
                ControlDecision::Continue=>{},ControlDecision::PauseAt(_)=>{let _=worker.remove_control_marker().await;worker.terminate().await;self.transition(id,RunStatus::Paused,None,None)?;return Ok(())},ControlDecision::Cancel=>{let _=worker.remove_control_marker().await;worker.terminate().await;self.release_interaction_guard(id)?;self.transition(id,RunStatus::Cancelled,Some("cancelled"),Some("Terminated by user"))?;return Ok(())}
            }
        }
        let _=worker.remove_control_marker().await;worker.terminate().await;self.transition(id,RunStatus::Passed,None,None)?;Ok(())
    }
    pub fn pause(&self,id:&str)->Result<ExecutionRun,String>{let run=self.owned(id)?;if run.status!=RunStatus::Running{return Err("RUN_NOT_RUNNING".into());}self.control(id)?.state.lock().map_err(|_|"RUN_CONTROL_LOCK".to_string())?.request_pause();self.transition(id,RunStatus::PauseRequested,None,None)}
    pub fn resume(&self,id:&str)->Result<ExecutionRun,String>{let run=self.owned(id)?;if !matches!(run.status,RunStatus::Paused|RunStatus::WaitingHandoff){return Err("RUN_NOT_RESUMABLE".into());}let revalidation=validate_plan(&run.execution_plan);if let Err(e)=revalidation{return self.transition(id,RunStatus::Blocked,Some("invalid_request"),Some(&e));}self.controls.lock().map_err(|_|"RUN_CONTROL_LOCK".to_string())?.insert(id.into(),Arc::new(ControlEntry::default()));let queued=self.transition(id,RunStatus::Queued,None,None)?;let manager=self.clone();let run_id=id.to_string();tauri::async_runtime::spawn(async move{manager.execute_queued(run_id).await;});Ok(queued)}
    pub fn terminate(&self,id:&str)->Result<ExecutionRun,String>{let run=self.owned(id)?;if run.status.is_terminal(){return Ok(run)};if matches!(run.status,RunStatus::Queued|RunStatus::Paused|RunStatus::WaitingHandoff){return self.transition(id,RunStatus::Cancelled,Some("cancelled"),Some("Terminated by user"));}if let Ok(control)=self.control(id){if let Ok(mut value)=control.state.lock(){value.cancel();}control.cancelled.notify_one();}Ok(run)}
    pub fn delete(&self,id:&str)->Result<(),String>{let owner=crate::auth::current_user_id()?;delete_run_record(&self.db()?,&owner,id)?;self.controls.lock().map_err(|_|"RUN_CONTROL_LOCK".to_string())?.remove(id);Ok(())}
}

#[tauri::command]
pub fn focus_run_browser(state: tauri::State<'_, RunManager>, run_id: String) -> Result<(), String> {
    state.owned(&run_id)?;
    let browser_pid = state.db()?.query_row(
        "SELECT browser_pid FROM execution_runs WHERE id=?1",
        [&run_id],
        |row| row.get::<_, Option<u32>>(0),
    ).map_err(|error| error.to_string())?.ok_or_else(|| crate::interaction_guard::LOCK_UNAVAILABLE.to_string())?;
    crate::interaction_guard::focus_browser_window(browser_pid)
}

struct WorkerFailure{category:ErrorCategory,message:String}
struct WorkerProcess{child:Child,stdin:tokio::process::ChildStdin,stdout:tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,stderr_task:tokio::task::JoinHandle<()>,node_path:PathBuf,worker_path:PathBuf,model:RunModelSnapshot,port:u16}
impl WorkerProcess{
 async fn spawn(app:&AppHandle,allowed_origins:&[String],model:&RunModelSnapshot)->Result<Self,String>{Self::spawn_for_port_and_origins(app,9222,allowed_origins,model).await}
 async fn spawn_for_port_and_origins(app:&AppHandle,port:u16,allowed_origins:&[String],model:&RunModelSnapshot)->Result<Self,String>{let (node,worker)=worker_assets(app)?;let mut command=Command::new(&node);command.arg(&worker).env("LOGICGUARD_CDP_URL",format!("http://127.0.0.1:{port}")).env("LLM_PROVIDER",&model.provider).env("LLM_MODEL",&model.model).stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).kill_on_drop(true);if let Some(base_url)=&model.base_url{command.env("LLM_BASE_URL",base_url);}if !allowed_origins.is_empty(){command.env("LOGICGUARD_ALLOWED_ORIGINS",serde_json::to_string(allowed_origins).map_err(|e|e.to_string())?);}if let Ok(key)=crate::auth::current_api_key(){command.env("LLM_API_KEY",key);}let mut child=command.spawn().map_err(|e|e.to_string())?;let stdin=child.stdin.take().ok_or("WORKER_STDIN")?;let stdout=child.stdout.take().ok_or("WORKER_STDOUT")?;let stderr=child.stderr.take().ok_or("WORKER_STDERR")?;let stderr_task=tokio::spawn(async move{let mut lines=BufReader::new(stderr).lines();let mut total=0usize;while let Ok(Some(line))=lines.next_line().await{if total>=8192{break}let safe=sanitize(&line);total+=safe.len();log::warn!("stagehand worker: {}",safe);}});Ok(Self{child,stdin,stdout:BufReader::new(stdout).lines(),stderr_task,node_path:node,worker_path:worker,model:model.clone(),port})}
 async fn send<F>(&mut self,index:usize,command:&Value,cancelled:&Notify,mut progress:F)->Result<Value,WorkerFailure> where F:FnMut(Value){let mut object=command.as_object().cloned().ok_or_else(||WorkerFailure{category:ErrorCategory::InvalidRequest,message:"Invalid command".into()})?;object.insert("id".into(),Value::String(format!("step-{index}")));object.remove("title");object.remove("details");if object.get("command").and_then(Value::as_str)==Some("observe"){object.remove("allowedOrigins");object.remove("timeoutMs");}let line=serde_json::to_string(&Value::Object(object)).map_err(|e|WorkerFailure{category:ErrorCategory::InvalidRequest,message:e.to_string()})?;self.stdin.write_all(format!("{line}\n").as_bytes()).await.map_err(|e|WorkerFailure{category:ErrorCategory::Connection,message:e.to_string()})?;self.stdin.flush().await.map_err(|e|WorkerFailure{category:ErrorCategory::Connection,message:e.to_string()})?;loop{let result=tokio::select!{_=cancelled.notified()=>return Err(WorkerFailure{category:ErrorCategory::Cancelled,message:"Terminated by user".into()}),result=tokio::time::timeout(Duration::from_secs(305),self.stdout.next_line())=>result.map_err(|_|WorkerFailure{category:ErrorCategory::Timeout,message:"Worker response timeout".into()})?.map_err(|e|WorkerFailure{category:ErrorCategory::Connection,message:e.to_string()})?.ok_or_else(||WorkerFailure{category:ErrorCategory::Interrupted,message:"Worker exited".into()})?};let envelope:Value=serde_json::from_str(&result).map_err(|_|WorkerFailure{category:ErrorCategory::ModelResponse,message:"Worker returned non-JSON output".into()})?;if envelope.get("event").and_then(Value::as_str)==Some("progress"){progress(envelope.get("data").cloned().unwrap_or(Value::Null));continue}if envelope.get("ok").and_then(Value::as_bool)==Some(true){return Ok(envelope.get("data").cloned().unwrap_or(Value::Null))}let error=envelope.get("error").cloned().unwrap_or(Value::Null);let raw=error.get("category").and_then(Value::as_str).unwrap_or("interrupted");let message=sanitize(error.get("message").and_then(Value::as_str).unwrap_or("Worker request failed"));return Err(WorkerFailure{category:match raw{"business_failed"=>ErrorCategory::BusinessAssertion,"cancelled"=>ErrorCategory::Cancelled,"invalid_request"|"blocked"=>ErrorCategory::InvalidRequest,"interrupted"=>classify_message(&message),_=>ErrorCategory::Interrupted},message})}}
 async fn set_control_marker(&mut self,marker:&Value)->Result<Value,WorkerFailure>{let cancelled=Notify::new();self.send(0,&json!({"command":"set_control_marker","marker":marker}),&cancelled,|_|{}).await}
 async fn remove_control_marker(&mut self)->Result<Value,WorkerFailure>{let cancelled=Notify::new();self.send(0,&json!({"command":"remove_control_marker"}),&cancelled,|_|{}).await}
 async fn terminate(&mut self){let _=self.stdin.write_all(b"{\"id\":\"remove-marker\",\"command\":\"remove_control_marker\"}\n{\"id\":\"terminate\",\"command\":\"terminate\"}\n").await;let _=tokio::time::timeout(Duration::from_secs(2),self.child.wait()).await;if self.child.try_wait().ok().flatten().is_none(){let _=self.child.kill().await;}self.stderr_task.abort();
  // 长 Agent 动作可能来不及消费 stdin 中的清理命令；主进程结束后用一次性 worker 兜底移除网页控制标识。
  let mut cleanup=Command::new(&self.node_path);cleanup.arg(&self.worker_path).arg("--remove-control-marker").env("LOGICGUARD_CDP_URL",format!("http://127.0.0.1:{}",self.port)).env("LLM_PROVIDER",&self.model.provider).env("LLM_MODEL",&self.model.model).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).kill_on_drop(true);if let Some(base_url)=&self.model.base_url{cleanup.env("LLM_BASE_URL",base_url);}if let Ok(key)=crate::auth::current_api_key(){cleanup.env("LLM_API_KEY",key);}let _=tokio::time::timeout(Duration::from_secs(12),cleanup.output()).await;
 }
}

#[derive(Deserialize)]
#[serde(rename_all="camelCase")]
pub struct CaptureRequirementInput {
    pub url:String, pub keyword:Option<String>, pub port:Option<u16>,
    #[serde(default)] pub ai_match:bool,
    pub model:Option<crate::llm::LlmConfig>,
}

#[tauri::command]
pub async fn capture_requirement_page(app:AppHandle,input:CaptureRequirementInput)->Result<Value,String>{
    crate::auth::current_user_id()?;
    let parsed=reqwest::Url::parse(input.url.trim()).map_err(|_|"INVALID_REQUIREMENT_URL".to_string())?;
    let local=matches!(parsed.host_str(),Some("localhost"|"127.0.0.1"|"::1"));
    if parsed.username()!=""||parsed.password().is_some()||!(parsed.scheme()=="https"||(parsed.scheme()=="http"&&local)){return Err("INVALID_REQUIREMENT_URL".into())}
    let origin=parsed.origin().ascii_serialization();
    // AI 抓取必须使用用户当前选择的模型；前端只传非敏感配置，API Key 仍由 Rust 从当前用户凭据库注入。
    let worker_model=if input.ai_match{
        let config=input.model.ok_or("AI_REQUIREMENT_MODEL_MISSING")?;
        validate_worker_model(RunModelSnapshot{provider:config.provider,model:config.model,base_url:config.base_url})?
    }else{default_worker_model()};
    let mut worker=WorkerProcess::spawn_for_port_and_origins(&app,input.port.unwrap_or(9222),&[],&worker_model).await?;
    let cancelled=Notify::new();
    let command=json!({"command":"capture_requirement","url":parsed.as_str(),"keyword":input.keyword.unwrap_or_default(),"aiMatch":input.ai_match,"allowedOrigins":[origin]});
    let result=worker.send(0,&command,&cancelled,|_|{}).await.map_err(|failure|failure.message);
    worker.terminate().await;
    result
}

fn stagehand_worker_asset(index:&std::path::Path,file_name:&str,missing_error:&str)->Result<PathBuf,String>{
    let bundled=index.parent().ok_or("SIDECAR_RESOURCE_PATH")?.join("stagehand").join(file_name);
    if bundled.is_file(){return Ok(bundled)}
    let development=PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("sidecar").join("stagehand").join(file_name);
    if cfg!(debug_assertions)&&development.is_file(){return Ok(development)}
    Err(missing_error.into())
}
fn worker_assets(_app:&AppHandle)->Result<(PathBuf,PathBuf),String>{let (node,index)=crate::browser::runtime_assets()?;let worker=stagehand_worker_asset(&index,"worker.js","STAGEHAND_WORKER_MISSING")?;Ok((node,worker))}
fn sanitize(value:&str)->String{let mut result=value.replace('\r'," ").replace('\n'," ");for word in SECRET_WORDS{let lower=result.to_ascii_lowercase();if let Some(index)=lower.find(word){result.replace_range(index.., &format!("{word}=[REDACTED]"));}}result.chars().take(1024).collect()}
fn classify_message(message:&str)->ErrorCategory{let lower=message.to_ascii_lowercase();if lower.contains("429")||lower.contains("rate limit"){ErrorCategory::RateLimited}else if lower.contains("timeout"){ErrorCategory::Timeout}else if lower.contains("html")||lower.contains("<html"){ErrorCategory::ModelResponse}else if lower.contains("connect")||lower.contains("network")||lower.contains("econn"){ErrorCategory::Connection}else{ErrorCategory::Interrupted}}

fn marker_value(snapshot:&Value, keys:&[&str], fallback:&str)->String{let candidate=keys.iter().find_map(|key|snapshot.get(*key).and_then(Value::as_str)).unwrap_or(fallback);let lower=candidate.to_ascii_lowercase();if candidate.trim().is_empty()||SECRET_WORDS.iter().any(|word|lower.contains(word)){fallback.to_string()}else{candidate.chars().take(128).collect()}}
fn marker_for_run(run:&ExecutionRun,current_step:i64)->Value{json!({"system":marker_value(&run.snapshot,&["systemName","systemId"],"unknown"),"environment":marker_value(&run.snapshot,&["environmentName","environmentId"],"unknown"),"run":run.id,"currentStep":current_step})}

fn plan_allowed_origins(plan:&ExecutionPlan)->Vec<String>{
    let mut origins=plan.commands.iter().flat_map(|command|command.get("allowedOrigins").and_then(Value::as_array).into_iter().flatten()).filter_map(Value::as_str).map(str::to_string).collect::<Vec<_>>();
    origins.sort();origins.dedup();origins
}

#[tauri::command] pub fn start_run(manager:tauri::State<'_,RunManager>,input:StartRunInput)->Result<String,String>{manager.start(input)}
#[tauri::command] pub fn pause_run(manager:tauri::State<'_,RunManager>,run_id:String)->Result<ExecutionRun,String>{manager.pause(&run_id)}
#[tauri::command] pub fn resume_run(manager:tauri::State<'_,RunManager>,run_id:String)->Result<ExecutionRun,String>{manager.resume(&run_id)}
#[tauri::command] pub fn terminate_run(manager:tauri::State<'_,RunManager>,run_id:String)->Result<ExecutionRun,String>{manager.terminate(&run_id)}
#[tauri::command] pub fn delete_run(manager:tauri::State<'_,RunManager>,run_id:String)->Result<(),String>{manager.delete(&run_id)}
#[tauri::command] pub fn get_run(manager:tauri::State<'_,RunManager>,run_id:String)->Result<Option<ExecutionRun>,String>{let owner=crate::auth::current_user_id()?;Ok(load_run(&manager.db()?,&run_id)?.filter(|r|r.owner_id==owner))}
#[tauri::command] pub fn list_runs(manager:tauri::State<'_,RunManager>)->Result<Vec<ExecutionRun>,String>{list_run_records(&manager.db()?,&crate::auth::current_user_id()?,false)}
#[tauri::command] pub fn list_active_runs(manager:tauri::State<'_,RunManager>)->Result<Vec<ExecutionRun>,String>{list_run_records(&manager.db()?,&crate::auth::current_user_id()?,true)}
#[tauri::command] pub fn list_run_events(manager:tauri::State<'_,RunManager>,run_id:String,after_sequence:Option<i64>)->Result<Vec<ExecutionRunEvent>,String>{manager.owned(&run_id)?;events_after(&manager.db()?,&run_id,after_sequence.unwrap_or(0))}
#[tauri::command] pub fn list_execution_issues(manager:tauri::State<'_,RunManager>)->Result<Vec<ExecutionIssue>,String>{list_execution_issue_records(&manager.db()?,&crate::auth::current_user_id()?)}
#[tauri::command] pub fn update_execution_issue(manager:tauri::State<'_,RunManager>,input:UpdateExecutionIssueInput)->Result<ExecutionIssue,String>{update_execution_issue_record(&manager.db()?,&crate::auth::current_user_id()?,&input)}
#[tauri::command] pub fn update_execution_issue_status(manager:tauri::State<'_,RunManager>,id:String,status:String)->Result<ExecutionIssue,String>{update_execution_issue_status_record(&manager.db()?,&crate::auth::current_user_id()?,&id,&status)}
