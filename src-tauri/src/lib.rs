mod auth;
mod browser;
mod interaction_guard;
mod legacy_migration;
mod llm;
mod run_manager;
mod storage;
mod test_design;
mod testing;

#[cfg(test)]
mod test_design_tests;

#[cfg(test)]
mod testing_tests;

#[cfg(test)]
mod interaction_guard_tests;

#[cfg(test)]
mod legacy_migration_tests;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            use tauri::Manager;
            let app_data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data_dir)?;
            app.manage(run_manager::RunManager::new(
                app.handle().clone(),
                app_data_dir.join("logicguard.db"),
            ).map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?);
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            // 本地报告文件持久化命令
            auth::auth_status,
            auth::initialize_admin,
            auth::login,
            auth::logout,
            auth::list_users,
            auth::create_user,
            auth::disable_user,
            auth::reset_user_password,
            auth::save_api_key,
            auth::credential_status,
            test_design::list_systems,
            test_design::create_system,
            test_design::create_system_with_environment,
            test_design::update_system,
            test_design::list_system_environments,
            test_design::create_system_environment,
            test_design::update_system_environment,
            test_design::list_test_designs,
            test_design::create_test_design,
            test_design::update_test_design,
            test_design::list_requirement_versions,
            test_design::create_requirement_version,
            test_design::list_generation_batches,
            test_design::create_generation_batch,
            test_design::list_design_test_cases,
            test_design::save_generation_cases,
            test_design::update_design_case_status,
            test_design::list_review_records,
            test_design::create_review,
            test_design::get_regression_config,
            test_design::save_regression_config,
            legacy_migration::import_legacy_test_data,
            testing::list_test_accounts,
            testing::create_test_account,
            testing::create_scoped_test_account,
            testing::update_test_account,
            testing::disable_test_account,
            testing::set_test_account_credential,
            testing::list_account_combinations,
            testing::save_account_combination,
            testing::save_scoped_account_combination,
            testing::delete_account_combination,
            testing::list_workflow_scenarios,
            testing::save_workflow_scenario,
            testing::save_scoped_workflow_scenario,
            testing::delete_workflow_scenario,
            testing::create_workflow_run,
            testing::create_scoped_workflow_run,
            testing::update_workflow_run,
            testing::list_workflow_runs,
            testing::append_workflow_run_event,
            testing::list_workflow_run_events,
            testing::save_failure_evidence,
            testing::list_failure_evidence,
            testing::save_defect_draft,
            testing::list_defect_drafts,
            testing::update_defect_draft_status,
            run_manager::start_run,
            run_manager::pause_run,
            run_manager::resume_run,
            run_manager::terminate_run,
            run_manager::get_run,
            run_manager::list_runs,
            run_manager::list_active_runs,
            run_manager::list_run_events,
            run_manager::focus_run_browser,
            storage::get_storage_locations,
            storage::open_app_data_dir,
            // LLM 大模型相关命令
            llm::test_llm_connection,
            llm::list_openai_compat_models,
            llm::plan_task,
            llm::generate_template,
            llm::generate_test_cases,
            llm::generate_action,
            llm::heal_step,
            llm::generate_test_script,
            // 浏览器 CDP 控制命令
            browser::browser_check_connection,
            browser::browser_check_sidecar,
            browser::launch_chrome_cdp,
            browser::get_chrome_path,
            // Stagehand AI 智能执行命令
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
