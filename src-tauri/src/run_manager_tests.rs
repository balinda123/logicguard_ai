use super::run_manager::*;
use rusqlite::Connection;
use serde_json::json;

#[derive(Default)]
struct FakeWorker { completed_commands: usize }
impl FakeWorker { fn complete_atomic_command(&mut self) { self.completed_commands += 1; } }

#[derive(Default)]
struct FakeClock { delays: Vec<u64> }
impl FakeClock { fn advance(&mut self, milliseconds: u64) { self.delays.push(milliseconds); } }

fn database() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    initialize_schema(&conn).unwrap();
    conn
}

fn plan() -> ExecutionPlan {
    ExecutionPlan {
        commands: vec![json!({
            "command": "execute",
            "step": { "action": "navigate", "url": "https://example.test/" },
            "allowedOrigins": ["https://example.test"],
            "timeoutMs": 1000
        })],
    }
}

#[test]
fn transition_table_and_terminal_states_are_centralized() {
    assert!(can_transition(RunStatus::Queued, RunStatus::Preflight));
    assert!(can_transition(RunStatus::Running, RunStatus::PauseRequested));
    assert!(can_transition(RunStatus::PauseRequested, RunStatus::Paused));
    assert!(!can_transition(RunStatus::Passed, RunStatus::Running));
    assert!(RunStatus::Passed.is_terminal());
    assert!(RunStatus::BusinessFailed.is_terminal());
    assert!(RunStatus::Blocked.is_terminal());
    assert!(RunStatus::Cancelled.is_terminal());
    assert!(RunStatus::Interrupted.is_terminal());
    assert!(!RunStatus::WaitingHandoff.is_terminal());
}

#[test]
fn pause_is_applied_only_after_an_atomic_command_checkpoint() {
    let mut control = RunControl::default();
    let mut worker = FakeWorker::default();
    control.request_pause();
    assert_eq!(control.status_during_command(), RunStatus::PauseRequested);
    worker.complete_atomic_command();
    assert_eq!(control.after_command(worker.completed_commands as i64), ControlDecision::PauseAt(1));
}

#[test]
fn coordinator_grants_only_one_browser_lease() {
    let mut leases = LeaseCoordinator::default();
    assert!(leases.try_acquire("run-a"));
    assert!(!leases.try_acquire("run-b"));
    leases.release("run-a");
    assert!(leases.try_acquire("run-b"));
}

#[test]
fn pause_handoff_terminal_and_watchdog_states_release_browser_input() {
    assert!(!releases_interaction_guard(RunStatus::Running));
    assert!(!releases_interaction_guard(RunStatus::PauseRequested));
    assert!(releases_interaction_guard(RunStatus::Paused));
    assert!(releases_interaction_guard(RunStatus::WaitingHandoff));
    assert!(releases_interaction_guard(RunStatus::Passed));
    assert!(releases_interaction_guard(RunStatus::Blocked));
    assert!(releases_interaction_guard(RunStatus::Interrupted));
}

#[test]
fn a_run_cannot_enter_running_without_the_browser_guard() {
    assert_eq!(status_after_guard_acquisition(false), RunStatus::Blocked);
    assert_eq!(status_after_guard_acquisition(true), RunStatus::Running);
}

#[test]
fn resume_revalidation_failure_becomes_blocked() {
    assert_eq!(resume_target(Err("origin unavailable".into())), RunStatus::Blocked);
    assert_eq!(resume_target(Ok(())), RunStatus::Queued);
}

#[test]
fn cancellation_and_startup_recovery_are_distinct() {
    assert_eq!(completion_for_stop(true, false), RunStatus::Cancelled);
    assert_eq!(completion_for_stop(false, true), RunStatus::Interrupted);
    let conn = database();
    insert_run_for_test(&conn, "active", RunStatus::Running, &plan(), &json!({})).unwrap();
    assert_eq!(recover_interrupted(&conn).unwrap(), 1);
    assert_eq!(load_run(&conn, "active").unwrap().unwrap().status, RunStatus::Interrupted);
}

#[test]
fn retryable_model_failures_exhaust_to_blocked() {
    let policy = RetryPolicy { max_attempts: 3, base_delay_ms: 10 };
    let mut clock = FakeClock::default();
    for (attempt, category) in [(1, ErrorCategory::Connection), (2, ErrorCategory::Timeout)] {
        let RetryDecision::RetryAfter(delay) = policy.decision(attempt, category) else { panic!("retry expected") };
        clock.advance(delay);
    }
    assert_eq!(clock.delays, vec![10, 20]);
    assert_eq!(policy.decision(3, ErrorCategory::ModelResponse), RetryDecision::Blocked);
    assert_eq!(policy.decision(1, ErrorCategory::BusinessAssertion), RetryDecision::BusinessFailed);
}

#[test]
fn snapshot_is_immutable_and_event_sequence_is_transactional() {
    let mut conn = database();
    insert_run_for_test(&conn, "run-1", RunStatus::Queued, &plan(), &json!({"scenario":"v1"})).unwrap();
    assert!(replace_snapshot_for_test(&conn, "run-1", &json!({"scenario":"v2"})).is_err());
    let first = append_event(&mut conn, "run-1", "queued", &json!({})).unwrap();
    let second = append_event(&mut conn, "run-1", "preflight", &json!({})).unwrap();
    assert_eq!((first.sequence, second.sequence), (1, 2));
}

#[test]
fn execution_plan_rejects_arbitrary_commands_and_secrets() {
    assert!(validate_plan(&plan()).is_ok());
    assert!(validate_plan(&ExecutionPlan { commands: vec![json!({"command":"script", "source":"alert(1)"})] }).is_err());
    assert!(validate_plan(&ExecutionPlan { commands: vec![json!({"command":"act", "instruction":"use {{password}}", "allowedOrigins":["https://example.test"], "timeoutMs":1000})] }).is_err());
}
