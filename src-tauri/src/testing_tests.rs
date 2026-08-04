use crate::testing::{
    self, AppendWorkflowRunEventInput, CreateScopedTestAccountInput, CreateScopedWorkflowRunInput,
    CreateTestAccountInput, CreateWorkflowRunInput, LoginAutomationConfig,
    SaveAccountCombinationInput, SaveDefectDraftInput, SaveFailureEvidenceInput,
    SaveScopedAccountCombinationInput, SaveScopedWorkflowScenarioInput, SaveWorkflowScenarioInput,
    ScopeRef, UpdateTestAccountInput, UpdateWorkflowRunInput,
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
    crate::test_design::initialize_schema(&conn).unwrap();
    conn
}

fn scoped_design(
    conn: &mut Connection,
    owner_id: &str,
    system_name: &str,
) -> (ScopeRef, String, String) {
    let system = crate::test_design::create_system_record(conn, "admin", system_name).unwrap();
    let environment = crate::test_design::create_environment_record(
        conn,
        "admin",
        &crate::test_design::CreateEnvironmentInput {
            system_id: system.id.clone(),
            kind: "test".to_string(),
            name: format!("{system_name} test"),
            base_url: format!(
                "https://{}.example.test",
                system_name.to_lowercase().replace(' ', "-")
            ),
        },
    )
    .unwrap();
    let design = crate::test_design::create_test_design_record(
        conn,
        owner_id,
        &crate::test_design::CreateTestDesignInput {
            system_id: system.id.clone(),
            environment_id: environment.id.clone(),
            title: format!("{system_name} design"),
            status: "draft".to_string(),
        },
    )
    .unwrap();
    let requirement = crate::test_design::create_requirement_version_record(
        conn,
        owner_id,
        &crate::test_design::CreateRequirementVersionInput {
            design_id: design.id.clone(),
            source_kind: "manual".to_string(),
            content: "approved requirement".to_string(),
        },
    )
    .unwrap();
    (
        ScopeRef {
            system_id: system.id,
            environment_id: environment.id,
        },
        design.id,
        requirement.id,
    )
}

fn scoped_steps_json() -> String {
    r#"[{"id":"step-payroll","order":1,"role":"employee","actionIntent":"Submit payroll","assertions":["Payroll is accepted"],"pageUrl":"https://payroll.example.test","selector":"#submit","expectedValue":"accepted","createdAt":"2026-08-04T00:00:00Z","updatedAt":"2026-08-04T00:00:00Z"}]"#.to_string()
}

#[test]
fn upgrades_existing_testing_schema_idempotently_with_explicit_legacy_scope() {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(
        "CREATE TABLE users (id TEXT PRIMARY KEY);
         INSERT INTO users(id) VALUES ('owner-a');
         CREATE TABLE test_accounts (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, business_role TEXT NOT NULL, masked_login_name TEXT NOT NULL, credential_ref TEXT NOT NULL, login_mode TEXT NOT NULL, login_config_json TEXT NOT NULL, is_enabled INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
         CREATE TABLE account_combinations (id TEXT PRIMARY KEY, name TEXT NOT NULL, employee_account_id TEXT, manager_account_id TEXT, hrbp_account_id TEXT, owner_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
         CREATE TABLE workflow_scenarios (id TEXT PRIMARY KEY, name TEXT NOT NULL, scenario_kind TEXT NOT NULL, source_test_case_id TEXT, business_tags_json TEXT NOT NULL, preconditions_json TEXT NOT NULL, steps_json TEXT NOT NULL, owner_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
         CREATE TABLE workflow_runs (id TEXT PRIMARY KEY, scenario_id TEXT NOT NULL, account_combination_id TEXT, status TEXT NOT NULL, current_step_order INTEGER NOT NULL, owner_id TEXT NOT NULL, started_at TEXT, finished_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
         CREATE TABLE failure_evidence (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, step_id TEXT NOT NULL, expected_value TEXT NOT NULL, actual_value TEXT NOT NULL, screenshot_path TEXT, owner_id TEXT NOT NULL, created_at TEXT NOT NULL);
         CREATE TABLE defect_drafts (id TEXT PRIMARY KEY, scenario_id TEXT NOT NULL, run_id TEXT NOT NULL, evidence_id TEXT, status TEXT NOT NULL, title TEXT NOT NULL, reproduction_steps_json TEXT NOT NULL, expected_result TEXT NOT NULL, actual_result TEXT NOT NULL, impact_summary TEXT NOT NULL, business_role TEXT, owner_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);"
    ).unwrap();

    testing::initialize_schema(&conn).unwrap();
    testing::initialize_schema(&conn).unwrap();

    for table in [
        "test_accounts",
        "account_combinations",
        "workflow_scenarios",
        "workflow_runs",
        "failure_evidence",
        "defect_drafts",
    ] {
        let columns: Vec<String> = conn
            .prepare(&format!("PRAGMA table_info({table})"))
            .unwrap()
            .query_map([], |row| row.get(1))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert!(
            columns.contains(&"system_id".to_string()),
            "{table} missing system_id"
        );
        assert!(
            columns.contains(&"environment_id".to_string()),
            "{table} missing environment_id"
        );
        assert!(
            columns.contains(&"scope_state".to_string()),
            "{table} missing scope_state"
        );
    }
    let run_columns: Vec<String> = conn
        .prepare("PRAGMA table_info(workflow_runs)")
        .unwrap()
        .query_map([], |row| row.get(1))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    for column in ["design_id", "requirement_version_id", "snapshot_json"] {
        assert!(
            run_columns.contains(&column.to_string()),
            "workflow_runs missing {column}"
        );
    }
}

#[test]
fn scoped_run_rejects_cross_environment_and_freezes_snapshot() {
    let mut conn = connection();
    let (scope_a, design_id, requirement_version_id) =
        scoped_design(&mut conn, "owner-a", "Payroll");
    let (scope_b, _, _) = scoped_design(&mut conn, "owner-a", "Recruiting");
    let account = testing::create_scoped_test_account_record(
        &conn,
        "admin",
        "admin",
        &CreateScopedTestAccountInput {
            scope: scope_a.clone(),
            account: account_input("employee"),
        },
    )
    .unwrap();
    let combination = testing::save_scoped_account_combination_record(
        &conn,
        "owner-a",
        &SaveScopedAccountCombinationInput {
            scope: scope_a.clone(),
            combination: SaveAccountCombinationInput {
                id: None,
                name: "Payroll employee".into(),
                employee_account_id: Some(account.id),
                manager_account_id: None,
                hrbp_account_id: None,
            },
        },
    )
    .unwrap();
    let scenario = testing::save_scoped_workflow_scenario_record(
        &conn,
        "owner-a",
        &SaveScopedWorkflowScenarioInput {
            scope: scope_a.clone(),
            scenario: SaveWorkflowScenarioInput {
                id: None,
                name: "Submit payroll".into(),
                scenario_kind: "single_role".into(),
                source_test_case_id: Some("case-payroll".into()),
                business_tags_json: "[]".into(),
                preconditions_json: "[]".into(),
                steps_json: scoped_steps_json(),
            },
        },
    )
    .unwrap();
    let cross = testing::create_scoped_workflow_run_record(
        &mut conn,
        "owner-a",
        &CreateScopedWorkflowRunInput {
            scope: scope_b,
            design_id: design_id.clone(),
            requirement_version_id: requirement_version_id.clone(),
            scenario_id: scenario.id.clone(),
            account_combination_id: Some(combination.id.clone()),
        },
    )
    .unwrap_err();
    assert_eq!(cross, "CROSS_ENVIRONMENT_REFERENCE");

    let run = testing::create_scoped_workflow_run_record(
        &mut conn,
        "owner-a",
        &CreateScopedWorkflowRunInput {
            scope: scope_a,
            design_id,
            requirement_version_id,
            scenario_id: scenario.id.clone(),
            account_combination_id: Some(combination.id.clone()),
        },
    )
    .unwrap();
    assert_eq!(run.scope_state, "scoped");
    assert_eq!(run.snapshot.scenario.name, "Submit payroll");
    assert_eq!(run.snapshot.case_ids, vec!["case-payroll"]);
    let snapshot_json = serde_json::to_value(&run.snapshot).unwrap();
    assert_eq!(
        snapshot_json["scenario"]["steps"][0]["actionIntent"],
        "Submit payroll"
    );
    assert_eq!(snapshot_json["scenario"]["steps"][0]["order"], 1);
    assert_eq!(
        snapshot_json["scenario"]["steps"][0]["createdAt"],
        "2026-08-04T00:00:00Z"
    );

    conn.execute(
        "UPDATE workflow_scenarios SET name='Edited scenario', steps_json='[]' WHERE id=?1",
        [&scenario.id],
    )
    .unwrap();
    conn.execute(
        "UPDATE account_combinations SET name='Edited combination' WHERE id=?1",
        [&combination.id],
    )
    .unwrap();
    let updated = testing::update_workflow_run_record(
        &conn,
        "owner-a",
        &UpdateWorkflowRunInput {
            id: run.id.clone(),
            status: "running".into(),
            current_step_order: 0,
        },
    )
    .unwrap();
    assert_eq!(updated.snapshot, run.snapshot);
    assert_eq!(updated.snapshot.scenario.name, "Submit payroll");
    assert_eq!(
        updated.snapshot.combination.unwrap().name,
        "Payroll employee"
    );

    let evidence = testing::save_failure_evidence_record(
        &conn,
        "owner-a",
        &SaveFailureEvidenceInput {
            id: None,
            run_id: run.id.clone(),
            step_id: "step-payroll".into(),
            expected_value: "accepted".into(),
            actual_value: "rejected".into(),
            screenshot_path: None,
        },
    )
    .unwrap();
    assert_eq!(evidence.system_id, run.system_id);
    assert_eq!(evidence.environment_id, run.environment_id);
    assert_eq!(evidence.scope_state, "scoped");

    let defect =
        testing::save_defect_draft_record(&conn, "owner-a", &defect_input(scenario.id, run.id))
            .unwrap();
    assert_eq!(defect.system_id, run.system_id);
    assert_eq!(defect.environment_id, run.environment_id);
    assert_eq!(defect.scope_state, "scoped");
}

#[test]
fn scoped_resources_reject_cross_owner_and_cross_scope_account_references() {
    let mut conn = connection();
    let (scope_a, design_id, requirement_version_id) =
        scoped_design(&mut conn, "owner-a", "Benefits");
    let (scope_b, _, _) = scoped_design(&mut conn, "owner-a", "Learning");
    let account = testing::create_scoped_test_account_record(
        &conn,
        "admin",
        "admin",
        &CreateScopedTestAccountInput {
            scope: scope_a.clone(),
            account: account_input("employee"),
        },
    )
    .unwrap();
    let error = testing::save_scoped_account_combination_record(
        &conn,
        "owner-a",
        &SaveScopedAccountCombinationInput {
            scope: scope_b,
            combination: SaveAccountCombinationInput {
                id: None,
                name: "invalid".into(),
                employee_account_id: Some(account.id),
                manager_account_id: None,
                hrbp_account_id: None,
            },
        },
    )
    .unwrap_err();
    assert_eq!(error, "CROSS_ENVIRONMENT_REFERENCE");

    let scenario = testing::save_scoped_workflow_scenario_record(
        &conn,
        "owner-a",
        &SaveScopedWorkflowScenarioInput {
            scope: scope_a.clone(),
            scenario: SaveWorkflowScenarioInput {
                id: None,
                name: "Benefits".into(),
                scenario_kind: "single_role".into(),
                source_test_case_id: None,
                business_tags_json: "[]".into(),
                preconditions_json: "[]".into(),
                steps_json: "[]".into(),
            },
        },
    )
    .unwrap();
    let legacy_run_error = testing::create_workflow_run_record(
        &conn,
        "owner-a",
        &CreateWorkflowRunInput {
            scenario_id: scenario.id.clone(),
            account_combination_id: None,
            status: "queued".into(),
            current_step_order: 0,
        },
    )
    .unwrap_err();
    assert_eq!(legacy_run_error, "SCOPED_API_REQUIRED");
    let error = testing::create_scoped_workflow_run_record(
        &mut conn,
        "owner-b",
        &CreateScopedWorkflowRunInput {
            scope: scope_a,
            design_id,
            requirement_version_id,
            scenario_id: scenario.id,
            account_combination_id: None,
        },
    )
    .unwrap_err();
    assert_eq!(error, "NOT_FOUND");
}

#[test]
fn scoped_scenario_rejects_steps_that_do_not_match_the_public_contract() {
    let mut conn = connection();
    let (scope, _, _) = scoped_design(&mut conn, "owner-a", "Invalid steps");
    for steps_json in [
        r#"[{"id":"step-1","order":1,"role":"employee","assertions":[],"createdAt":"now","updatedAt":"now"}]"#,
        r#"[{"id":"step-1","role":"employee","actionIntent":"submit","assertions":[],"createdAt":"now","updatedAt":"now"}]"#,
        r#"[{"id":"step-1","order":1,"role":"employee","actionIntent":"submit","assertions":[]}]"#,
    ] {
        let error = testing::save_scoped_workflow_scenario_record(
            &conn,
            "owner-a",
            &SaveScopedWorkflowScenarioInput {
                scope: scope.clone(),
                scenario: SaveWorkflowScenarioInput {
                    id: None,
                    name: "Invalid".into(),
                    scenario_kind: "single_role".into(),
                    source_test_case_id: None,
                    business_tags_json: "[]".into(),
                    preconditions_json: "[]".into(),
                    steps_json: steps_json.into(),
                },
            },
        )
        .unwrap_err();
        assert_eq!(error, "INVALID_WORKFLOW_STEPS");
    }
}

fn account_input(business_role: &str) -> CreateTestAccountInput {
    CreateTestAccountInput {
        display_name: format!("{business_role} account"),
        business_role: business_role.to_string(),
        login_mode: "automatic".to_string(),
        login_config: LoginAutomationConfig {
            login_url: "https://example.test/login".to_string(),
            page_selector: Some("main[data-page]".to_string()),
            username_selector: Some("#username".to_string()),
            password_selector: Some("#password".to_string()),
            submit_selector: Some("#login".to_string()),
            success_selector: Some("[data-test]".to_string()),
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

fn create_queued_run(
    conn: &Connection,
    owner_id: &str,
    scenario_id: String,
    account_combination_id: Option<String>,
) -> testing::WorkflowRun {
    testing::create_workflow_run_record(
        conn,
        owner_id,
        &CreateWorkflowRunInput {
            scenario_id,
            account_combination_id,
            status: "queued".to_string(),
            current_step_order: 0,
        },
    )
    .unwrap()
}

fn start_workflow_run(conn: &Connection, owner_id: &str, id: String) -> testing::WorkflowRun {
    testing::update_workflow_run_record(
        conn,
        owner_id,
        &UpdateWorkflowRunInput {
            id,
            status: "running".to_string(),
            current_step_order: 0,
        },
    )
    .unwrap()
}

fn defect_input(scenario_id: String, run_id: String) -> SaveDefectDraftInput {
    SaveDefectDraftInput {
        id: None,
        scenario_id,
        run_id,
        evidence_id: None,
        status: "pending_confirmation".to_string(),
        title: "goal limit".to_string(),
        reproduction_steps_json: "[]".to_string(),
        expected_result: "reject 101 chars".to_string(),
        actual_result: "accepted".to_string(),
        impact_summary: "employee goal creation".to_string(),
        business_role: Some("employee".to_string()),
    }
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
fn credential_write_masks_username_before_persisting_metadata() {
    assert_eq!(testing::mask_login_name("employee@example.test"), "em***");
    assert_eq!(testing::mask_login_name("01-user"), "01***");
    assert_eq!(testing::mask_login_name("\u{4f60}\u{597d}"), "user***");
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

    invalid_role.login_config.login_url = "https://example.test/login?next=dashboard".to_string();
    assert!(testing::create_test_account_record(&conn, "admin", &invalid_role).is_err());

    invalid_role.login_config.login_url = "https://example.test/login#handoff".to_string();
    assert!(testing::create_test_account_record(&conn, "admin", &invalid_role).is_err());

    invalid_role.login_config.login_url =
        "https://employee:password@example.test/login".to_string();
    assert!(testing::create_test_account_record(&conn, "admin", &invalid_role).is_err());

    invalid_role.login_config.login_url = "https://example.test/login".to_string();
    invalid_role.login_config.page_selector = Some("[data-note='real-password']".to_string());
    assert!(testing::create_test_account_record(&conn, "admin", &invalid_role).is_err());

    invalid_role.login_config.page_selector = Some("#token=secret".to_string());
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
            phase: "step_started".to_string(),
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
    let run = create_queued_run(&conn, "owner-a", scenario_id, None);
    let run = start_workflow_run(&conn, "owner-a", run.id);
    let first = testing::append_workflow_run_event_record(
        &mut conn,
        "owner-a",
        &AppendWorkflowRunEventInput {
            run_id: run.id.clone(),
            phase: "login_started".to_string(),
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
            phase: "assertion_passed".to_string(),
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
    let run = create_queued_run(&conn, "owner-a", scenario_id.clone(), None);
    let run = start_workflow_run(&conn, "owner-a", run.id);
    let run = testing::update_workflow_run_record(
        &conn,
        "owner-a",
        &UpdateWorkflowRunInput {
            id: run.id,
            status: "business_failed".to_string(),
            current_step_order: 1,
        },
    )
    .unwrap();
    let draft =
        testing::save_defect_draft_record(&conn, "owner-a", &defect_input(scenario_id, run.id))
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

#[test]
fn rejects_sensitive_values_before_events_evidence_and_defects_reach_sqlite() {
    let mut conn = connection();
    let scenario_id = create_scenario(&conn, "owner-a");
    let run = create_queued_run(&conn, "owner-a", scenario_id.clone(), None);

    let safe_event = testing::append_workflow_run_event_record(
        &mut conn,
        "owner-a",
        &AppendWorkflowRunEventInput {
            run_id: run.id.clone(),
            phase: "assertion_passed".to_string(),
            business_role: Some("employee".to_string()),
            message: "password field display error".to_string(),
        },
    );
    assert!(safe_event.is_ok());
    assert!(testing::append_workflow_run_event_record(
        &mut conn,
        "owner-a",
        &AppendWorkflowRunEventInput {
            run_id: run.id.clone(),
            phase: "assertion_failed".to_string(),
            business_role: Some("employee".to_string()),
            message: "password=real-secret".to_string(),
        },
    )
    .is_err());
    for message in [
        r#"{"username":"real-user","password":"real-secret"}"#,
        r#""login_name":"real-login""#,
        r#""access_token":"real-token""#,
        r#""api_key":"real-api-key""#,
    ] {
        let error = testing::append_workflow_run_event_record(
            &mut conn,
            "owner-a",
            &AppendWorkflowRunEventInput {
                run_id: run.id.clone(),
                phase: "assertion_failed".to_string(),
                business_role: Some("employee".to_string()),
                message: message.to_string(),
            },
        )
        .unwrap_err();
        assert_eq!(error, "SENSITIVE_WORKFLOW_EVENT_MESSAGE");
    }

    for phase in ["custom_phase", "token=secret"] {
        assert!(testing::append_workflow_run_event_record(
            &mut conn,
            "owner-a",
            &AppendWorkflowRunEventInput {
                run_id: run.id.clone(),
                phase: phase.to_string(),
                business_role: Some("employee".to_string()),
                message: "validation failed".to_string(),
            },
        )
        .is_err());
    }
    assert!(testing::append_workflow_run_event_record(
        &mut conn,
        "owner-a",
        &AppendWorkflowRunEventInput {
            run_id: run.id.clone(),
            phase: "assertion_failed".to_string(),
            business_role: Some("employee".to_string()),
            message: "password real-secret".to_string(),
        },
    )
    .is_err());

    for (expected_value, actual_value, screenshot_path) in [
        ("password=real-secret", "validation failed", None),
        ("validation failed", "Bearer abc", None),
        ("otp 123456", "authorization abc", None),
        (
            "validation failed",
            "validation failed",
            Some("failure-evidence/password=real-secret.png"),
        ),
    ] {
        assert!(testing::save_failure_evidence_record(
            &conn,
            "owner-a",
            &SaveFailureEvidenceInput {
                id: None,
                run_id: run.id.clone(),
                step_id: "step-1".to_string(),
                expected_value: expected_value.to_string(),
                actual_value: actual_value.to_string(),
                screenshot_path: screenshot_path.map(str::to_string),
            },
        )
        .is_err());
    }
    for (expected_value, actual_value, expected_error) in [
        (
            r#"{"username":"real-user"}"#,
            "validation failed",
            "SENSITIVE_EXPECTED_VALUE",
        ),
        (
            "validation failed",
            r#"{"login_name":"real-login","access_token":"real-token"}"#,
            "SENSITIVE_ACTUAL_VALUE",
        ),
        (
            "validation failed",
            r#""password":"quoted-secret""#,
            "SENSITIVE_ACTUAL_VALUE",
        ),
    ] {
        let error = testing::save_failure_evidence_record(
            &conn,
            "owner-a",
            &SaveFailureEvidenceInput {
                id: None,
                run_id: run.id.clone(),
                step_id: "step-1".to_string(),
                expected_value: expected_value.to_string(),
                actual_value: actual_value.to_string(),
                screenshot_path: None,
            },
        )
        .unwrap_err();
        assert_eq!(error, expected_error);
    }
    assert!(testing::save_failure_evidence_record(
        &conn,
        "owner-a",
        &SaveFailureEvidenceInput {
            id: None,
            run_id: run.id.clone(),
            step_id: "token=secret".to_string(),
            expected_value: "validation failed".to_string(),
            actual_value: "validation failed".to_string(),
            screenshot_path: None,
        },
    )
    .is_err());

    for malicious_draft in [
        SaveDefectDraftInput {
            title: "password=real-secret".to_string(),
            ..defect_input(scenario_id.clone(), run.id.clone())
        },
        SaveDefectDraftInput {
            reproduction_steps_json: r#"["Bearer abc"]"#.to_string(),
            ..defect_input(scenario_id.clone(), run.id.clone())
        },
        SaveDefectDraftInput {
            expected_result: "token=real-secret".to_string(),
            ..defect_input(scenario_id.clone(), run.id.clone())
        },
        SaveDefectDraftInput {
            actual_result: "Authorization: Bearer abc".to_string(),
            ..defect_input(scenario_id.clone(), run.id.clone())
        },
        SaveDefectDraftInput {
            impact_summary: "otp: real-secret".to_string(),
            ..defect_input(scenario_id.clone(), run.id.clone())
        },
    ] {
        assert!(testing::save_defect_draft_record(&conn, "owner-a", &malicious_draft).is_err());
    }

    let stored_event: String = conn
        .query_row(
            "SELECT group_concat(message, '|') FROM workflow_events",
            [],
            |row| row.get::<_, Option<String>>(0),
        )
        .unwrap()
        .unwrap_or_default();
    assert!(!stored_event.contains("password=real-secret"));
    assert!(!stored_event.contains("Bearer abc"));
    assert!(!stored_event.contains("password real-secret"));
    assert!(!stored_event.contains("real-user"));
    assert!(!stored_event.contains("real-login"));
    let stored_phase: String = conn
        .query_row(
            "SELECT group_concat(phase, '|') FROM workflow_events",
            [],
            |row| row.get::<_, Option<String>>(0),
        )
        .unwrap()
        .unwrap_or_default();
    assert_eq!(stored_phase, "assertion_passed");
    let stored_step_id: String = conn
        .query_row(
            "SELECT group_concat(step_id, '|') FROM failure_evidence",
            [],
            |row| row.get::<_, Option<String>>(0),
        )
        .unwrap()
        .unwrap_or_default();
    assert!(!stored_step_id.contains("token=secret"));
    let stored_evidence: String = conn
        .query_row(
            "SELECT group_concat(expected_value || '|' || actual_value, '|') FROM failure_evidence",
            [],
            |row| row.get::<_, Option<String>>(0),
        )
        .unwrap()
        .unwrap_or_default();
    for raw_value in [
        "real-user",
        "real-login",
        "real-token",
        "real-api-key",
        "quoted-secret",
    ] {
        assert!(
            !stored_evidence.contains(raw_value),
            "sensitive value must not reach failure_evidence"
        );
    }
    for table in ["failure_evidence", "defect_drafts"] {
        let count: i64 = conn
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 0, "sensitive input must not reach {table}");
    }
}

#[test]
fn workflow_runs_enforce_server_owned_state_and_timestamps() {
    let conn = connection();
    let scenario_id = create_scenario(&conn, "owner-a");

    assert!(testing::create_workflow_run_record(
        &conn,
        "owner-a",
        &CreateWorkflowRunInput {
            scenario_id: scenario_id.clone(),
            account_combination_id: None,
            status: "running".to_string(),
            current_step_order: 0,
        },
    )
    .is_err());
    assert!(testing::create_workflow_run_record(
        &conn,
        "owner-a",
        &CreateWorkflowRunInput {
            scenario_id: scenario_id.clone(),
            account_combination_id: None,
            status: "queued".to_string(),
            current_step_order: 1,
        },
    )
    .is_err());
    let run = create_queued_run(&conn, "owner-a", scenario_id, None);
    assert!(run.started_at.is_none());
    assert!(run.finished_at.is_none());

    let forged_timestamps = r#"{"id":"run","status":"running","currentStepOrder":0,"startedAt":"2030-01-01T00:00:00Z","finishedAt":"2030-01-01T00:00:00Z"}"#;
    assert!(serde_json::from_str::<UpdateWorkflowRunInput>(forged_timestamps).is_err());
    assert!(testing::update_workflow_run_record(
        &conn,
        "owner-a",
        &UpdateWorkflowRunInput {
            id: run.id.clone(),
            status: "passed".to_string(),
            current_step_order: 0,
        },
    )
    .is_err());

    let running = start_workflow_run(&conn, "owner-a", run.id);
    assert!(running.started_at.is_some());
    assert!(running.finished_at.is_none());
    let progressed = testing::update_workflow_run_record(
        &conn,
        "owner-a",
        &UpdateWorkflowRunInput {
            id: running.id.clone(),
            status: "running".to_string(),
            current_step_order: 1,
        },
    )
    .unwrap();
    assert!(testing::update_workflow_run_record(
        &conn,
        "owner-a",
        &UpdateWorkflowRunInput {
            id: progressed.id.clone(),
            status: "running".to_string(),
            current_step_order: 0,
        },
    )
    .is_err());
    let passed = testing::update_workflow_run_record(
        &conn,
        "owner-a",
        &UpdateWorkflowRunInput {
            id: progressed.id.clone(),
            status: "passed".to_string(),
            current_step_order: 1,
        },
    )
    .unwrap();
    assert!(passed.finished_at.is_some());
    assert!(testing::update_workflow_run_record(
        &conn,
        "owner-a",
        &UpdateWorkflowRunInput {
            id: passed.id,
            status: "running".to_string(),
            current_step_order: 1,
        },
    )
    .is_err());
}

#[test]
fn defect_drafts_have_server_owned_status_lifecycle() {
    let conn = connection();
    let scenario_id = create_scenario(&conn, "owner-a");
    let run = create_queued_run(&conn, "owner-a", scenario_id.clone(), None);
    let draft = testing::save_defect_draft_record(
        &conn,
        "owner-a",
        &SaveDefectDraftInput {
            status: "closed".to_string(),
            ..defect_input(scenario_id, run.id)
        },
    )
    .unwrap();
    assert_eq!(draft.status, "pending_confirmation");
    assert!(testing::update_defect_draft_status_record(
        &conn,
        "owner-a",
        &draft.id,
        "pending_validation"
    )
    .is_err());
    let fixing =
        testing::update_defect_draft_status_record(&conn, "owner-a", &draft.id, "pending_fix")
            .unwrap();
    let validating = testing::update_defect_draft_status_record(
        &conn,
        "owner-a",
        &fixing.id,
        "pending_validation",
    )
    .unwrap();
    let closed =
        testing::update_defect_draft_status_record(&conn, "owner-a", &validating.id, "closed")
            .unwrap();
    assert!(testing::update_defect_draft_status_record(
        &conn,
        "owner-a",
        &closed.id,
        "pending_fix"
    )
    .is_err());
}

#[test]
fn disabled_or_reassigned_accounts_invalidate_existing_combinations_for_runs() {
    let conn = connection();
    let employee =
        testing::create_test_account_record(&conn, "admin", &account_input("employee")).unwrap();
    let combination = testing::save_account_combination_record(
        &conn,
        "owner-a",
        &SaveAccountCombinationInput {
            id: None,
            name: "employee path".to_string(),
            employee_account_id: Some(employee.id.clone()),
            manager_account_id: None,
            hrbp_account_id: None,
        },
    )
    .unwrap();
    testing::disable_test_account_record(&conn, "admin", &employee.id).unwrap();
    assert!(testing::save_account_combination_record(
        &conn,
        "owner-a",
        &SaveAccountCombinationInput {
            id: Some(combination.id.clone()),
            name: combination.name.clone(),
            employee_account_id: Some(employee.id.clone()),
            manager_account_id: None,
            hrbp_account_id: None,
        },
    )
    .is_err());
    assert!(testing::create_workflow_run_record(
        &conn,
        "owner-a",
        &CreateWorkflowRunInput {
            scenario_id: create_scenario(&conn, "owner-a"),
            account_combination_id: Some(combination.id),
            status: "queued".to_string(),
            current_step_order: 0,
        },
    )
    .is_err());

    let active_employee =
        testing::create_test_account_record(&conn, "admin", &account_input("employee")).unwrap();
    let reassigned_combination = testing::save_account_combination_record(
        &conn,
        "owner-a",
        &SaveAccountCombinationInput {
            id: None,
            name: "reassigned path".to_string(),
            employee_account_id: Some(active_employee.id.clone()),
            manager_account_id: None,
            hrbp_account_id: None,
        },
    )
    .unwrap();
    let config = account_input("employee").login_config;
    testing::update_test_account_record(
        &conn,
        "admin",
        &UpdateTestAccountInput {
            id: active_employee.id,
            display_name: "reassigned account".to_string(),
            business_role: "manager".to_string(),
            login_mode: "automatic".to_string(),
            login_config: config,
        },
    )
    .unwrap();
    assert!(testing::save_account_combination_record(
        &conn,
        "owner-a",
        &SaveAccountCombinationInput {
            id: Some(reassigned_combination.id.clone()),
            name: reassigned_combination.name.clone(),
            employee_account_id: reassigned_combination.employee_account_id.clone(),
            manager_account_id: None,
            hrbp_account_id: None,
        },
    )
    .is_err());
    assert!(testing::create_workflow_run_record(
        &conn,
        "owner-a",
        &CreateWorkflowRunInput {
            scenario_id: create_scenario(&conn, "owner-a"),
            account_combination_id: Some(reassigned_combination.id),
            status: "queued".to_string(),
            current_step_order: 0,
        },
    )
    .is_err());
}
