//! 任务状态机：阶段、进度、日志与取消令牌。

pub mod glossary_job;
pub mod translate_job;

use std::collections::VecDeque;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::Serialize;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use crate::project::JobMeta;
use crate::settings::BackoffStrategy;
use crate::util::now_iso;

const MAX_LOGS: usize = 400;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum JobPhase {
    Idle,
    Running,
    Paused,
    Completed,
    Failed,
    Interrupted,
}

impl JobPhase {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Running => "running",
            Self::Paused => "paused",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Interrupted => "interrupted",
        }
    }

    pub fn from_str(value: &str) -> Self {
        match value {
            "running" => Self::Running,
            "paused" => Self::Paused,
            "completed" => Self::Completed,
            "failed" => Self::Failed,
            "interrupted" => Self::Interrupted,
            _ => Self::Idle,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JobKind {
    Glossary,
    Translate,
}

impl JobKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Glossary => "glossary",
            Self::Translate => "translate",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub time: String,
    pub level: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobSnapshot {
    pub kind: String,
    pub phase: JobPhase,
    pub total: usize,
    pub done: usize,
    pub failed: usize,
    pub pending: usize,
    pub running: usize,
    pub batch_total: usize,
    pub batch_done: usize,
    pub message: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub elapsed_secs: u64,
    pub logs: Vec<LogEntry>,
}

pub struct JobRuntime {
    pub phase: JobPhase,
    pub total: usize,
    pub done: usize,
    pub failed: usize,
    pub running: usize,
    pub batch_total: usize,
    pub batch_done: usize,
    pub message: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    started_instant: Option<Instant>,
    elapsed_secs: u64,
    logs: VecDeque<LogEntry>,
    pub cancel: Option<CancellationToken>,
    pub generation: u64,
}

impl JobRuntime {
    pub fn new() -> Self {
        Self {
            phase: JobPhase::Idle,
            total: 0,
            done: 0,
            failed: 0,
            running: 0,
            batch_total: 0,
            batch_done: 0,
            message: String::new(),
            started_at: None,
            finished_at: None,
            started_instant: None,
            elapsed_secs: 0,
            logs: VecDeque::new(),
            cancel: None,
            generation: 0,
        }
    }

    pub fn is_running(&self) -> bool {
        self.phase == JobPhase::Running
    }

    pub fn pending(&self) -> usize {
        self.total.saturating_sub(self.done).saturating_sub(self.failed)
    }

    pub fn snapshot(&self, kind: JobKind) -> JobSnapshot {
        let elapsed = match self.started_instant {
            Some(instant) => instant.elapsed().as_secs(),
            None => self.elapsed_secs,
        };
        JobSnapshot {
            kind: kind.as_str().to_string(),
            phase: self.phase,
            total: self.total,
            done: self.done,
            failed: self.failed,
            pending: self.pending(),
            running: self.running,
            batch_total: self.batch_total,
            batch_done: self.batch_done,
            message: self.message.clone(),
            started_at: self.started_at.clone(),
            finished_at: self.finished_at.clone(),
            elapsed_secs: elapsed,
            logs: self.logs.iter().cloned().collect(),
        }
    }

    /// 开始一轮新任务，返回本轮的取消令牌。
    pub fn begin(&mut self, total: usize, batch_total: usize, message: &str) -> CancellationToken {
        self.generation += 1;
        self.phase = JobPhase::Running;
        self.total = total;
        self.done = 0;
        self.failed = 0;
        self.running = 0;
        self.batch_total = batch_total;
        self.batch_done = 0;
        self.message = message.to_string();
        self.started_at = Some(now_iso());
        self.finished_at = None;
        self.started_instant = Some(Instant::now());
        self.elapsed_secs = 0;
        self.logs.clear();
        let token = CancellationToken::new();
        self.cancel = Some(token.clone());
        token
    }

    /// 结束任务并固化耗时。
    pub fn finish(&mut self, phase: JobPhase, message: impl Into<String>) {
        if let Some(instant) = self.started_instant.take() {
            self.elapsed_secs = instant.elapsed().as_secs();
        }
        self.phase = phase;
        self.message = message.into();
        self.finished_at = Some(now_iso());
        self.running = 0;
        self.cancel = None;
    }

    pub fn log(&mut self, level: &str, message: impl Into<String>) {
        self.logs.push_back(LogEntry {
            time: now_iso(),
            level: level.to_string(),
            message: message.into(),
        });
        while self.logs.len() > MAX_LOGS {
            self.logs.pop_front();
        }
    }

    pub fn clear_logs(&mut self) {
        self.logs.clear();
    }

    /// 从持久化的任务信息恢复界面状态：上次异常退出时标记为已中断。
    pub fn restore(&mut self, meta: &JobMeta) {
        let phase = JobPhase::from_str(&meta.phase);
        let was_running = phase == JobPhase::Running;
        self.phase = if was_running {
            JobPhase::Interrupted
        } else {
            phase
        };
        self.total = meta.total;
        self.done = meta.done;
        self.failed = meta.failed;
        self.message = if was_running {
            "上次任务未正常结束，已完成进度已保存，可继续执行".to_string()
        } else {
            meta.message.clone()
        };
        self.started_at = meta.started_at.clone();
        self.finished_at = meta.finished_at.clone();
        self.running = 0;
    }

    pub fn to_meta(&self) -> JobMeta {
        JobMeta {
            phase: self.phase.as_str().to_string(),
            total: self.total,
            done: self.done,
            failed: self.failed,
            message: self.message.clone(),
            started_at: self.started_at.clone(),
            finished_at: self.finished_at.clone(),
            updated_at: Some(now_iso()),
        }
    }
}

impl Default for JobRuntime {
    fn default() -> Self {
        Self::new()
    }
}

/// 术语收集与翻译两个独立任务的运行时容器。
pub struct JobHub {
    glossary: Arc<Mutex<JobRuntime>>,
    translate: Arc<Mutex<JobRuntime>>,
}

impl JobHub {
    pub fn new() -> Self {
        Self {
            glossary: Arc::new(Mutex::new(JobRuntime::new())),
            translate: Arc::new(Mutex::new(JobRuntime::new())),
        }
    }

    pub fn runtime(&self, kind: JobKind) -> Arc<Mutex<JobRuntime>> {
        match kind {
            JobKind::Glossary => self.glossary.clone(),
            JobKind::Translate => self.translate.clone(),
        }
    }
}

impl Default for JobHub {
    fn default() -> Self {
        Self::new()
    }
}

/// 计算重试等待时间。
pub fn backoff_delay(strategy: BackoffStrategy, base_ms: u64, attempt: usize) -> Duration {
    let base = base_ms.max(100);
    let factor = match strategy {
        BackoffStrategy::None => 0,
        BackoffStrategy::Linear => attempt.max(1) as u64,
        BackoffStrategy::Exponential => {
            let shift = attempt.saturating_sub(1).min(5) as u32;
            1u64 << shift
        }
    };
    Duration::from_millis((base.saturating_mul(factor)).min(120_000))
}
