use crate::{legacy_migration, test_design};
use rusqlite::Connection;
use serde_json::json;

fn connection() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(
        "PRAGMA foreign_keys=ON;
         CREATE TABLE users (
           id TEXT PRIMARY KEY, username TEXT NOT NULL, password_hash TEXT NOT NULL,
           role TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0,
           created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
         );
         INSERT INTO users(id,username,password_hash,role) VALUES('owner-a','owner-a','hash','user');",
    )
    .unwrap();
    test_design::initialize_schema(&conn).unwrap();
    conn
}

fn payload() -> legacy_migration::LegacyMigrationPayload {
    legacy_migration::LegacyMigrationPayload {
        default_system_name: "试用期转正系统".to_string(),
        shared_test_base_url: Some("https://qa.example.test".to_string()),
        records: vec![legacy_migration::LegacyRecord {
            source_key: "case:legacy-1".to_string(),
            kind: "case".to_string(),
            login_url: None,
            data: json!({"id":"legacy-1","module":"人事核心流程","title":"旧用例","status":"confirmed"}),
        }],
    }
}

#[test]
fn legacy_import_is_idempotent_and_uses_historical_design_for_missing_requirements() {
    let mut conn = connection();
    let first = legacy_migration::import(&mut conn, "owner-a", &payload()).unwrap();
    let second = legacy_migration::import(&mut conn, "owner-a", &payload()).unwrap();
    assert_eq!(first.imported_cases, 1);
    assert!(first.verified);
    assert_eq!(second.imported_cases, 0);
    let title: String = conn.query_row("SELECT title FROM test_designs", [], |row| row.get(0)).unwrap();
    assert_eq!(title, "历史导入设计单 · 人事核心流程");
}

#[test]
fn unknown_domains_are_quarantined_without_creating_a_third_environment_kind() {
    let mut conn = connection();
    let result = legacy_migration::import(
        &mut conn,
        "owner-a",
        &legacy_migration::LegacyMigrationPayload {
            default_system_name: "试用期转正系统".to_string(),
            shared_test_base_url: Some("https://qa.example.test".to_string()),
            records: vec![legacy_migration::LegacyRecord {
                source_key: "case:unknown".to_string(),
                kind: "case".to_string(),
                login_url: Some("https://unknown.example.test/login".to_string()),
                data: json!({"id":"unknown","title":"待归类"}),
            }],
        },
    )
    .unwrap();
    assert_eq!(result.quarantined_records, 1);
    let environment_count: i64 = conn.query_row("SELECT COUNT(*) FROM system_environments", [], |row| row.get(0)).unwrap();
    assert_eq!(environment_count, 0);
}
