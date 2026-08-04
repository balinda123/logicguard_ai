use crate::test_design::{
    self, CreateEnvironmentInput, CreateGenerationBatchInput, CreateRegressionConfigInput,
    CreateRequirementVersionInput, CreateReviewRecordInput, CreateTestDesignInput,
    UpdateEnvironmentInput, UpdateTestDesignInput, UpdateTestSystemInput,
};
use rusqlite::Connection;

fn connection() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
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
           ('owner-b', 'owner-b', 'hash', 'user');",
    )
    .unwrap();
    test_design::initialize_schema(&conn).unwrap();
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
    let conn = connection();
    let (system_id, environment_id) = create_scope(&conn, "Trial workflow");
    let design = create_design(&conn, "owner-a", &system_id, &environment_id, "Approval");
    let first = test_design::create_requirement_version_record(
        &conn,
        "owner-a",
        &CreateRequirementVersionInput {
            design_id: design.id.clone(),
            source_kind: "text".to_string(),
            content: "first requirement".to_string(),
        },
    )
    .unwrap();
    let second = test_design::create_requirement_version_record(
        &conn,
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
fn generation_batch_requires_requirement_from_same_design_and_reports_staleness() {
    let conn = connection();
    let (system_id, environment_id) = create_scope(&conn, "Trial workflow");
    let first_design = create_design(&conn, "owner-a", &system_id, &environment_id, "First");
    let second_design = create_design(&conn, "owner-a", &system_id, &environment_id, "Second");
    let requirement = test_design::create_requirement_version_record(
        &conn,
        "owner-a",
        &CreateRequirementVersionInput {
            design_id: first_design.id.clone(),
            source_kind: "text".to_string(),
            content: "version one".to_string(),
        },
    )
    .unwrap();
    let cross_design = test_design::create_generation_batch_record(
        &conn,
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
        &conn,
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
fn owner_scoping_is_enforced_for_all_design_resources() {
    let conn = connection();
    let (system_id, environment_id) = create_scope(&conn, "Trial workflow");
    let design = create_design(
        &conn,
        "owner-a",
        &system_id,
        &environment_id,
        "Owned design",
    );
    let requirement = test_design::create_requirement_version_record(
        &conn,
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
