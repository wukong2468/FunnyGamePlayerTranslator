//! 全局状态：设置、项目会话、最近项目、工作区持久化。

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use tokio::sync::{Mutex, RwLock};

use crate::glossary::{Glossary, GlossaryTerm, TermPage, TermQuery};
use crate::jobs::{JobHub, JobKind, JobPhase, JobRuntime, JobSnapshot};
use crate::project::{GroupOption, JobMeta, Project, ProjectCounts};
use crate::settings::{Settings, SettingsInput, SettingsView};
use crate::storage;
use crate::util::now_iso;

const PROJECT_FILE: &str = "project.json";
const GLOSSARY_FILE: &str = "glossary.json";
const PROGRESS_FILE: &str = "glossary_progress.json";
const SETTINGS_FILE: &str = "settings.json";
const RECENT_FILE: &str = "recent.json";
const MAX_RECENT: usize = 12;

/// 术语收集进度（含任务状态）。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct GlossaryProgress {
    pub completed_groups: Vec<String>,
    pub job: JobMeta,
}

/// 当前打开的项目会话。
pub struct Session {
    pub project: Project,
    pub glossary: Glossary,
    pub progress: GlossaryProgress,
    pub workspace: PathBuf,
    pub project_dirty: bool,
    pub glossary_dirty: bool,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentProject {
    pub source_path: String,
    pub file_name: String,
    pub item_count: usize,
    pub done_count: usize,
    pub glossary_count: usize,
    pub source_lang: String,
    pub target_lang: String,
    pub updated_at: String,
    pub exists: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub source_path: String,
    pub file_name: String,
    pub source_lang: String,
    pub target_lang: String,
    pub group_count: usize,
    pub item_count: usize,
    pub char_count: usize,
    pub done_count: usize,
    pub failed_count: usize,
    pub pending_count: usize,
    pub glossary_count: usize,
    pub translated_glossary_count: usize,
    pub workspace_path: String,
    pub updated_at: String,
    pub groups: Vec<GroupOption>,
    pub warnings: Vec<String>,
    pub translate_job: JobMeta,
    pub glossary_job: JobMeta,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub data_dir: String,
    pub workspace_root: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobSnapshots {
    pub glossary: JobSnapshot,
    pub translate: JobSnapshot,
}

pub struct AppState {
    pub http: reqwest::Client,
    pub data_dir: PathBuf,
    pub workspace_root: PathBuf,
    pub settings: RwLock<Settings>,
    pub recent: RwLock<Vec<RecentProject>>,
    pub session: RwLock<Option<Session>>,
    pub jobs: JobHub,
    save_lock: Mutex<()>,
}

impl AppState {
    pub fn new(data_dir: PathBuf) -> Result<Self> {
        std::fs::create_dir_all(&data_dir)
            .with_context(|| format!("创建数据目录失败：{}", data_dir.display()))?;
        let workspace_root = data_dir.join("workspaces");
        std::fs::create_dir_all(&workspace_root).ok();

        let settings_path = data_dir.join(SETTINGS_FILE);
        let settings = match storage::read_json::<Settings>(&settings_path) {
            Ok(Some(settings)) => {
                let mut settings = settings;
                // 兼容历史设置中缺失或越界的字段
                if settings.validate().is_err() {
                    let defaults = Settings::default();
                    merge_invalid_fields(&mut settings, &defaults);
                }
                settings
            }
            Ok(None) => Settings::default(),
            Err(_) => {
                // 设置文件损坏时备份并回退默认值，避免应用无法启动
                let backup = data_dir.join(format!("settings.broken-{}.json", storage::path_hash(&now_iso())));
                let _ = std::fs::rename(&settings_path, backup);
                Settings::default()
            }
        };

        let recent_path = data_dir.join(RECENT_FILE);
        let mut recent: Vec<RecentProject> = storage::read_json(&recent_path).ok().flatten().unwrap_or_default();
        for entry in &mut recent {
            entry.exists = Path::new(&entry.source_path).exists();
        }

        let http = reqwest::Client::builder()
            .user_agent("FunnyGamePlayerTranslator/1.0")
            .build()
            .context("创建 HTTP 客户端失败")?;

        Ok(Self {
            http,
            data_dir,
            workspace_root,
            settings: RwLock::new(settings),
            recent: RwLock::new(recent),
            session: RwLock::new(None),
            jobs: JobHub::new(),
            save_lock: Mutex::new(()),
        })
    }

    pub fn app_info(&self) -> AppInfo {
        AppInfo {
            version: env!("CARGO_PKG_VERSION").to_string(),
            data_dir: self.data_dir.display().to_string(),
            workspace_root: self.workspace_root.display().to_string(),
        }
    }

    pub async fn settings_view(&self) -> SettingsView {
        self.settings.read().await.view()
    }

    pub async fn save_settings(&self, input: SettingsInput) -> Result<SettingsView> {
        let view = {
            let mut settings = self.settings.write().await;
            settings.apply(input)?;
            settings.view()
        };
        self.persist_settings().await?;
        Ok(view)
    }

    pub async fn persist_settings(&self) -> Result<()> {
        let snapshot = self.settings.read().await.clone();
        let _guard = self.save_lock.lock().await;
        storage::write_json_atomic(&self.data_dir.join(SETTINGS_FILE), &snapshot, true)
    }

    pub async fn recent_projects(&self) -> Vec<RecentProject> {
        let mut recent = self.recent.write().await;
        for entry in recent.iter_mut() {
            entry.exists = Path::new(&entry.source_path).exists();
        }
        recent.clone()
    }

    pub async fn remove_recent(&self, source_path: &str) -> Result<()> {
        {
            let mut recent = self.recent.write().await;
            recent.retain(|entry| entry.source_path != source_path);
        }
        self.persist_recent().await
    }

    async fn persist_recent(&self) -> Result<()> {
        let snapshot = self.recent.read().await.clone();
        let _guard = self.save_lock.lock().await;
        storage::write_json_atomic(&self.data_dir.join(RECENT_FILE), &snapshot, true)
    }

    pub fn workspace_dir(&self, source_path: &str) -> PathBuf {
        self.workspace_root.join(storage::workspace_dir_name(source_path))
    }

    /// 打开源文件，加载或创建工作区并恢复进度。
    pub async fn open_project(self: &Arc<Self>, source_path: String) -> Result<ProjectSummary> {
        let path = PathBuf::from(&source_path);
        if !path.is_file() {
            anyhow::bail!("文件不存在或无法访问：{source_path}");
        }

        if let Some(session) = self.session.read().await.as_ref() {
            if session.project.source_path == source_path {
                return Ok(self.summary_of(
                    session,
                    vec!["该文件已在当前项目中打开，未重复加载".to_string()],
                ));
            }
        }

        // 任务执行期间切换项目会让批次写入错位的条目，必须先中断任务
        {
            let glossary_running = self
                .jobs
                .runtime(JobKind::Glossary)
                .lock_owned()
                .await
                .is_running();
            let translate_running = self
                .jobs
                .runtime(JobKind::Translate)
                .lock_owned()
                .await
                .is_running();
            if glossary_running || translate_running {
                anyhow::bail!("有任务正在执行，请先中断任务再切换项目");
            }
        }

        let read_path = path.clone();
        let text = tokio::task::spawn_blocking(move || storage::read_text(&read_path))
            .await
            .map_err(|err| anyhow::anyhow!("读取文件任务失败：{err}"))??;

        let mut warnings = Vec::new();
        let parse_path = source_path.clone();
        let mut project = tokio::task::spawn_blocking(move || Project::parse(&parse_path, &text))
            .await
            .map_err(|err| anyhow::anyhow!("解析文件任务失败：{err}"))??;

        let workspace = self.workspace_dir(&source_path);
        std::fs::create_dir_all(&workspace).ok();

        if workspace.join(PROJECT_FILE).exists() {
            match storage::read_json::<Project>(&workspace.join(PROJECT_FILE)) {
                Ok(Some(saved)) => {
                    if saved.version > crate::project::WORKSPACE_VERSION {
                        warnings.push("工作区由更新版本创建，部分字段可能无法识别".to_string());
                    }
                    project.merge_saved(&saved);
                }
                Ok(None) => {}
                Err(err) => {
                    let backup = workspace.join(format!("project.broken-{}.json", storage::path_hash(&now_iso())));
                    let _ = std::fs::rename(workspace.join(PROJECT_FILE), &backup);
                    warnings.push(format!("上次保存的项目数据损坏，已备份并重新开始：{err}"));
                }
            }
        }

        let glossary = match storage::read_json::<Glossary>(&workspace.join(GLOSSARY_FILE)) {
            Ok(Some(mut glossary)) => {
                glossary.rebuild();
                glossary
            }
            Ok(None) => Glossary::default(),
            Err(err) => {
                let backup = workspace.join(format!("glossary.broken-{}.json", storage::path_hash(&now_iso())));
                let _ = std::fs::rename(workspace.join(GLOSSARY_FILE), &backup);
                warnings.push(format!("术语表文件损坏，已备份并重新开始：{err}"));
                Glossary::default()
            }
        };

        let progress = match storage::read_json::<GlossaryProgress>(&workspace.join(PROGRESS_FILE)) {
            Ok(Some(progress)) => progress,
            Ok(None) => GlossaryProgress::default(),
            Err(_) => GlossaryProgress::default(),
        };

        // 已存在的条目数与磁盘不一致时，保守地清理无效分组记录
        let group_ids: std::collections::HashSet<&str> = project.groups.iter().map(|group| group.id.as_str()).collect();
        let completed: Vec<String> = progress
            .completed_groups
            .iter()
            .filter(|id| group_ids.contains(id.as_str()))
            .cloned()
            .collect();
        let progress = GlossaryProgress {
            completed_groups: completed,
            job: progress.job,
        };

        let project_meta = project.job.clone();
        let glossary_meta = progress.job.clone();
        let job_phase = project_meta.phase.clone();
        let session = Session {
            project,
            glossary,
            progress,
            workspace: workspace.clone(),
            project_dirty: true,
            glossary_dirty: false,
            updated_at: now_iso(),
        };

        let summary = self.summary_of(&session, warnings);
        // 切换项目前先落盘旧会话，避免未保存的修改丢失
        self.persist_session().await;
        {
            let mut guard = self.session.write().await;
            *guard = Some(session);
        }

        self.restore_job_states(&project_meta, &glossary_meta).await;

        if job_phase == "running" {
            let mut runtime = self.jobs.runtime(JobKind::Translate).lock_owned().await;
            runtime.log("warn", "检测到上次翻译任务未正常结束，已标记为已中断");
        }

        // persist_session 内部会同步并写入最近项目列表
        self.persist_session().await;
        Ok(summary)
    }

    pub async fn restore_job_states(&self, project_meta: &JobMeta, glossary_meta: &JobMeta) {
        {
            let mut runtime = self.jobs.runtime(JobKind::Translate).lock_owned().await;
            runtime.restore(project_meta);
        }
        {
            let mut runtime = self.jobs.runtime(JobKind::Glossary).lock_owned().await;
            runtime.restore(glossary_meta);
        }
    }

    pub async fn summary(&self) -> Result<ProjectSummary> {
        let guard = self.session.read().await;
        let session = guard.as_ref().ok_or_else(|| anyhow::anyhow!("尚未打开项目"))?;
        Ok(self.summary_of(session, Vec::new()))
    }

    fn summary_of(&self, session: &Session, warnings: Vec<String>) -> ProjectSummary {
        let counts: ProjectCounts = session.project.counts();
        ProjectSummary {
            source_path: session.project.source_path.clone(),
            file_name: session.project.file_name.clone(),
            source_lang: session.project.source_lang.clone(),
            target_lang: session.project.target_lang.clone(),
            group_count: counts.group_count,
            item_count: counts.item_count,
            char_count: counts.char_count,
            done_count: counts.done_count,
            failed_count: counts.failed_count,
            pending_count: counts.pending_count,
            glossary_count: session.glossary.terms.len(),
            translated_glossary_count: session.glossary.translated_count(),
            workspace_path: session.workspace.display().to_string(),
            updated_at: session.updated_at.clone(),
            groups: session.project.group_options(),
            warnings,
            translate_job: session.project.job.clone(),
            glossary_job: session.progress.job.clone(),
        }
    }

    async fn upsert_recent(&self, summary: &ProjectSummary) {
        let mut recent = self.recent.write().await;
        recent.retain(|entry| entry.source_path != summary.source_path);
        recent.insert(
            0,
            RecentProject {
                source_path: summary.source_path.clone(),
                file_name: summary.file_name.clone(),
                item_count: summary.item_count,
                done_count: summary.done_count,
                glossary_count: summary.glossary_count,
                source_lang: summary.source_lang.clone(),
                target_lang: summary.target_lang.clone(),
                updated_at: now_iso(),
                exists: Path::new(&summary.source_path).exists(),
            },
        );
        recent.truncate(MAX_RECENT);
    }

    pub async fn set_languages(&self, source_lang: String, target_lang: String) -> Result<ProjectSummary> {
        {
            let translate_running = self
                .jobs
                .runtime(JobKind::Translate)
                .lock_owned()
                .await
                .is_running();
            if translate_running {
                anyhow::bail!("翻译任务执行中，请先中断任务再修改语言");
            }
        }
        let summary = {
            let mut guard = self.session.write().await;
            let session = guard.as_mut().ok_or_else(|| anyhow::anyhow!("尚未打开项目"))?;
            if source_lang.trim().is_empty() || target_lang.trim().is_empty() {
                anyhow::bail!("语言不能为空");
            }
            session.project.source_lang = source_lang;
            session.project.target_lang = target_lang;
            session.project_dirty = true;
            self.summary_of(session, Vec::new())
        };
        self.persist_session().await;
        Ok(summary)
    }

    pub async fn save_translation(
        &self,
        group_index: usize,
        index_in_group: usize,
        text: String,
    ) -> Result<ProjectSummary> {
        let summary = {
            let mut guard = self.session.write().await;
            let session = guard.as_mut().ok_or_else(|| anyhow::anyhow!("尚未打开项目"))?;
            session
                .project
                .set_translation(group_index, index_in_group, &text)?;
            session.project_dirty = true;
            self.summary_of(session, Vec::new())
        };
        self.persist_session().await;
        Ok(summary)
    }

    pub async fn save_term(&self, term: GlossaryTerm) -> Result<(GlossaryTerm, ProjectSummary)> {
        let (saved, summary) = {
            let mut guard = self.session.write().await;
            let session = guard.as_mut().ok_or_else(|| anyhow::anyhow!("尚未打开项目"))?;
            let saved = session.glossary.save_term(term)?;
            session.glossary_dirty = true;
            (saved, self.summary_of(session, Vec::new()))
        };
        self.persist_session().await;
        Ok((saved, summary))
    }

    pub async fn delete_terms(&self, sources: Vec<String>) -> Result<ProjectSummary> {
        let summary = {
            let mut guard = self.session.write().await;
            let session = guard.as_mut().ok_or_else(|| anyhow::anyhow!("尚未打开项目"))?;
            session.glossary.delete_terms(&sources);
            session.glossary_dirty = true;
            self.summary_of(session, Vec::new())
        };
        self.persist_session().await;
        Ok(summary)
    }

    pub async fn term_page(&self, query: TermQuery) -> Result<TermPage> {
        let guard = self.session.read().await;
        let session = guard.as_ref().ok_or_else(|| anyhow::anyhow!("尚未打开项目"))?;
        Ok(session.glossary.page(&query))
    }

    /// 写入当前会话：项目、术语表与术语收集进度。
    pub async fn persist_session(&self) {
        let translate_meta = {
            let runtime = self.jobs.runtime(JobKind::Translate).lock_owned().await;
            runtime.to_meta()
        };
        let glossary_meta = {
            let runtime = self.jobs.runtime(JobKind::Glossary).lock_owned().await;
            runtime.to_meta()
        };

        // 注意：save_lock 只覆盖文件写入阶段。后续同步最近项目时还会再次申请该锁，
        // 若在持锁状态下调用 persist_recent 会自死锁（表现为打开文件后一直加载）。
        {
            let _guard = self.save_lock.lock().await;

            let snapshot = {
                let mut guard = self.session.write().await;
                let Some(session) = guard.as_mut() else {
                    return;
                };
                if !session.project_dirty && !session.glossary_dirty {
                    return;
                }
                if session.project_dirty {
                    session.project.saved_at = now_iso();
                    session.project.job = translate_meta;
                    session.updated_at = now_iso();
                }
                if session.glossary_dirty {
                    session.progress.job = glossary_meta;
                }
                let snapshot = (
                    session.project_dirty.then(|| session.project.clone()),
                    session.glossary_dirty.then(|| session.glossary.clone()),
                    session.glossary_dirty.then(|| session.progress.clone()),
                    session.workspace.clone(),
                );
                session.project_dirty = false;
                session.glossary_dirty = false;
                snapshot
            };

            let (project, glossary, progress, workspace) = snapshot;

            if let Some(project) = project {
                if let Err(err) =
                    storage::write_json_atomic(&workspace.join(PROJECT_FILE), &project, false)
                {
                    eprintln!("保存项目失败：{err}");
                    let mut guard = self.session.write().await;
                    if let Some(session) = guard.as_mut() {
                        session.project_dirty = true;
                    }
                }
            }
            if let Some(glossary) = glossary {
                if let Err(err) =
                    storage::write_json_atomic(&workspace.join(GLOSSARY_FILE), &glossary, false)
                {
                    eprintln!("保存术语表失败：{err}");
                    let mut guard = self.session.write().await;
                    if let Some(session) = guard.as_mut() {
                        session.glossary_dirty = true;
                    }
                }
            }
            if let Some(progress) = progress {
                if let Err(err) =
                    storage::write_json_atomic(&workspace.join(PROGRESS_FILE), &progress, true)
                {
                    eprintln!("保存术语收集进度失败：{err}");
                }
            }
        }

        // 同步最近项目摘要
        let summary = {
            let guard = self.session.read().await;
            guard.as_ref().map(|session| self.summary_of(session, Vec::new()))
        };
        if let Some(summary) = summary {
            self.upsert_recent(&summary).await;
            self.persist_recent().await.ok();
        }
    }

    /// 后台自动保存循环：合并短时间内的连续修改，降低写入频率。
    /// 任务运行期间由任务自身的检查点负责落盘，避免重复写入大文件。
    pub fn spawn_autosave(self: Arc<Self>) {
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_millis(2500)).await;
                let job_running = self
                    .jobs
                    .runtime(JobKind::Translate)
                    .lock_owned()
                    .await
                    .is_running()
                    || self
                        .jobs
                        .runtime(JobKind::Glossary)
                        .lock_owned()
                        .await
                        .is_running();
                if job_running {
                    continue;
                }
                let dirty = {
                    let guard = self.session.read().await;
                    guard
                        .as_ref()
                        .map(|session| session.project_dirty || session.glossary_dirty)
                        .unwrap_or(false)
                };
                if dirty {
                    self.persist_session().await;
                }
            }
        });
    }

    pub async fn stop_job(&self, kind: JobKind) -> Result<()> {
        let mut runtime = self.jobs.runtime(kind).lock_owned().await;
        if !runtime.is_running() {
            return Ok(());
        }
        if let Some(token) = runtime.cancel.clone() {
            token.cancel();
        }
        runtime.message = "正在中断，等待在途请求结束…".to_string();
        runtime.log("warn", "收到中断请求，正在取消尚未完成的请求");
        Ok(())
    }

    pub async fn snapshots(&self) -> JobSnapshots {
        let glossary = self.jobs.runtime(JobKind::Glossary).lock_owned().await.snapshot(JobKind::Glossary);
        let translate = self.jobs.runtime(JobKind::Translate).lock_owned().await.snapshot(JobKind::Translate);
        JobSnapshots { glossary, translate }
    }

    pub async fn job_runtime(&self, kind: JobKind) -> Arc<Mutex<JobRuntime>> {
        self.jobs.runtime(kind)
    }

    pub async fn mark_project_dirty(&self) {
        if let Some(session) = self.session.write().await.as_mut() {
            session.project_dirty = true;
            session.updated_at = now_iso();
        }
    }

    pub async fn mark_glossary_dirty(&self) {
        if let Some(session) = self.session.write().await.as_mut() {
            session.glossary_dirty = true;
        }
    }

    pub async fn set_job_finished(&self, kind: JobKind, phase: JobPhase, message: String) {
        {
            let mut runtime = self.jobs.runtime(kind).lock_owned().await;
            runtime.finish(phase, message);
        }
        match kind {
            JobKind::Translate => self.mark_project_dirty().await,
            JobKind::Glossary => self.mark_glossary_dirty().await,
        }
        self.persist_session().await;
    }
}

fn merge_invalid_fields(settings: &mut Settings, defaults: &Settings) {
    if settings.appearance.primary_color.is_empty() {
        settings.appearance.primary_color = defaults.appearance.primary_color.clone();
    }
    if !(12.0..=20.0).contains(&settings.appearance.font_size) {
        settings.appearance.font_size = defaults.appearance.font_size;
    }
    if settings.appearance.font_family.trim().is_empty() {
        settings.appearance.font_family = defaults.appearance.font_family.clone();
    }
    if settings.api.base_url.trim().is_empty() {
        settings.api.base_url = defaults.api.base_url.clone();
    }
    if settings.api.model.trim().is_empty() {
        settings.api.model = defaults.api.model.clone();
    }
    if !(10..=600).contains(&settings.api.timeout_secs) {
        settings.api.timeout_secs = defaults.api.timeout_secs;
    }
    if settings.translation.concurrency == 0 || settings.translation.concurrency > 16 {
        settings.translation.concurrency = defaults.translation.concurrency;
    }
    if settings.translation.max_chars_per_batch < 200 {
        settings.translation.max_chars_per_batch = defaults.translation.max_chars_per_batch;
    }
    if settings.translation.max_items_per_batch == 0 {
        settings.translation.max_items_per_batch = defaults.translation.max_items_per_batch;
    }
}
