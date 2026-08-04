use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::{HashMap, HashSet}, path::PathBuf, sync::{Arc, Mutex}, time::Duration};
use tauri::{AppHandle, Emitter};
use tokio::{io::{AsyncBufReadExt, AsyncWriteExt, BufReader}, process::{Child, Command}, sync::Notify};
use uuid::Uuid;
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
        (Preflight, Running | Blocked | Cancelled | Interrupted) |
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
         );"
    ).map_err(|e| e.to_string())?;
    let _ = conn.execute("ALTER TABLE execution_runs ADD COLUMN browser_pid INTEGER", []);
    Ok(())
}

fn json_text(value: &Value) -> Result<String, String> { serde_json::to_string(value).map_err(|e| e.to_string()) }
fn plan_text(value: &ExecutionPlan) -> Result<String, String> { serde_json::to_string(value).map_err(|e| e.to_string()) }

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
        if !matches!(kind, "execute" | "observe" | "act" | "agent") { return Err("UNKNOWN_COMMAND".into()); }
        let allowed: HashSet<&str> = match kind {
            "execute" => ["command","step","allowedOrigins","timeoutMs"].into_iter().collect(),
            "observe" => ["command","instruction","allowedOrigins","timeoutMs"].into_iter().collect(),
            "act" => ["command","instruction","allowedOrigins","timeoutMs"].into_iter().collect(),
            _ => ["command","goal","allowedOrigins","timeoutMs","maxActions"].into_iter().collect(),
        };
        if object.keys().any(|key| !allowed.contains(key.as_str())) { return Err("UNKNOWN_COMMAND_FIELD".into()); }
        let origins = object.get("allowedOrigins").and_then(Value::as_array).ok_or("MISSING_ALLOWED_ORIGINS")?;
        if origins.is_empty() || origins.len() > 20 || origins.iter().any(|v| !v.as_str().map(valid_origin).unwrap_or(false)) { return Err("INVALID_ALLOWED_ORIGINS".into()); }
        let timeout = object.get("timeoutMs").and_then(Value::as_u64).ok_or("INVALID_TIMEOUT_MS")?;
        if timeout == 0 || timeout > 300_000 { return Err("INVALID_TIMEOUT_MS".into()); }
        if kind == "execute" { validate_step(object.get("step").ok_or("INVALID_STEP")?)?; }
        if matches!(kind,"observe"|"act") && !object.get("instruction").and_then(Value::as_str).map(|v|!v.trim().is_empty()).unwrap_or(false) { return Err("INVALID_INSTRUCTION".into()); }
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
    pub fn status_during_command(&self) -> RunStatus { if self.pause_requested { RunStatus::PauseRequested } else { RunStatus::Running } }
    pub fn after_command(&self, checkpoint:i64)->ControlDecision { if self.cancelled {ControlDecision::Cancel} else if self.pause_requested {ControlDecision::PauseAt(checkpoint)} else {ControlDecision::Continue} }
}
pub fn resume_target(revalidation: Result<(),String>)->RunStatus { if revalidation.is_ok(){RunStatus::Queued}else{RunStatus::Blocked} }
pub fn completion_for_stop(cancelled:bool, recovered:bool)->RunStatus { if cancelled{RunStatus::Cancelled}else if recovered{RunStatus::Interrupted}else{RunStatus::Blocked} }

#[derive(Debug,Clone,Copy,PartialEq,Eq)] pub enum ErrorCategory { InvalidRequest, ModelResponse, RateLimited, Timeout, Connection, BusinessAssertion, Cancelled, Interrupted }
impl ErrorCategory { fn as_str(self)->&'static str { match self { Self::InvalidRequest=>"invalid_request",Self::ModelResponse=>"model_response",Self::RateLimited=>"rate_limited",Self::Timeout=>"timeout",Self::Connection=>"connection",Self::BusinessAssertion=>"business_assertion",Self::Cancelled=>"cancelled",Self::Interrupted=>"interrupted" } } }
#[derive(Debug,PartialEq,Eq)] pub enum RetryDecision { RetryAfter(u64), Blocked, BusinessFailed, Cancelled, Interrupted }
pub struct RetryPolicy { pub max_attempts:u32, pub base_delay_ms:u64 }
impl RetryPolicy { pub fn decision(&self,attempt:u32,category:ErrorCategory)->RetryDecision { match category { ErrorCategory::BusinessAssertion=>RetryDecision::BusinessFailed, ErrorCategory::Cancelled=>RetryDecision::Cancelled, ErrorCategory::Interrupted=>RetryDecision::Interrupted, ErrorCategory::ModelResponse|ErrorCategory::RateLimited|ErrorCategory::Timeout|ErrorCategory::Connection if attempt<self.max_attempts=>RetryDecision::RetryAfter(self.base_delay_ms.saturating_mul(1u64 << attempt.saturating_sub(1))), _=>RetryDecision::Blocked } } }

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
        let conn=self.db()?; let current=load_run(&conn,id)?.ok_or("NOT_FOUND")?;
        if current.status!=to && !can_transition(current.status,to){return Err(format!("INVALID_RUN_TRANSITION: {} -> {}",current.status.as_str(),to.as_str()));}
        conn.execute("UPDATE execution_runs SET status=?1,error_category=?2,error_message=?3,started_at=CASE WHEN ?1='running' THEN COALESCE(started_at,CURRENT_TIMESTAMP) ELSE started_at END,finished_at=CASE WHEN ?1 IN ('passed','business_failed','blocked','cancelled','interrupted') THEN CURRENT_TIMESTAMP ELSE finished_at END,updated_at=CURRENT_TIMESTAMP WHERE id=?4",params![to.as_str(),category,message,id]).map_err(|e|e.to_string())?;
        let run=load_run(&conn,id)?.ok_or("NOT_FOUND")?; self.emit_run(&run); self.record_event(id,to.as_str(),json!({"status":to}))?;if releases_interaction_guard(to){self.release_interaction_guard(id)?;} Ok(run)
    }
    pub fn start(&self,input:StartRunInput)->Result<String,String>{
        validate_plan(&input.execution_plan)?; if !input.snapshot.is_object(){return Err("SNAPSHOT_MUST_BE_OBJECT".into());}if contains_secret(&input.snapshot){return Err("SECRET_NOT_ALLOWED".into());}
        let owner=crate::auth::current_user_id()?; let id=Uuid::new_v4().to_string(); let conn=self.db()?;
        conn.execute("INSERT INTO execution_runs(id,owner_id,status,snapshot_json,execution_plan_json) VALUES(?1,?2,'queued',?3,?4)",params![id,owner,json_text(&input.snapshot)?,plan_text(&input.execution_plan)?]).map_err(|e|e.to_string())?;
        self.controls.lock().map_err(|_|"RUN_CONTROL_LOCK".to_string())?.insert(id.clone(),Arc::new(ControlEntry::default()));
        self.record_event(&id,"queued",json!({}))?; if let Some(run)=load_run(&conn,&id)?{self.emit_run(&run)};
        let manager=self.clone(); let spawned=id.clone(); tokio::spawn(async move { manager.execute_queued(spawned).await; }); Ok(id)
    }
    async fn execute_queued(&self,id:String){
        let acquired=self.leases.lock().map(|mut l|l.try_acquire(&id)).unwrap_or(false); if !acquired{return;}
        let result=self.execute_with_lease(&id).await; if let Err(message)=result { if let Ok(run)=self.owned(&id) { if !run.status.is_terminal(){let _=self.transition(&id,RunStatus::Interrupted,Some("interrupted"),Some(&sanitize(&message)));} } }
        let _=self.release_interaction_guard(&id);if let Ok(mut leases)=self.leases.lock(){leases.release(&id)}; if let Ok(conn)=self.db(){let _=conn.execute("UPDATE execution_runs SET worker_pid=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?1",[&id]);}
        self.spawn_next();
    }
    fn spawn_next(&self){ if let Ok(conn)=self.db(){ if let Ok(Some(id))=conn.query_row("SELECT id FROM execution_runs WHERE status='queued' ORDER BY created_at LIMIT 1",[],|r|r.get::<_,String>(0)).optional(){let manager=self.clone();tokio::spawn(async move{manager.execute_queued(id).await;});} } }
    async fn execute_with_lease(&self,id:&str)->Result<(),String>{
        self.transition(id,RunStatus::Preflight,None,None)?; let run=self.owned(id)?; validate_plan(&run.execution_plan).map_err(|e|{let _=self.transition(id,RunStatus::Blocked,Some("invalid_request"),Some(&e));e})?;
        let mut worker=WorkerProcess::spawn(&self.app).await.map_err(|e|{let category=classify_message(&e);let _=self.transition(id,RunStatus::Blocked,Some(category.as_str()),Some(&sanitize(&e)));e})?;
        self.persist_worker(id,&worker)?;if let Err(failure)=worker.set_control_marker(&marker_for_run(&run,run.current_step)).await{worker.terminate().await;self.transition(id,RunStatus::Blocked,Some("blocked"),Some(&sanitize(&failure.message)))?;return Ok(())}
        let guard_result=self.acquire_interaction_guard(id);if status_after_guard_acquisition(guard_result.is_ok())==RunStatus::Blocked{let error=guard_result.err().unwrap_or_else(||LOCK_UNAVAILABLE.to_string());let _=worker.remove_control_marker().await;worker.terminate().await;self.transition(id,RunStatus::Blocked,Some("blocked"),Some(LOCK_UNAVAILABLE))?;return Err(error)}
        self.transition(id,RunStatus::Running,None,None)?; let policy=RetryPolicy{max_attempts:3,base_delay_ms:250};
        for (index,command) in run.execution_plan.commands.iter().enumerate().skip(run.current_step as usize){
            let control=self.control(id)?;
            let cancelled={control.state.lock().map_err(|_|"RUN_CONTROL_LOCK".to_string())?.cancelled};
            if cancelled {let _=worker.remove_control_marker().await;worker.terminate().await;self.release_interaction_guard(id)?;self.transition(id,RunStatus::Cancelled,Some("cancelled"),Some("Terminated by user"))?; return Ok(()); }
            if let Err(failure)=worker.set_control_marker(&marker_for_run(&run,index as i64)).await{worker.terminate().await;self.transition(id,RunStatus::Blocked,Some("blocked"),Some(&sanitize(&failure.message)))?;return Ok(())}
            let mut attempt=1; loop { match worker.send(index,command,&control.cancelled,|data|{let _=self.record_event(id,"progress",json!({"step":index,"data":data}));}).await {
                Ok(data)=>{self.record_event(id,"progress",json!({"step":index,"data":data}))?;break},
                Err(failure)=>match policy.decision(attempt,failure.category){
                    RetryDecision::RetryAfter(delay)=>{self.record_event(id,"retry",json!({"step":index,"attempt":attempt,"category":failure.category.as_str()}))?;worker.terminate().await;tokio::time::sleep(Duration::from_millis(delay)).await;worker=WorkerProcess::spawn(&self.app).await.map_err(|e|sanitize(&e))?;self.persist_worker(id,&worker)?;worker.set_control_marker(&marker_for_run(&run,index as i64)).await.map_err(|failure|failure.message)?;attempt+=1;},
                    RetryDecision::BusinessFailed=>{worker.terminate().await;self.transition(id,RunStatus::BusinessFailed,Some(failure.category.as_str()),Some(&failure.message))?;return Ok(())},
                    RetryDecision::Cancelled=>{worker.terminate().await;self.release_interaction_guard(id)?;self.transition(id,RunStatus::Cancelled,Some("cancelled"),Some(&failure.message))?;return Ok(())},
                    RetryDecision::Interrupted=>{worker.terminate().await;self.transition(id,RunStatus::Interrupted,Some("interrupted"),Some(&failure.message))?;return Ok(())},
                    RetryDecision::Blocked=>{worker.terminate().await;self.transition(id,RunStatus::Blocked,Some(failure.category.as_str()),Some(&failure.message))?;return Ok(())},
                }
            }}
            let checkpoint=(index+1) as i64; self.db()?.execute("UPDATE execution_runs SET current_step=?1,checkpoint_json=?2,updated_at=CURRENT_TIMESTAMP WHERE id=?3",params![checkpoint,json_text(&json!({"nextStep":checkpoint}))?,id]).map_err(|e|e.to_string())?;
            let decision={control.state.lock().map_err(|_|"RUN_CONTROL_LOCK".to_string())?.after_command(checkpoint)};
            match decision{
                ControlDecision::Continue=>{},ControlDecision::PauseAt(_)=>{let _=worker.remove_control_marker().await;worker.terminate().await;self.transition(id,RunStatus::Paused,None,None)?;return Ok(())},ControlDecision::Cancel=>{let _=worker.remove_control_marker().await;worker.terminate().await;self.release_interaction_guard(id)?;self.transition(id,RunStatus::Cancelled,Some("cancelled"),Some("Terminated by user"))?;return Ok(())}
            }
        }
        let _=worker.remove_control_marker().await;worker.terminate().await;self.transition(id,RunStatus::Passed,None,None)?;Ok(())
    }
    pub fn pause(&self,id:&str)->Result<ExecutionRun,String>{let run=self.owned(id)?;if run.status!=RunStatus::Running{return Err("RUN_NOT_RUNNING".into());}self.control(id)?.state.lock().map_err(|_|"RUN_CONTROL_LOCK".to_string())?.request_pause();self.transition(id,RunStatus::PauseRequested,None,None)}
    pub fn resume(&self,id:&str)->Result<ExecutionRun,String>{let run=self.owned(id)?;if !matches!(run.status,RunStatus::Paused|RunStatus::WaitingHandoff){return Err("RUN_NOT_RESUMABLE".into());}let revalidation=validate_plan(&run.execution_plan);if let Err(e)=revalidation{return self.transition(id,RunStatus::Blocked,Some("invalid_request"),Some(&e));}self.controls.lock().map_err(|_|"RUN_CONTROL_LOCK".to_string())?.insert(id.into(),Arc::new(ControlEntry::default()));let queued=self.transition(id,RunStatus::Queued,None,None)?;let manager=self.clone();let run_id=id.to_string();tokio::spawn(async move{manager.execute_queued(run_id).await;});Ok(queued)}
    pub fn terminate(&self,id:&str)->Result<ExecutionRun,String>{let run=self.owned(id)?;if run.status.is_terminal(){return Ok(run)};if matches!(run.status,RunStatus::Queued|RunStatus::Paused|RunStatus::WaitingHandoff){return self.transition(id,RunStatus::Cancelled,Some("cancelled"),Some("Terminated by user"));}if let Ok(control)=self.control(id){if let Ok(mut value)=control.state.lock(){value.cancel();}control.cancelled.notify_one();}Ok(run)}
}

struct WorkerFailure{category:ErrorCategory,message:String}
struct WorkerProcess{child:Child,stdin:tokio::process::ChildStdin,stdout:tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,stderr_task:tokio::task::JoinHandle<()>}
impl WorkerProcess{
 async fn spawn(app:&AppHandle)->Result<Self,String>{let (node,worker)=worker_assets(app)?;let mut command=Command::new(node);command.arg(worker).env("LOGICGUARD_CDP_URL","http://127.0.0.1:9222").env("LLM_PROVIDER","gemini").env("LLM_MODEL","gemini-2.0-flash").stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).kill_on_drop(true);if let Ok(key)=crate::auth::current_api_key(){command.env("LLM_API_KEY",key);}let mut child=command.spawn().map_err(|e|e.to_string())?;let stdin=child.stdin.take().ok_or("WORKER_STDIN")?;let stdout=child.stdout.take().ok_or("WORKER_STDOUT")?;let stderr=child.stderr.take().ok_or("WORKER_STDERR")?;let stderr_task=tokio::spawn(async move{let mut lines=BufReader::new(stderr).lines();let mut total=0usize;while let Ok(Some(line))=lines.next_line().await{if total>=8192{break}let safe=sanitize(&line);total+=safe.len();log::warn!("stagehand worker: {}",safe);}});Ok(Self{child,stdin,stdout:BufReader::new(stdout).lines(),stderr_task})}
 async fn send<F>(&mut self,index:usize,command:&Value,cancelled:&Notify,mut progress:F)->Result<Value,WorkerFailure> where F:FnMut(Value){let mut object=command.as_object().cloned().ok_or_else(||WorkerFailure{category:ErrorCategory::InvalidRequest,message:"Invalid command".into()})?;object.insert("id".into(),Value::String(format!("step-{index}")));if matches!(object.get("command").and_then(Value::as_str),Some("execute"|"observe")){object.remove("allowedOrigins");object.remove("timeoutMs");}let line=serde_json::to_string(&Value::Object(object)).map_err(|e|WorkerFailure{category:ErrorCategory::InvalidRequest,message:e.to_string()})?;self.stdin.write_all(format!("{line}\n").as_bytes()).await.map_err(|e|WorkerFailure{category:ErrorCategory::Connection,message:e.to_string()})?;self.stdin.flush().await.map_err(|e|WorkerFailure{category:ErrorCategory::Connection,message:e.to_string()})?;loop{let result=tokio::select!{_=cancelled.notified()=>return Err(WorkerFailure{category:ErrorCategory::Cancelled,message:"Terminated by user".into()}),result=tokio::time::timeout(Duration::from_secs(305),self.stdout.next_line())=>result.map_err(|_|WorkerFailure{category:ErrorCategory::Timeout,message:"Worker response timeout".into()})?.map_err(|e|WorkerFailure{category:ErrorCategory::Connection,message:e.to_string()})?.ok_or_else(||WorkerFailure{category:ErrorCategory::Interrupted,message:"Worker exited".into()})?};let envelope:Value=serde_json::from_str(&result).map_err(|_|WorkerFailure{category:ErrorCategory::ModelResponse,message:"Worker returned non-JSON output".into()})?;if envelope.get("event").and_then(Value::as_str)==Some("progress"){progress(envelope.get("data").cloned().unwrap_or(Value::Null));continue}if envelope.get("ok").and_then(Value::as_bool)==Some(true){return Ok(envelope.get("data").cloned().unwrap_or(Value::Null))}let error=envelope.get("error").cloned().unwrap_or(Value::Null);let raw=error.get("category").and_then(Value::as_str).unwrap_or("interrupted");let message=sanitize(error.get("message").and_then(Value::as_str).unwrap_or("Worker request failed"));return Err(WorkerFailure{category:match raw{"business_failed"=>ErrorCategory::BusinessAssertion,"cancelled"=>ErrorCategory::Cancelled,"invalid_request"|"blocked"=>ErrorCategory::InvalidRequest,"interrupted"=>classify_message(&message),_=>ErrorCategory::Interrupted},message})}}
 async fn set_control_marker(&mut self,marker:&Value)->Result<Value,WorkerFailure>{let cancelled=Notify::new();self.send(0,&json!({"command":"set_control_marker","marker":marker}),&cancelled,|_|{}).await}
 async fn remove_control_marker(&mut self)->Result<Value,WorkerFailure>{let cancelled=Notify::new();self.send(0,&json!({"command":"remove_control_marker"}),&cancelled,|_|{}).await}
 async fn terminate(&mut self){let _=self.stdin.write_all(b"{\"id\":\"remove-marker\",\"command\":\"remove_control_marker\"}\n{\"id\":\"terminate\",\"command\":\"terminate\"}\n").await;let _=tokio::time::timeout(Duration::from_secs(2),self.child.wait()).await;if self.child.try_wait().ok().flatten().is_none(){let _=self.child.kill().await;}self.stderr_task.abort();}
}

fn worker_assets(_app:&AppHandle)->Result<(PathBuf,PathBuf),String>{let (node,index)=crate::browser::runtime_assets()?;let worker=index.parent().ok_or("SIDECAR_RESOURCE_PATH")?.join("stagehand").join("worker.js");if !worker.is_file(){return Err("STAGEHAND_WORKER_MISSING".into())}Ok((node,worker))}
fn sanitize(value:&str)->String{let mut result=value.replace('\r'," ").replace('\n'," ");for word in SECRET_WORDS{let lower=result.to_ascii_lowercase();if let Some(index)=lower.find(word){result.replace_range(index.., &format!("{word}=[REDACTED]"));}}result.chars().take(1024).collect()}
fn classify_message(message:&str)->ErrorCategory{let lower=message.to_ascii_lowercase();if lower.contains("429")||lower.contains("rate limit"){ErrorCategory::RateLimited}else if lower.contains("timeout"){ErrorCategory::Timeout}else if lower.contains("html")||lower.contains("<html"){ErrorCategory::ModelResponse}else if lower.contains("connect")||lower.contains("network")||lower.contains("econn"){ErrorCategory::Connection}else{ErrorCategory::Interrupted}}

fn marker_value(snapshot:&Value, keys:&[&str], fallback:&str)->String{let candidate=keys.iter().find_map(|key|snapshot.get(*key).and_then(Value::as_str)).unwrap_or(fallback);let lower=candidate.to_ascii_lowercase();if candidate.trim().is_empty()||SECRET_WORDS.iter().any(|word|lower.contains(word)){fallback.to_string()}else{candidate.chars().take(128).collect()}}
fn marker_for_run(run:&ExecutionRun,current_step:i64)->Value{json!({"system":marker_value(&run.snapshot,&["systemName","systemId"],"unknown"),"environment":marker_value(&run.snapshot,&["environmentName","environmentId"],"unknown"),"run":run.id,"currentStep":current_step})}

#[tauri::command] pub fn start_run(manager:tauri::State<'_,RunManager>,input:StartRunInput)->Result<String,String>{manager.start(input)}
#[tauri::command] pub fn pause_run(manager:tauri::State<'_,RunManager>,run_id:String)->Result<ExecutionRun,String>{manager.pause(&run_id)}
#[tauri::command] pub fn resume_run(manager:tauri::State<'_,RunManager>,run_id:String)->Result<ExecutionRun,String>{manager.resume(&run_id)}
#[tauri::command] pub fn terminate_run(manager:tauri::State<'_,RunManager>,run_id:String)->Result<ExecutionRun,String>{manager.terminate(&run_id)}
#[tauri::command] pub fn get_run(manager:tauri::State<'_,RunManager>,run_id:String)->Result<Option<ExecutionRun>,String>{let owner=crate::auth::current_user_id()?;Ok(load_run(&manager.db()?,&run_id)?.filter(|r|r.owner_id==owner))}
#[tauri::command] pub fn list_runs(manager:tauri::State<'_,RunManager>)->Result<Vec<ExecutionRun>,String>{list_run_records(&manager.db()?,&crate::auth::current_user_id()?,false)}
#[tauri::command] pub fn list_active_runs(manager:tauri::State<'_,RunManager>)->Result<Vec<ExecutionRun>,String>{list_run_records(&manager.db()?,&crate::auth::current_user_id()?,true)}
#[tauri::command] pub fn list_run_events(manager:tauri::State<'_,RunManager>,run_id:String,after_sequence:Option<i64>)->Result<Vec<ExecutionRunEvent>,String>{manager.owned(&run_id)?;events_after(&manager.db()?,&run_id,after_sequence.unwrap_or(0))}
