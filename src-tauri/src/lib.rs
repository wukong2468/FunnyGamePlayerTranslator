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

use std::path::{Path, PathBuf};
use std::sync::Arc;

use tauri::Manager;

use crate::state::AppState;

/// 数据目录名（设置、工作区、最近项目等）。
const DATA_DIR_NAME: &str = "com.funnygameplayer.translator";

/// 数据目录优先放在 exe 同目录，便于绿色版整体拷贝；
/// 程序目录不可写时回退到系统数据目录，避免应用无法启动。
fn resolve_data_dir(app: &tauri::App) -> PathBuf {
    let legacy = app.path().app_data_dir().ok();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidate = dir.join(DATA_DIR_NAME);
            let fresh = !candidate.exists();
            if std::fs::create_dir_all(&candidate).is_ok() {
                // 首次切换到程序目录时，把系统数据目录里的旧数据复制过来
                if fresh {
                    if let Some(legacy) = legacy.as_deref() {
                        migrate_data_dir(legacy, &candidate);
                    }
                }
                return candidate;
            }
            eprintln!(
                "程序目录不可写，回退到系统数据目录：{}",
                candidate.display()
            );
        }
    }
    legacy.unwrap_or_else(|| std::env::temp_dir().join(DATA_DIR_NAME))
}

/// 递归复制旧数据目录（已存在的文件不覆盖）。
fn migrate_data_dir(from: &Path, to: &Path) {
    if from == to || !from.is_dir() {
        return;
    }
    let Ok(entries) = std::fs::read_dir(from) else {
        return;
    };
    for entry in entries.flatten() {
        let source = entry.path();
        let target = to.join(entry.file_name());
        if source.is_dir() {
            if std::fs::create_dir_all(&target).is_ok() {
                migrate_data_dir(&source, &target);
            }
        } else if !target.exists() {
            let _ = std::fs::copy(&source, &target);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = resolve_data_dir(app);
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
