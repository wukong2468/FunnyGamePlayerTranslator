//! FunnyGamePlayer 文本翻译工具：Tauri 后端入口。

mod ai;
mod commands;
mod glossary;
mod jobs;
mod project;
mod settings;
mod state;
mod storage;
mod util;

use std::sync::Arc;

use tauri::Manager;

use crate::state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let state = Arc::new(AppState::new(data_dir)?);
            state.clone().spawn_autosave();
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_app_info,
            commands::get_settings,
            commands::save_settings,
            commands::test_connection,
            commands::get_recent_projects,
            commands::remove_recent_project,
            commands::open_project,
            commands::get_project_summary,
            commands::set_languages,
            commands::list_items,
            commands::set_item_translation,
            commands::export_translation,
            commands::import_translations,
            commands::list_terms,
            commands::save_term,
            commands::delete_terms,
            commands::import_glossary,
            commands::export_glossary,
            commands::start_glossary_job,
            commands::start_translate_job,
            commands::stop_job,
            commands::job_snapshots,
            commands::clear_job_logs,
            commands::mask_api_key,
        ])
        .run(tauri::generate_context!())
        .expect("启动 Tauri 应用失败");
}
