//! Tauri Commands：前端与后端交互的唯一入口。

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use serde::Serialize;
use tauri::State;
use tokio_util::sync::CancellationToken;

use crate::ai::client;
use crate::glossary::{GlossaryImportReport, GlossaryTerm, TermPage, TermQuery};
use crate::jobs::{glossary_job, translate_job, JobKind};
use crate::project::{ImportReport, ItemPage, ItemQuery};
use crate::settings::{ApiSettings, ApiSettingsInput, SettingsInput, SettingsView, mask_key};
use crate::state::{AppInfo, AppState, JobSnapshots, ProjectSummary, RecentProject};
use crate::storage;

type SharedState<'a> = State<'a, Arc<AppState>>;
type CommandResult<T> = Result<T, String>;

fn message(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestConnectionResult {
    pub ok: bool,
    pub latency_ms: u64,
    pub endpoint: String,
    pub model: String,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub path: String,
    pub item_count: usize,
    pub bytes: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TermSaveResult {
    pub term: GlossaryTerm,
    pub summary: ProjectSummary,
}

#[tauri::command]
pub fn get_app_info(state: SharedState<'_>) -> AppInfo {
    state.app_info()
}

#[tauri::command]
pub async fn get_settings(state: SharedState<'_>) -> CommandResult<SettingsView> {
    Ok(state.settings_view().await)
}

#[tauri::command]
pub async fn save_settings(
    state: SharedState<'_>,
    input: SettingsInput,
) -> CommandResult<SettingsView> {
    state.save_settings(input).await.map_err(message)
}

#[tauri::command]
pub async fn test_connection(
    state: SharedState<'_>,
    input: ApiSettingsInput,
) -> CommandResult<TestConnectionResult> {
    let current = state.settings.read().await.api.clone();
    let api = ApiSettings {
        base_url: input.base_url.trim().to_string(),
        api_key: match (input.clear_api_key, input.api_key) {
            (true, _) => String::new(),
            (false, Some(key)) if !key.trim().is_empty() => key.trim().to_string(),
            _ => current.api_key.clone(),
        },
        model: input.model.trim().to_string(),
        temperature: input.temperature,
        timeout_secs: input.timeout_secs.clamp(10, 600),
        json_mode: input.json_mode,
    };

    if api.base_url.is_empty() || api.model.is_empty() {
        return Ok(TestConnectionResult {
            ok: false,
            latency_ms: 0,
            endpoint: client::endpoint(&api.base_url),
            model: api.model.clone(),
            message: "请先填写 API 地址与模型名称".to_string(),
        });
    }
    if api.base_url.parse::<reqwest::Url>().is_err() {
        return Ok(TestConnectionResult {
            ok: false,
            latency_ms: 0,
            endpoint: api.base_url.clone(),
            model: api.model.clone(),
            message: "API 地址格式无效".to_string(),
        });
    }

    let started = Instant::now();
    let token = CancellationToken::new();
    let system = "你是接口连通性测试助手。";
    let user = "请只回复两个字符：OK";
    let outcome = client::chat(&state.http, &api, system, user, &token).await;
    let latency_ms = started.elapsed().as_millis() as u64;

    Ok(match outcome {
        Ok(content) => TestConnectionResult {
            ok: true,
            latency_ms,
            endpoint: client::endpoint(&api.base_url),
            model: api.model.clone(),
            message: format!(
                "连接成功，模型返回：{}",
                content.chars().take(80).collect::<String>()
            ),
        },
        Err(error) => TestConnectionResult {
            ok: false,
            latency_ms,
            endpoint: client::endpoint(&api.base_url),
            model: api.model.clone(),
            message: if api.api_key.is_empty() && !error.message.contains("401") {
                format!("{}（当前未配置 API Key，部分服务需要密钥）", error.message)
            } else {
                error.message
            },
        },
    })
}

#[tauri::command]
pub async fn get_recent_projects(state: SharedState<'_>) -> CommandResult<Vec<RecentProject>> {
    Ok(state.recent_projects().await)
}

#[tauri::command]
pub async fn remove_recent_project(
    state: SharedState<'_>,
    source_path: String,
) -> CommandResult<()> {
    state.remove_recent(&source_path).await.map_err(message)
}

#[tauri::command]
pub async fn open_project(
    state: SharedState<'_>,
    source_path: String,
) -> CommandResult<ProjectSummary> {
    let state = state.inner().clone();
    state.open_project(source_path).await.map_err(message)
}

#[tauri::command]
pub async fn get_project_summary(state: SharedState<'_>) -> CommandResult<ProjectSummary> {
    state.summary().await.map_err(message)
}

#[tauri::command]
pub async fn set_languages(
    state: SharedState<'_>,
    source_lang: String,
    target_lang: String,
) -> CommandResult<ProjectSummary> {
    state
        .set_languages(source_lang, target_lang)
        .await
        .map_err(message)
}

#[tauri::command]
pub async fn list_items(state: SharedState<'_>, query: ItemQuery) -> CommandResult<ItemPage> {
    let guard = state.session.read().await;
    let session = guard
        .as_ref()
        .ok_or_else(|| "尚未打开项目".to_string())?;
    Ok(session.project.items_page(&query))
}

#[tauri::command]
pub async fn set_item_translation(
    state: SharedState<'_>,
    group_index: usize,
    index_in_group: usize,
    translation: String,
) -> CommandResult<ProjectSummary> {
    state
        .save_translation(group_index, index_in_group, translation)
        .await
        .map_err(message)
}

#[tauri::command]
pub async fn export_translation(
    state: SharedState<'_>,
    dest_path: String,
) -> CommandResult<ExportResult> {
    state.persist_session().await;
    let (bytes, item_count) = {
        let guard = state.session.read().await;
        let session = guard
            .as_ref()
            .ok_or_else(|| "尚未打开项目".to_string())?;
        let value = session.project.export_value();
        let bytes = serde_json::to_vec(&value).map_err(|err| format!("生成译文 JSON 失败：{err}"))?;
        (bytes, session.project.counts().item_count)
    };
    let path = PathBuf::from(&dest_path);
    storage::write_bytes_atomic(&path, &bytes).map_err(message)?;
    Ok(ExportResult {
        path: dest_path,
        item_count,
        bytes: bytes.len(),
    })
}

#[tauri::command]
pub async fn import_translations(
    state: SharedState<'_>,
    path: String,
) -> CommandResult<ImportReport> {
    let text = storage::read_text(&PathBuf::from(&path)).map_err(message)?;
    let report = {
        let mut guard = state.session.write().await;
        let session = guard
            .as_mut()
            .ok_or_else(|| "尚未打开项目".to_string())?;
        let report = session
            .project
            .import_translations(&text)
            .map_err(message)?;
        session.project_dirty = true;
        session.updated_at = crate::util::now_iso();
        report
    };
    state.persist_session().await;
    Ok(report)
}

#[tauri::command]
pub async fn list_terms(state: SharedState<'_>, query: TermQuery) -> CommandResult<TermPage> {
    state.term_page(query).await.map_err(message)
}

#[tauri::command]
pub async fn save_term(
    state: SharedState<'_>,
    term: GlossaryTerm,
) -> CommandResult<TermSaveResult> {
    let (term, summary) = state.save_term(term).await.map_err(message)?;
    Ok(TermSaveResult { term, summary })
}

#[tauri::command]
pub async fn delete_terms(
    state: SharedState<'_>,
    sources: Vec<String>,
) -> CommandResult<ProjectSummary> {
    state.delete_terms(sources).await.map_err(message)
}

#[tauri::command]
pub async fn import_glossary(
    state: SharedState<'_>,
    path: String,
    mode: String,
) -> CommandResult<GlossaryImportReport> {
    let report = {
        let mut guard = state.session.write().await;
        let session = guard
            .as_mut()
            .ok_or_else(|| "尚未打开项目".to_string())?;
        let report = session
            .glossary
            .import_file(&PathBuf::from(&path), &mode)
            .map_err(message)?;
        session.glossary_dirty = true;
        report
    };
    state.persist_session().await;
    Ok(report)
}

#[tauri::command]
pub async fn export_glossary(
    state: SharedState<'_>,
    dest_path: String,
) -> CommandResult<String> {
    let guard = state.session.read().await;
    let session = guard
        .as_ref()
        .ok_or_else(|| "尚未打开项目".to_string())?;
    session
        .glossary
        .export_file(&PathBuf::from(&dest_path))
        .map_err(message)?;
    Ok(dest_path)
}

#[tauri::command]
pub async fn start_glossary_job(state: SharedState<'_>, restart: bool) -> CommandResult<()> {
    let state = state.inner().clone();
    glossary_job::spawn(state, restart).await.map_err(message)
}

#[tauri::command]
pub async fn start_translate_job(state: SharedState<'_>, restart: bool) -> CommandResult<()> {
    let state = state.inner().clone();
    translate_job::spawn(state, restart).await.map_err(message)
}

#[tauri::command]
pub async fn stop_job(state: SharedState<'_>, kind: String) -> CommandResult<()> {
    let kind = parse_kind(&kind)?;
    state.stop_job(kind).await.map_err(message)
}

#[tauri::command]
pub async fn job_snapshots(state: SharedState<'_>) -> CommandResult<JobSnapshots> {
    Ok(state.snapshots().await)
}

#[tauri::command]
pub async fn clear_job_logs(state: SharedState<'_>, kind: String) -> CommandResult<()> {
    let kind = parse_kind(&kind)?;
    let mut runtime = state.job_runtime(kind).await.lock_owned().await;
    runtime.clear_logs();
    Ok(())
}

#[tauri::command]
pub fn mask_api_key(key: String) -> String {
    mask_key(&key)
}

fn parse_kind(kind: &str) -> CommandResult<JobKind> {
    match kind {
        "glossary" => Ok(JobKind::Glossary),
        "translate" => Ok(JobKind::Translate),
        other => Err(format!("未知任务类型：{other}")),
    }
}
