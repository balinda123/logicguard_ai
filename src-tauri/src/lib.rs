mod llm;
mod browser;
mod reports;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
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
      reports::save_reports_to_file,
      reports::load_reports_from_file,
      // LLM 大模型相关命令
      llm::test_llm_connection,
      llm::plan_task,
      llm::generate_action,
      llm::heal_step,
      llm::generate_test_script,
      // 浏览器 CDP 控制命令
      browser::browser_get_snapshot,
      browser::browser_click,
      browser::browser_hover,
      browser::browser_type,
      browser::browser_press,
      browser::browser_navigate,
      browser::browser_assert,
      browser::browser_check_connection,
      browser::launch_chrome_cdp,
      browser::get_chrome_path,
      // Stagehand AI 智能执行命令
      browser::browser_act,
      browser::browser_observe,
      browser::browser_run_agent,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
