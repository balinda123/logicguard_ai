use crate::testing::{
    self, AppendWorkflowRunEventInput, CreateTestAccountInput, CreateWorkflowRunInput,
    LoginAutomationConfig, SaveAccountCombinationInput, SaveDefectDraftInput,
    SaveFailureEvidenceInput, SaveWorkflowScenarioInput, UpdateTestAccountInput,
    UpdateWorkflowRunInput,
};
use rusqlite::Connection;

fn connection() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(
        "PRAGMA foreign_keys=ON;
         CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
         INSERT INTO users(id, username, password_hash, role) VALUES
           ('admin', 'admin', 'hash', 'admin'),
           ('owner-a', 'owner-a', 'hash', 'user'),
           ('owner-b', 'owner-b', 'hash', 'user');",
    )
    .unwrap();
    testing::initialize_schema(&conn).unwrap();
    conn
}

fn account_input(business_role: &str) -> CreateTestAccountInput {
    CreateTestAccountInput {
        display_name: format!("{business_role} account"),
        business_role: business_role.to_string(),
        login_mode: "automatic".to_string(),
        login_config: LoginAutomationConfig {
            login_url: "https://example.test/login".to_string(),
            page_selector: Some("main[data-page='login']".to_string()),
            username_selector: Some("#username".to_string()),
            password_selector: Some("#password".to_string()),
            submit_selector: Some("#login".to_string()),
            success_selector: Some("[data-test='home']".to_string()),
        },
    }
}

fn create_scenario(conn: &Connection, owner_id: &str) -> String {
    testing::save_workflow_scenario_record(
        conn,
        owner_id,
        &SaveWorkflowScenarioInput {
            id: None,
            name: "employee boundary".to_string(),
            scenario_kind: "single_role".to_string(),
            source_test_case_id: Some("case-1".to_string()),
            business_tags_json: r#"["boundary"]"#.to_string(),
            preconditions_json: "[]".to_string(),
            steps_json: r#"[{"id":"step-1","intent":"create goal"}]"#.to_string(),
        },
    )
    .unwrap()
    .id
}

#[test]
fn creates_testing_schema_with_owner_scoped_resources() {
    let conn = connection();
    for table in [
        "test_accounts",
        "account_combinations",
        "workflow_scenarios",
        "workflow_runs",
        "workflow_events",
        "failure_evidence",
        "defect_drafts",
    ] {
        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
                [table],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(exists, 1, "missing table {table}");
    }
}

#[test]
fn non_admin_cannot_create_test_accounts() {
    let conn = connection();
    let error =
        testing::create_test_account_record(&conn, "user", &account_input("employee")).unwrap_err();
    assert_eq!(error, "ADMIN_REQUIRED");
    assert!(testing::list_test_accounts_record(&conn)
        .unwrap()
        .is_empty());
}

#[test]
fn account_dto_generates_non_secret_credential_metadata() {
    let conn = connection();
    let account =
        testing::create_test_account_record(&conn, "admin", &account_input("employee")).unwrap();
    assert_eq!(account.masked_login_name, "not-configured");
    assert_eq!(
        account.credential_ref,
        format!("logicguard.test-account.{}", account.id)
    );
    let serialized = serde_json::to_value(account).unwrap();
    let object = serialized.as_object().unwrap();
    assert!(object.contains_key("maskedLoginName"));
    assert!(object.contains_key("credentialRef"));
    for forbidden in ["username", "password", "otp", "accessToken", "secret"] {
        assert!(
            !object.contains_key(forbidden),
            "must not expose {forbidden}"
        );
    }
}

#[test]
fn rejects_caller_credential_fields_and_unstructured_login_config() {
    let caller_supplied_credentials = r#"{
        "displayName":"employee account",
        "businessRole":"employee",
        "maskedLoginName":"employee-real-name",
        "credentialRef":"outside-keyring-reference",
        "loginMode":"automatic",
        "loginConfig":{"loginUrl":"https://example.test/login"}
    }"#;
    assert!(serde_json::from_str::<CreateTestAccountInput>(caller_supplied_credentials).is_err());

    let update_with_caller_credentials = r#"{
        "id":"account-id",
        "displayName":"employee account",
        "businessRole":"employee",
        "maskedLoginName":"employee-real-name",
        "credentialRef":"outside-keyring-reference",
        "loginMode":"automatic",
        "loginConfig":{"loginUrl":"https://example.test/login"}
    }"#;
    assert!(
        serde_json::from_str::<UpdateTestAccountInput>(update_with_caller_credentials).is_err()
    );

    let arbitrary_json = r#"{
        "displayName":"employee account",
        "businessRole":"employee",
        "loginMode":"automatic",
        "loginConfig":"{\\"password\\":\\"must-not-be-stored\\"}"
    }"#;
    assert!(serde_json::from_str::<CreateTestAccountInput>(arbitrary_json).is_err());

    let unknown_config_field = r#"{
        "displayName":"employee account",
        "businessRole":"employee",
        "loginMode":"automatic",
        "loginConfig":{"loginUrl":"https://example.test/login","password":"must-not-be-stored"}
    }"#;
    assert!(serde_json::from_str::<CreateTestAccountInput>(unknown_config_field).is_err());
}

#[test]
fn rejects_unknown_enums_and_sensitive_login_config_values() {
    let conn = connection();
    let mut invalid_role = account_input("intern");
    assert!(testing::create_test_account_record(&conn, "admin", &invalid_role).is_err());

    invalid_role.business_role = "employee".to_string();
    invalid_role.login_config.login_url = "ftp://example.test/login".to_string();
    assert!(testing::create_test_account_record(&conn, "admin", &invalid_role).is_err());

    invalid_role.login_config.login_url =
        "https://example.test/login?access_token=must-not-be-stored".to_string();
    assert!(testing::create_test_account_record(&conn, "admin", &invalid_role).is_err());

    invalid_role.login_config.login_url =
        "https://employee:password@example.test/login".to_string();
    assert!(testing::create_test_account_record(&conn, "admin", &invalid_role).is_err());

    let scenario_id = create_scenario(&conn, "owner-a");
    assert!(testing::create_workflow_run_record(
        &conn,
        "owner-a",
        &CreateWorkflowRunInput {
            scenario_id,
            account_combination_id: None,
            status: "unknown".to_string(),
            current_step_order: 0,
        },
    )
    .is_err());
}

#[test]
fn accepts_only_valid_masked_login_names_after_credential_write() {
    let conn = connection();
    let account =
        testing::create_test_account_record(&conn, "admin", &account_input("employee")).unwrap();

    assert!(testing::update_masked_login_name_after_credential_write(
        &conn,
        &account.id,
        "employee***"
    )
    .is_ok());
    assert!(testing::update_masked_login_name_after_credential_write(
        &conn,
        &account.id,
        "employee@example.test***"
    )
    .is_err());
    assert!(testing::update_masked_login_name_after_credential_write(
        &conn,
        &account.id,
        "employee**"
    )
    .is_err());
}

#[test]
fn sqlite_test_account_metadata_contains_no_caller_secret_values() {
    let conn = connection();
    let account =
        testing::create_test_account_record(&conn, "admin", &account_input("employee")).unwrap();
    let stored: (String, String, String) = conn
        .query_row(
            "SELECT masked_login_name, credential_ref, login_config_json FROM test_accounts WHERE id=?1",
            [&account.id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!(stored.0, "not-configured");
    assert_eq!(stored.1, format!("logicguard.test-account.{}", account.id));
    for forbidden in [
        "real-login",
        "actual-password-value",
        "actual-token-value",
        "actual-otp-value",
        "actual-secret-value",
    ] {
        assert!(!stored.2.contains(forbidden), "must not store {forbidden}");
    }
}

#[test]
fn owner_scoping_prevents_cross_owner_reads_updates_and_deletes() {
    let mut conn = connection();
    let employee_id =
        testing::create_test_account_record(&conn, "admin", &account_input("employee"))
            .unwrap()
            .id;
    let combination = testing::save_account_combination_record(
        &conn,
        "owner-a",
        &SaveAccountCombinationInput {
            id: None,
            name: "path A".to_string(),
            employee_account_id: Some(employee_id),
            manager_account_id: None,
            hrbp_account_id: None,
        },
    )
    .unwrap();
    let foreign_combination_update = SaveAccountCombinationInput {
        id: Some(combination.id.clone()),
        name: "hijacked".to_string(),
        employee_account_id: None,
        manager_account_id: None,
        hrbp_account_id: None,
    };
    assert!(testing::save_account_combination_record(
        &conn,
        "owner-b",
        &foreign_combination_update
    )
    .is_err());
    assert!(testing::list_account_combinations_record(&conn, "owner-b")
        .unwrap()
        .is_empty());
    assert!(testing::delete_account_combination_record(&conn, "owner-b", &combination.id).is_err());

    let scenario_id = create_scenario(&conn, "owner-a");
    let foreign_scenario_update = SaveWorkflowScenarioInput {
        id: Some(scenario_id.clone()),
        name: "hijacked scenario".to_string(),
        scenario_kind: "workflow".to_string(),
        source_test_case_id: None,
        business_tags_json: "[]".to_string(),
        preconditions_json: "[]".to_string(),
        steps_json: "[]".to_string(),
    };
    assert!(
        testing::save_workflow_scenario_record(&conn, "owner-b", &foreign_scenario_update).is_err()
    );
    assert!(testing::list_workflow_scenarios_record(&conn, "owner-b")
        .unwrap()
        .is_empty());
    assert!(testing::delete_workflow_scenario_record(&conn, "owner-b", &scenario_id).is_err());

    let run = testing::create_workflow_run_record(
        &conn,
        "owner-a",
        &CreateWorkflowRunInput {
            scenario_id: scenario_id.clone(),
            account_combination_id: None,
            status: "queued".to_string(),
            current_step_order: 0,
        },
    )
    .unwrap();
    assert!(testing::update_workflow_run_record(
        &conn,
        "owner-b",
        &UpdateWorkflowRunInput {
            id: run.id.clone(),
            status: "passed".to_string(),
            current_step_order: 1,
            started_at: None,
            finished_at: None,
        },
    )
    .is_err());
    assert!(testing::list_workflow_runs_record(&conn, "owner-b")
        .unwrap()
        .is_empty());

    assert!(testing::append_workflow_run_event_record(
        &mut conn,
        "owner-b",
        &AppendWorkflowRunEventInput {
            run_id: run.id.clone(),
            phase: "action".to_string(),
            business_role: Some("employee".to_string()),
            message: "unauthorized".to_string(),
        },
    )
    .is_err());
    assert!(testing::list_workflow_run_events_record(&conn, "owner-b", &run.id).is_err());

    assert!(testing::save_failure_evidence_record(
        &conn,
        "owner-b",
        &SaveFailureEvidenceInput {
            id: None,
            run_id: run.id.clone(),
            step_id: "step-1".to_string(),
            expected_value: "saved".to_string(),
            actual_value: "error".to_string(),
            screenshot_path: None,
        },
    )
    .is_err());
    assert!(testing::list_failure_evidence_record(&conn, "owner-b", Some(&run.id)).is_err());

    assert!(testing::save_defect_draft_record(
        &conn,
        "owner-b",
        &SaveDefectDraftInput {
            id: None,
            scenario_id,
            run_id: run.id.clone(),
            evidence_id: None,
            status: "pending_confirmation".to_string(),
            title: "foreign draft".to_string(),
            reproduction_steps_json: "[]".to_string(),
            expected_result: "saved".to_string(),
            actual_result: "error".to_string(),
            impact_summary: "workflow blocked".to_string(),
            business_role: Some("employee".to_string()),
        },
    )
    .is_err());
    assert!(testing::list_defect_drafts_record(&conn, "owner-b")
        .unwrap()
        .is_empty());
}

#[test]
fn events_receive_monotonically_increasing_sequence_numbers() {
    let mut conn = connection();
    let scenario_id = create_scenario(&conn, "owner-a");
    let run = testing::create_workflow_run_record(
        &conn,
        "owner-a",
        &CreateWorkflowRunInput {
            scenario_id,
            account_combination_id: None,
            status: "running".to_string(),
            current_step_order: 0,
        },
    )
    .unwrap();
    let first = testing::append_workflow_run_event_record(
        &mut conn,
        "owner-a",
        &AppendWorkflowRunEventInput {
            run_id: run.id.clone(),
            phase: "login".to_string(),
            business_role: Some("employee".to_string()),
            message: "signed in".to_string(),
        },
    )
    .unwrap();
    let second = testing::append_workflow_run_event_record(
        &mut conn,
        "owner-a",
        &AppendWorkflowRunEventInput {
            run_id: run.id.clone(),
            phase: "assertion".to_string(),
            business_role: None,
            message: "check passed".to_string(),
        },
    )
    .unwrap();
    assert_eq!(first.sequence_no, 1);
    assert_eq!(second.sequence_no, 2);
}

#[test]
fn status_updates_are_owner_scoped_and_validate_the_defect_lifecycle() {
    let conn = connection();
    let scenario_id = create_scenario(&conn, "owner-a");
    let run = testing::create_workflow_run_record(
        &conn,
        "owner-a",
        &CreateWorkflowRunInput {
            scenario_id: scenario_id.clone(),
            account_combination_id: None,
            status: "business_failed".to_string(),
            current_step_order: 1,
        },
    )
    .unwrap();
    let draft = testing::save_defect_draft_record(
        &conn,
        "owner-a",
        &SaveDefectDraftInput {
            id: None,
            scenario_id,
            run_id: run.id,
            evidence_id: None,
            status: "pending_confirmation".to_string(),
            title: "goal limit".to_string(),
            reproduction_steps_json: "[]".to_string(),
            expected_result: "reject 101 chars".to_string(),
            actual_result: "accepted".to_string(),
            impact_summary: "employee goal creation".to_string(),
            business_role: Some("employee".to_string()),
        },
    )
    .unwrap();
    assert!(
        testing::update_defect_draft_status_record(&conn, "owner-a", &draft.id, "invalid").is_err()
    );
    assert!(
        testing::update_defect_draft_status_record(&conn, "owner-b", &draft.id, "pending_fix")
            .is_err()
    );
    let updated =
        testing::update_defect_draft_status_record(&conn, "owner-a", &draft.id, "pending_fix")
            .unwrap();
    assert_eq!(updated.status, "pending_fix");
}
