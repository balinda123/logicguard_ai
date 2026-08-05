use crate::test_design::{
    self, CreateEnvironmentInput, CreateGenerationBatchInput, CreateRegressionConfigInput,
    CreateRequirementVersionInput, CreateReviewRecordInput, CreateTestDesignInput,
    CreateSystemWithEnvironmentInput, SaveGenerationCasesInput, UpdateDesignCaseStatusInput, UpdateEnvironmentInput,
    UpdateTestDesignInput, UpdateTestSystemInput,
};
use rusqlite::Connection;
use std::{
    path::Path,
    sync::{mpsc, Arc, Barrier},
    thread,
    time::Duration,
};
use uuid::Uuid;

fn initialize_connection(conn: &Connection) {
    conn.execute_batch(
        "PRAGMA foreign_keys=ON;
         CREATE TABLE users (
           id TEXT PRIMARY KEY,
           username TEXT NOT NULL,
           password_hash TEXT NOT NULL,
           role TEXT NOT NULL,
           disabled INTEGER NOT NULL DEFAULT 0,
           created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
         );
         INSERT INTO users(id, username, password_hash, role) VALUES
           ('owner-a', 'owner-a', 'hash', 'user'),
           ('owner-b', 'owner-b', 'hash', 'user');
         CREATE TABLE account_combinations (
           id TEXT PRIMARY KEY,
           owner_id TEXT NOT NULL REFERENCES users(id)
         );",
    )
    .unwrap();
    test_design::initialize_schema(&conn).unwrap();
}

fn connection() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    initialize_connection(&conn);
    conn
}

fn file_connection(path: &Path) -> Connection {
    let conn = Connection::open(path).unwrap();
    conn.busy_timeout(Duration::from_secs(2)).unwrap();
    conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
    conn
}

fn create_scope(conn: &Connection, system_name: &str) -> (String, String) {
    let system = test_design::create_system_record(conn, "admin", system_name).unwrap();
    let environment = test_design::create_environment_record(
        conn,
        "admin",
        &CreateEnvironmentInput {
            system_id: system.id.clone(),
            kind: "test".to_string(),
            name: "Shared test".to_string(),
            base_url: "https://test.example".to_string(),
        },
    )
    .unwrap();
    (system.id, environment.id)
}

fn create_design(
    conn: &Connection,
    owner_id: &str,
    system_id: &str,
    environment_id: &str,
    title: &str,
) -> test_design::TestDesign {
    test_design::create_test_design_record(
        conn,
        owner_id,
        &CreateTestDesignInput {
            system_id: system_id.to_string(),
            environment_id: environment_id.to_string(),
            title: title.to_string(),
            status: "draft".to_string(),
        },
    )
    .unwrap()
}

#[test]
fn creates_schema_and_two_systems() {
    let conn = connection();
    for table in [
        "systems",
        "system_environments",
        "test_designs",
        "requirement_versions",
        "generation_batches",
        "test_cases",
        "review_records",
        "regression_configs",
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

    let first = test_design::create_system_record(&conn, "admin", "Trial workflow").unwrap();
    let second = test_design::create_system_record(&conn, "admin", "Recruiting").unwrap();
    assert_ne!(first.id, second.id);
    assert_eq!(test_design::list_systems_record(&conn).unwrap().len(), 2);
}

#[test]
fn atomically_creates_system_with_first_environment() {
    let mut conn = connection();
    let created = test_design::create_system_with_environment_record(
        &mut conn,
        "admin",
        &CreateSystemWithEnvironmentInput {
            system_name: "试用期管理".to_string(),
            kind: "test".to_string(),
            environment_name: "测试环境".to_string(),
            base_url: "https://onboardingtest.oa.wanmei.net/".to_string(),
        },
    )
    .unwrap();

    assert_eq!(created.system.name, "试用期管理");
    assert_eq!(created.environment.system_id, created.system.id);
    assert_eq!(created.environment.base_url, "https://onboardingtest.oa.wanmei.net/");
}

#[test]
fn atomic_scope_creation_enforces_admin_https_and_rollback() {
    let input = CreateSystemWithEnvironmentInput {
        system_name: "Remote HTTP".to_string(),
        kind: "test".to_string(),
        environment_name: "测试环境".to_string(),
        base_url: "http://example.test".to_string(),
    };
    let mut conn = connection();
    assert_eq!(
        test_design::create_system_with_environment_record(&mut conn, "user", &input).unwrap_err(),
        "ADMIN_REQUIRED"
    );
    assert_eq!(
        test_design::create_system_with_environment_record(&mut conn, "admin", &input).unwrap_err(),
        "HTTPS_REQUIRED"
    );
    assert_eq!(test_design::list_systems_record(&conn).unwrap().len(), 0);
}

#[test]
fn generated_cases_are_persisted_and_scoped_to_their_design_version_and_batch() {
    let mut conn = connection();
    let (system_id, environment_id) = create_scope(&conn, "case persistence");
    let design = create_design(&conn, "owner-a", &system_id, &environment_id, "Design");
    let requirement = test_design::create_requirement_version_record(
        &mut conn,
        "owner-a",
        &CreateRequirementVersionInput { design_id: design.id.clone(), source_kind: "text".into(), content: "Requirement".into() },
    ).unwrap();
    let batch = test_design::create_generation_batch_record(
        &conn,
        "owner-a",
        &CreateGenerationBatchInput { design_id: design.id.clone(), requirement_version_id: requirement.id.clone(), model: "model".into(), template_id: None },
    ).unwrap();
    let saved = test_design::save_generation_cases_record(
        &mut conn,
        "owner-a",
        &SaveGenerationCasesInput {
            design_id: design.id.clone(), requirement_version_id: requirement.id,
            generation_batch_id: batch.id, cases: vec![serde_json::json!({"id":"case-1","title":"Case","status":"draft"})],
        },
    ).unwrap();
    assert_eq!(saved.len(), 1);
    let confirmed = test_design::update_design_case_status_record(
        &conn,
        "owner-a",
        &UpdateDesignCaseStatusInput { design_id: design.id, case_id: "case-1".into(), status: "confirmed".into() },
    ).unwrap();
    assert_eq!(confirmed.status, "confirmed");
}

#[test]
fn system_and_environment_configuration_requires_admin_and_supports_updates() {
    let conn = connection();
    assert_eq!(
        test_design::create_system_record(&conn, "user", "Forbidden").unwrap_err(),
        "ADMIN_REQUIRED"
    );
    let system = test_design::create_system_record(&conn, "admin", "Original").unwrap();
    let system = test_design::update_system_record(
        &conn,
        "admin",
        &UpdateTestSystemInput {
            id: system.id,
            name: "Renamed".to_string(),
        },
    )
    .unwrap();
    assert_eq!(system.name, "Renamed");

    let environment = test_design::create_environment_record(
        &conn,
        "admin",
        &CreateEnvironmentInput {
            system_id: system.id,
            kind: "local".to_string(),
            name: "Developer machine".to_string(),
            base_url: "http://127.0.0.1:5173".to_string(),
        },
    )
    .unwrap();
    let disabled = test_design::update_environment_record(
        &conn,
        "admin",
        &UpdateEnvironmentInput {
            id: environment.id,
            system_id: environment.system_id,
            kind: "test".to_string(),
            name: "Shared test".to_string(),
            base_url: "https://test.example".to_string(),
            is_enabled: false,
        },
    )
    .unwrap();
    assert_eq!(disabled.kind, "test");
    assert!(!disabled.is_enabled);
}

#[test]
fn accepts_only_local_and_test_environment_kinds() {
    let conn = connection();
    let system = test_design::create_system_record(&conn, "admin", "Trial workflow").unwrap();
    for kind in ["local", "test"] {
        test_design::create_environment_record(
            &conn,
            "admin",
            &CreateEnvironmentInput {
                system_id: system.id.clone(),
                kind: kind.to_string(),
                name: kind.to_string(),
                base_url: "https://example.test".to_string(),
            },
        )
        .unwrap();
    }
    let error = test_design::create_environment_record(
        &conn,
        "admin",
        &CreateEnvironmentInput {
            system_id: system.id,
            kind: "production".to_string(),
            name: "Production".to_string(),
            base_url: "https://prod.example".to_string(),
        },
    )
    .unwrap_err();
    assert_eq!(error, "INVALID_ENVIRONMENT_KIND");
}

#[test]
fn rejects_design_with_environment_from_another_system() {
    let conn = connection();
    let (system_a, environment_a) = create_scope(&conn, "Trial workflow");
    let (system_b, _) = create_scope(&conn, "Recruiting");
    let error = test_design::create_test_design_record(
        &conn,
        "owner-a",
        &CreateTestDesignInput {
            system_id: system_b,
            environment_id: environment_a,
            title: "Cross-system design".to_string(),
            status: "draft".to_string(),
        },
    )
    .unwrap_err();
    assert_eq!(error, "CROSS_SYSTEM_REFERENCE");
    assert!(
        test_design::list_test_designs_record(&conn, "owner-a", Some(&system_a), None)
            .unwrap()
            .is_empty()
    );
}

#[test]
fn requirement_edits_append_versions_without_overwriting_history() {
    let mut conn = connection();
    let (system_id, environment_id) = create_scope(&conn, "Trial workflow");
    let design = create_design(&conn, "owner-a", &system_id, &environment_id, "Approval");
    let first = test_design::create_requirement_version_record(
        &mut conn,
        "owner-a",
        &CreateRequirementVersionInput {
            design_id: design.id.clone(),
            source_kind: "text".to_string(),
            content: "first requirement".to_string(),
        },
    )
    .unwrap();
    let second = test_design::create_requirement_version_record(
        &mut conn,
        "owner-a",
        &CreateRequirementVersionInput {
            design_id: design.id.clone(),
            source_kind: "url".to_string(),
            content: "second requirement".to_string(),
        },
    )
    .unwrap();
    assert_eq!((first.version_no, second.version_no), (1, 2));
    let versions =
        test_design::list_requirement_versions_record(&conn, "owner-a", &design.id).unwrap();
    assert_eq!(versions.len(), 2);
    assert_eq!(versions[0].content, "second requirement");
    assert_eq!(versions[1].content, "first requirement");
}

#[test]
fn concurrent_requirement_edits_allocate_unique_contiguous_versions() {
    let path = std::env::temp_dir().join(format!("logicguard-test-design-{}.db", Uuid::new_v4()));
    let mut setup = file_connection(&path);
    initialize_connection(&setup);
    let (system_id, environment_id) = create_scope(&setup, "Trial workflow");
    let design = create_design(
        &setup,
        "owner-a",
        &system_id,
        &environment_id,
        "Concurrent edits",
    );
    test_design::create_requirement_version_record(
        &mut setup,
        "owner-a",
        &CreateRequirementVersionInput {
            design_id: design.id.clone(),
            source_kind: "text".to_string(),
            content: "version one".to_string(),
        },
    )
    .unwrap();

    let guard = file_connection(&path);
    guard.execute_batch("BEGIN").unwrap();
    guard
        .query_row("SELECT COUNT(*) FROM requirement_versions", [], |row| {
            row.get::<_, i64>(0)
        })
        .unwrap();

    let barrier = Arc::new(Barrier::new(3));
    let (sender, receiver) = mpsc::channel();
    let handles: Vec<_> = ["version two", "version three"]
        .into_iter()
        .map(|content| {
            let path = path.clone();
            let design_id = design.id.clone();
            let barrier = Arc::clone(&barrier);
            let sender = sender.clone();
            thread::spawn(move || {
                let mut conn = file_connection(&path);
                barrier.wait();
                let result = test_design::create_requirement_version_record(
                    &mut conn,
                    "owner-a",
                    &CreateRequirementVersionInput {
                        design_id,
                        source_kind: "text".to_string(),
                        content: content.to_string(),
                    },
                );
                sender.send(result).unwrap();
            })
        })
        .collect();
    drop(sender);

    barrier.wait();
    thread::sleep(Duration::from_millis(200));
    guard.execute_batch("COMMIT").unwrap();
    let mut created = (0..2)
        .map(|_| {
            receiver
                .recv_timeout(Duration::from_secs(5))
                .unwrap()
                .unwrap()
                .version_no
        })
        .collect::<Vec<_>>();
    for handle in handles {
        handle.join().unwrap();
    }
    created.sort_unstable();
    assert_eq!(created, vec![2, 3]);
    let versions =
        test_design::list_requirement_versions_record(&setup, "owner-a", &design.id).unwrap();
    assert_eq!(
        versions
            .iter()
            .map(|version| version.version_no)
            .collect::<Vec<_>>(),
        vec![3, 2, 1]
    );

    drop(guard);
    drop(setup);
    std::fs::remove_file(path).unwrap();
}

#[test]
fn maps_expired_sqlite_lock_wait_to_database_busy() {
    let path = std::env::temp_dir().join(format!("logicguard-test-design-{}.db", Uuid::new_v4()));
    let setup = file_connection(&path);
    initialize_connection(&setup);
    let (system_id, environment_id) = create_scope(&setup, "Trial workflow");
    let design = create_design(
        &setup,
        "owner-a",
        &system_id,
        &environment_id,
        "Busy database",
    );
    let blocker = file_connection(&path);
    blocker.execute_batch("BEGIN IMMEDIATE").unwrap();
    let mut contender = file_connection(&path);
    contender.busy_timeout(Duration::from_millis(25)).unwrap();

    let error = test_design::create_requirement_version_record(
        &mut contender,
        "owner-a",
        &CreateRequirementVersionInput {
            design_id: design.id,
            source_kind: "text".to_string(),
            content: "blocked edit".to_string(),
        },
    )
    .unwrap_err();
    assert_eq!(error, "DATABASE_BUSY");

    blocker.execute_batch("ROLLBACK").unwrap();
    drop(contender);
    drop(blocker);
    drop(setup);
    std::fs::remove_file(path).unwrap();
}

#[test]
fn generation_batch_requires_requirement_from_same_design_and_reports_staleness() {
    let mut conn = connection();
    let (system_id, environment_id) = create_scope(&conn, "Trial workflow");
    let first_design = create_design(&conn, "owner-a", &system_id, &environment_id, "First");
    let second_design = create_design(&conn, "owner-a", &system_id, &environment_id, "Second");
    let requirement = test_design::create_requirement_version_record(
        &mut conn,
        "owner-a",
        &CreateRequirementVersionInput {
            design_id: first_design.id.clone(),
            source_kind: "text".to_string(),
            content: "version one".to_string(),
        },
    )
    .unwrap();
    let cross_design = test_design::create_generation_batch_record(
        &mut conn,
        "owner-a",
        &CreateGenerationBatchInput {
            design_id: second_design.id,
            requirement_version_id: requirement.id.clone(),
            model: "model-a".to_string(),
            template_id: None,
        },
    )
    .unwrap_err();
    assert_eq!(cross_design, "CROSS_DESIGN_REFERENCE");

    let batch = test_design::create_generation_batch_record(
        &conn,
        "owner-a",
        &CreateGenerationBatchInput {
            design_id: first_design.id.clone(),
            requirement_version_id: requirement.id,
            model: "model-a".to_string(),
            template_id: Some("template-a".to_string()),
        },
    )
    .unwrap();
    assert!(!batch.is_stale);
    test_design::create_requirement_version_record(
        &mut conn,
        "owner-a",
        &CreateRequirementVersionInput {
            design_id: first_design.id.clone(),
            source_kind: "text".to_string(),
            content: "version two".to_string(),
        },
    )
    .unwrap();
    let batches =
        test_design::list_generation_batches_record(&conn, "owner-a", &first_design.id).unwrap();
    assert_eq!(batches.len(), 1);
    assert!(batches[0].is_stale);
}

#[test]
fn requirement_and_batch_references_hide_foreign_owner_rows() {
    let mut conn = connection();
    let (system_id, environment_id) = create_scope(&conn, "Trial workflow");
    let owner_a_first = create_design(&conn, "owner-a", &system_id, &environment_id, "A first");
    let owner_a_second = create_design(&conn, "owner-a", &system_id, &environment_id, "A second");
    let owner_b = create_design(&conn, "owner-b", &system_id, &environment_id, "B first");
    let requirement_a = test_design::create_requirement_version_record(
        &mut conn,
        "owner-a",
        &CreateRequirementVersionInput {
            design_id: owner_a_first.id.clone(),
            source_kind: "text".to_string(),
            content: "owner a".to_string(),
        },
    )
    .unwrap();
    let requirement_b = test_design::create_requirement_version_record(
        &mut conn,
        "owner-b",
        &CreateRequirementVersionInput {
            design_id: owner_b.id.clone(),
            source_kind: "text".to_string(),
            content: "owner b".to_string(),
        },
    )
    .unwrap();
    let batch_a = test_design::create_generation_batch_record(
        &conn,
        "owner-a",
        &CreateGenerationBatchInput {
            design_id: owner_a_first.id.clone(),
            requirement_version_id: requirement_a.id.clone(),
            model: "model-a".to_string(),
            template_id: None,
        },
    )
    .unwrap();
    let batch_b = test_design::create_generation_batch_record(
        &conn,
        "owner-b",
        &CreateGenerationBatchInput {
            design_id: owner_b.id,
            requirement_version_id: requirement_b.id.clone(),
            model: "model-b".to_string(),
            template_id: None,
        },
    )
    .unwrap();

    for requirement_version_id in [requirement_b.id, "missing-requirement".to_string()] {
        let error = test_design::create_generation_batch_record(
            &conn,
            "owner-a",
            &CreateGenerationBatchInput {
                design_id: owner_a_first.id.clone(),
                requirement_version_id,
                model: "model-a".to_string(),
                template_id: None,
            },
        )
        .unwrap_err();
        assert_eq!(error, "NOT_FOUND");
    }
    assert_eq!(
        test_design::create_generation_batch_record(
            &conn,
            "owner-a",
            &CreateGenerationBatchInput {
                design_id: owner_a_second.id.clone(),
                requirement_version_id: requirement_a.id,
                model: "model-a".to_string(),
                template_id: None,
            },
        )
        .unwrap_err(),
        "CROSS_DESIGN_REFERENCE"
    );

    for generation_batch_id in [batch_b.id, "missing-batch".to_string()] {
        let error = test_design::create_review_record(
            &conn,
            "owner-a",
            &CreateReviewRecordInput {
                design_id: owner_a_first.id.clone(),
                generation_batch_id,
                conclusion: "approved".to_string(),
                change_summary: String::new(),
            },
        )
        .unwrap_err();
        assert_eq!(error, "NOT_FOUND");
    }
    assert_eq!(
        test_design::create_review_record(
            &conn,
            "owner-a",
            &CreateReviewRecordInput {
                design_id: owner_a_second.id,
                generation_batch_id: batch_a.id,
                conclusion: "approved".to_string(),
                change_summary: String::new(),
            },
        )
        .unwrap_err(),
        "CROSS_DESIGN_REFERENCE"
    );
}

#[test]
fn regression_config_rejects_missing_or_foreign_account_combinations() {
    let conn = connection();
    let (system_id, environment_id) = create_scope(&conn, "Trial workflow");
    let design = create_design(&conn, "owner-a", &system_id, &environment_id, "Regression");
    conn.execute(
        "INSERT INTO account_combinations(id, owner_id) VALUES('account-a', 'owner-a')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO account_combinations(id, owner_id) VALUES('account-b', 'owner-b')",
        [],
    )
    .unwrap();

    for account_combination_id in ["missing-account", "account-b"] {
        let error = test_design::save_regression_config_record(
            &conn,
            "owner-a",
            &CreateRegressionConfigInput {
                design_id: design.id.clone(),
                suite_id: Some("legacy-suite".to_string()),
                account_combination_id: Some(account_combination_id.to_string()),
                case_ids_json: "[]".to_string(),
            },
        )
        .unwrap_err();
        assert_eq!(error, "INVALID_ACCOUNT_COMBINATION");
    }
    let saved = test_design::save_regression_config_record(
        &conn,
        "owner-a",
        &CreateRegressionConfigInput {
            design_id: design.id,
            suite_id: Some("legacy-suite".to_string()),
            account_combination_id: Some("account-a".to_string()),
            case_ids_json: "[]".to_string(),
        },
    )
    .unwrap();
    assert_eq!(saved.account_combination_id.as_deref(), Some("account-a"));
}

#[test]
fn owner_scoping_is_enforced_for_all_design_resources() {
    let mut conn = connection();
    let (system_id, environment_id) = create_scope(&conn, "Trial workflow");
    let design = create_design(
        &mut conn,
        "owner-a",
        &system_id,
        &environment_id,
        "Owned design",
    );
    let requirement = test_design::create_requirement_version_record(
        &mut conn,
        "owner-a",
        &CreateRequirementVersionInput {
            design_id: design.id.clone(),
            source_kind: "text".to_string(),
            content: "requirement".to_string(),
        },
    )
    .unwrap();
    let batch = test_design::create_generation_batch_record(
        &conn,
        "owner-a",
        &CreateGenerationBatchInput {
            design_id: design.id.clone(),
            requirement_version_id: requirement.id,
            model: "model-a".to_string(),
            template_id: None,
        },
    )
    .unwrap();
    test_design::create_review_record(
        &conn,
        "owner-a",
        &CreateReviewRecordInput {
            design_id: design.id.clone(),
            generation_batch_id: batch.id,
            conclusion: "approved".to_string(),
            change_summary: "none".to_string(),
        },
    )
    .unwrap();
    test_design::save_regression_config_record(
        &conn,
        "owner-a",
        &CreateRegressionConfigInput {
            design_id: design.id.clone(),
            suite_id: None,
            account_combination_id: None,
            case_ids_json: r#"["case-1"]"#.to_string(),
        },
    )
    .unwrap();

    assert!(
        test_design::list_test_designs_record(&conn, "owner-b", None, None)
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        test_design::update_test_design_record(
            &conn,
            "owner-b",
            &UpdateTestDesignInput {
                id: design.id.clone(),
                system_id,
                environment_id,
                title: "Hijacked".to_string(),
                status: "active".to_string(),
            },
        )
        .unwrap_err(),
        "NOT_FOUND"
    );
    assert_eq!(
        test_design::list_requirement_versions_record(&conn, "owner-b", &design.id).unwrap_err(),
        "NOT_FOUND"
    );
    assert_eq!(
        test_design::list_generation_batches_record(&conn, "owner-b", &design.id).unwrap_err(),
        "NOT_FOUND"
    );
    assert_eq!(
        test_design::list_review_records_record(&conn, "owner-b", &design.id).unwrap_err(),
        "NOT_FOUND"
    );
    assert_eq!(
        test_design::get_regression_config_record(&conn, "owner-b", &design.id).unwrap_err(),
        "NOT_FOUND"
    );
}

#[test]
fn records_serialize_with_camel_case_fields() {
    let conn = connection();
    let (system_id, environment_id) = create_scope(&conn, "Trial workflow");
    let design = create_design(
        &conn,
        "owner-a",
        &system_id,
        &environment_id,
        "Serialization",
    );
    let value = serde_json::to_value(design).unwrap();
    assert!(value.get("systemId").is_some());
    assert!(value.get("environmentId").is_some());
    assert!(value.get("currentRequirementVersionId").is_some());
    assert!(value.get("createdAt").is_some());
    assert!(value.get("updatedAt").is_some());
}
