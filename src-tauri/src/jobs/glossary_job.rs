//! 术语收集任务：按分组并发抽取专有名词。

use std::collections::HashSet;
use std::sync::Arc;

use serde_json::Value;
use tokio::task::JoinSet;
use tokio_util::sync::CancellationToken;

use crate::ai::{client, prompt};
use crate::glossary::{GlossaryTerm, MergeOutcome};
use crate::settings::{ApiSettings, MAX_CONCURRENCY, TranslationSettings};
use crate::state::AppState;
use crate::util::{char_len, ellipsis};

use super::{backoff_delay, JobKind, JobPhase};

/// 单个分组内用于抽取术语的文本片段上限，避免超长 JSON 文本拖慢提示词。
const MAX_TEXT_CHARS: usize = 1500;

struct GroupPlan {
    id: String,
    chunks: Vec<Vec<String>>,
}

struct GroupOutcome {
    id: String,
    ok: bool,
    interrupted: bool,
    added: usize,
    updated: usize,
    chunks_done: usize,
    error: Option<String>,
}

/// 启动或继续术语收集任务。
pub async fn spawn(state: Arc<AppState>, restart: bool) -> anyhow::Result<()> {
    let runtime_handle = state.job_runtime(JobKind::Glossary).await;
    {
        let runtime = runtime_handle.lock().await;
        if runtime.is_running() {
            anyhow::bail!("术语收集任务正在执行中，请先中断当前任务");
        }
    }

    let settings = state.settings.read().await.clone();
    settings.validate()?;
    if settings.api.base_url.trim().is_empty() || settings.api.model.trim().is_empty() {
        anyhow::bail!("请先在「全局设置 → AI 接口」中配置 API 地址与模型");
    }

    let (plans, source_lang, target_lang, auto_completed, done_baseline, total_groups) = {
        let mut guard = state.session.write().await;
        let session = guard.as_mut().ok_or_else(|| anyhow::anyhow!("尚未打开项目"))?;
        if restart {
            session.progress.completed_groups.clear();
            session.progress.job = crate::project::JobMeta::default();
            session.glossary_dirty = true;
        }

        let completed: HashSet<String> =
            session.progress.completed_groups.iter().cloned().collect();
        let mut plans = Vec::new();
        let mut auto_completed = 0usize;
        // 只有包含可抽取文本的分组才计入进度，空分组单独记为“无需处理”
        let mut total_groups = 0usize;
        let mut done_baseline = 0usize;

        for group in &session.project.groups {
            let mut texts: Vec<String> = Vec::new();
            let mut seen: HashSet<String> = HashSet::new();
            for item in &group.items {
                if !item.is_translatable() {
                    continue;
                }
                let text: String = item.source_text().chars().take(MAX_TEXT_CHARS).collect();
                if text.trim().is_empty() {
                    continue;
                }
                if seen.insert(text.clone()) {
                    texts.push(text);
                }
            }
            if texts.is_empty() {
                if !completed.contains(&group.id) {
                    session.progress.completed_groups.push(group.id.clone());
                    auto_completed += 1;
                }
                continue;
            }
            total_groups += 1;
            if completed.contains(&group.id) {
                done_baseline += 1;
                continue;
            }
            let chunks = chunk_texts(
                &texts,
                settings.translation.glossary_batch_chars,
                settings.translation.glossary_batch_items,
            );
            plans.push(GroupPlan {
                id: group.id.clone(),
                chunks,
            });
        }

        if auto_completed > 0 {
            session.glossary_dirty = true;
        }
        (
            plans,
            session.project.source_lang.clone(),
            session.project.target_lang.clone(),
            auto_completed,
            done_baseline,
            total_groups,
        )
    };

    if plans.is_empty() {
        let message = "所有分组均已完成术语收集".to_string();
        {
            let mut runtime = runtime_handle.lock().await;
            runtime.total = total_groups;
            runtime.done = total_groups;
            runtime.failed = 0;
            runtime.running = 0;
            runtime.log("info", message.clone());
        }
        state
            .set_job_finished(JobKind::Glossary, JobPhase::Completed, message)
            .await;
        return Ok(());
    }

    let pending_groups = plans.len();
    let total_chunks: usize = plans.iter().map(|plan| plan.chunks.len()).sum();
    let token = {
        let mut runtime = runtime_handle.lock().await;
        // 二次检查：避免并发触发时重复启动任务
        if runtime.is_running() {
            anyhow::bail!("术语收集任务正在执行中，请先中断当前任务");
        }
        // 有历史进度时走“继续执行”：已完成的分组跳过，失败与未处理的分组重新排队
        let resume_mode = !restart && runtime.phase != JobPhase::Idle;
        let retry_groups = if resume_mode {
            runtime.failed.min(pending_groups)
        } else {
            0
        };
        let token = if resume_mode {
            runtime.resume(
                total_groups,
                done_baseline,
                // 上次失败的分组本轮会重新执行，失败计数从 0 重新累积
                0,
                total_chunks,
                &format!(
                    "继续收集 {pending_groups} 个分组（其中 {retry_groups} 个为上次失败的重试）"
                ),
            )
        } else {
            let token = runtime.begin(
                total_groups,
                total_chunks,
                &format!("准备收集 {pending_groups} 个分组的术语"),
            );
            // 没有可抽取文本的分组已经直接完成，计入已完成进度
            runtime.done = done_baseline;
            token
        };
        runtime.log(
            "info",
            format!(
                "任务开始：{pending_groups} 个分组 / {total_chunks} 个请求，并发 {}",
                settings.translation.concurrency
            ),
        );
        if resume_mode {
            runtime.log(
                "info",
                format!(
                    "继续执行：跳过 {done_baseline} 个已完成分组，重新执行 {pending_groups} 个未完成分组（其中 {retry_groups} 个上次失败）"
                ),
            );
        }
        if auto_completed > 0 {
            runtime.log(
                "info",
                format!("{auto_completed} 个分组没有可抽取的文本，已直接标记完成"),
            );
        }
        token
    };

    let api = settings.api.clone();
    let translation = settings.translation.clone();
    tauri::async_runtime::spawn(async move {
        run(
            state,
            plans,
            api,
            translation,
            source_lang,
            target_lang,
            token,
        )
        .await;
    });

    Ok(())
}

fn chunk_texts(texts: &[String], max_chars: usize, max_items: usize) -> Vec<Vec<String>> {
    // 上限由设置校验保证（100 - 100000），这里只做防御性下限
    let limit = max_chars.max(1);
    let max_items = max_items.max(1);
    let mut chunks: Vec<Vec<String>> = Vec::new();
    let mut current: Vec<String> = Vec::new();
    let mut chars = 0usize;

    for text in texts {
        let size = char_len(text);
        if !current.is_empty() && (chars + size > limit || current.len() >= max_items) {
            chunks.push(std::mem::take(&mut current));
            chars = 0;
        }
        current.push(text.clone());
        chars += size;
    }
    if !current.is_empty() {
        chunks.push(current);
    }
    chunks
}

async fn run(
    state: Arc<AppState>,
    plans: Vec<GroupPlan>,
    api: ApiSettings,
    settings: TranslationSettings,
    source_lang: String,
    target_lang: String,
    token: CancellationToken,
) {
    let concurrency = settings.concurrency.clamp(1, MAX_CONCURRENCY);
    let mut set: JoinSet<GroupOutcome> = JoinSet::new();
    let mut pending = plans.into_iter();
    let aborting = false;
    // 本轮失败的分组（失败计数只统计本轮，继续执行时会重新排队）
    let mut failed_ids: HashSet<String> = HashSet::new();
    let mut terms_added = 0usize;
    let mut reported_running = usize::MAX;
    let mut last_checkpoint = std::time::Instant::now();

    loop {
        if !aborting && !token.is_cancelled() {
            while set.len() < concurrency {
                let Some(plan) = pending.next() else { break };
                let state_clone = state.clone();
                let api_clone = api.clone();
                let settings_clone = settings.clone();
                let source = source_lang.clone();
                let target = target_lang.clone();
                let token_clone = token.clone();
                set.spawn(async move {
                    run_group(
                        state_clone,
                        plan,
                        api_clone,
                        settings_clone,
                        source,
                        target,
                        token_clone,
                    )
                    .await
                });
            }
        }

        let running = set.len();
        if running != reported_running {
            reported_running = running;
            let mut runtime = state.job_runtime(JobKind::Glossary).await.lock_owned().await;
            runtime.running = running;
        }

        let Some(joined) = set.join_next().await else { break };
        match joined {
            Ok(outcome) => {
                terms_added += outcome.added + outcome.updated;
                // 每个分组一轮只计一次失败；继续执行时失败分组会重新排队
                let newly_failed =
                    !outcome.ok && !outcome.interrupted && failed_ids.insert(outcome.id.clone());
                {
                    let mut runtime = state.job_runtime(JobKind::Glossary).await.lock_owned().await;
                    runtime.batch_done += outcome.chunks_done;
                    if outcome.ok {
                        runtime.done += 1;
                    } else if newly_failed {
                        runtime.failed += 1;
                    }
                    runtime.message = format!(
                        "已完成 {} / {} 个分组，失败 {} 个",
                        runtime.done, runtime.total, runtime.failed
                    );
                    if let Some(error) = &outcome.error {
                        runtime.log("error", error.clone());
                    }
                }
                // 记录已完成的分组，继续执行时据此跳过
                if outcome.ok {
                    let mut guard = state.session.write().await;
                    if let Some(session) = guard.as_mut() {
                        if !session.progress.completed_groups.contains(&outcome.id) {
                            session.progress.completed_groups.push(outcome.id.clone());
                        }
                        session.glossary_dirty = true;
                    }
                }
                if last_checkpoint.elapsed().as_secs() >= 30 {
                    last_checkpoint = std::time::Instant::now();
                    state.persist_session().await;
                }
            }
            Err(err) => {
                let mut runtime = state.job_runtime(JobKind::Glossary).await.lock_owned().await;
                runtime.log("error", format!("分组任务异常：{err}"));
            }
        }
    }

    let (phase, message) = {
        let mut runtime = state.job_runtime(JobKind::Glossary).await.lock_owned().await;
        let cancelled = token.is_cancelled();
        if !cancelled {
            // 本轮已覆盖全部未完成分组，失败集合就是最终结果
            runtime.failed = failed_ids.len();
            runtime.done = runtime.total.saturating_sub(runtime.failed);
        }
        let (phase, message) = if cancelled {
            (
                JobPhase::Paused,
                format!(
                    "术语收集已中断；已完成 {} 个分组，失败 {} 个，可继续执行",
                    runtime.done, runtime.failed
                ),
            )
        } else if runtime.failed > 0 {
            (
                JobPhase::Completed,
                format!(
                    "术语收集完成，{} 个分组失败，可继续执行重试",
                    runtime.failed
                ),
            )
        } else {
            (
                JobPhase::Completed,
                format!(
                    "术语收集完成，共处理 {} 个分组，新增或补充术语 {} 个",
                    runtime.done, terms_added
                ),
            )
        };
        runtime.log("info", message.clone());
        (phase, message)
    };

    state
        .set_job_finished(JobKind::Glossary, phase, message)
        .await;
}

async fn run_group(
    state: Arc<AppState>,
    plan: GroupPlan,
    api: ApiSettings,
    settings: TranslationSettings,
    source_lang: String,
    target_lang: String,
    token: CancellationToken,
) -> GroupOutcome {
    let system = prompt::glossary_system(&source_lang, &target_lang);
    let mut added = 0usize;
    let mut updated = 0usize;
    let mut chunks_done = 0usize;

    for chunk in &plan.chunks {
        if token.is_cancelled() {
            return GroupOutcome {
                id: plan.id.clone(),
                ok: false,
                interrupted: true,
                added,
                updated,
                chunks_done,
                error: None,
            };
        }
        let user = prompt::glossary_user(&plan.id, chunk);
        let mut attempt = 0usize;
        let content = loop {
            match client::chat(&state.http, &api, &system, &user, &token).await {
                Ok(text) => break Ok(text),
                Err(err) => {
                    if token.is_cancelled() {
                        break Err("任务已中断".to_string());
                    }
                    if !err.retryable || attempt >= settings.retry_times {
                        break Err(err.message);
                    }
                    attempt += 1;
                    {
                        let mut runtime = state.job_runtime(JobKind::Glossary).await.lock_owned().await;
                        runtime.log(
                            "warn",
                            format!(
                                "分组 {} 请求失败（第 {}/{} 次重试）：{}",
                                plan.id, attempt, settings.retry_times, err.message
                            ),
                        );
                    }
                    let delay =
                        backoff_delay(settings.backoff_strategy, settings.backoff_ms, attempt);
                    tokio::select! {
                        _ = token.cancelled() => break Err("任务已中断".to_string()),
                        _ = tokio::time::sleep(delay) => {}
                    }
                }
            }
        };

        let content = match content {
            Ok(content) => content,
            Err(message) => {
                if token.is_cancelled() {
                    return GroupOutcome {
                        id: plan.id.clone(),
                        ok: false,
                        interrupted: true,
                        added,
                        updated,
                        chunks_done,
                        error: None,
                    };
                }
                return GroupOutcome {
                    id: plan.id.clone(),
                    ok: false,
                    interrupted: false,
                    added,
                    updated,
                    chunks_done,
                    error: Some(format!("分组 {} 失败：{message}", plan.id)),
                };
            }
        };

        let value = match client::extract_json(&content) {
            Ok(value) => value,
            Err(err) => {
                return GroupOutcome {
                    id: plan.id.clone(),
                    ok: false,
                    interrupted: false,
                    added,
                    updated,
                    chunks_done,
                    error: Some(format!(
                        "分组 {} 返回内容无法解析：{}；片段：{}",
                        plan.id,
                        err.message,
                        ellipsis(&content, 60)
                    )),
                };
            }
        };

        let terms = parse_terms(&value);
        let (new_added, new_updated) = merge_terms(&state, terms).await;
        added += new_added;
        updated += new_updated;
        chunks_done += 1;
    }

    {
        let mut runtime = state.job_runtime(JobKind::Glossary).await.lock_owned().await;
        runtime.log(
            "info",
            format!(
                "分组 {} 完成：新增术语 {added} 个，补充译名 {updated} 个",
                plan.id
            ),
        );
    }

    GroupOutcome {
        id: plan.id,
        ok: true,
        interrupted: false,
        added,
        updated,
        chunks_done,
        error: None,
    }
}

async fn merge_terms(state: &Arc<AppState>, terms: Vec<GlossaryTerm>) -> (usize, usize) {
    if terms.is_empty() {
        return (0, 0);
    }
    let mut guard = state.session.write().await;
    let Some(session) = guard.as_mut() else {
        return (0, 0);
    };
    let mut added = 0;
    let mut updated = 0;
    for term in terms {
        match session.glossary.merge_ai_term(&term) {
            MergeOutcome::Added => added += 1,
            MergeOutcome::Updated => updated += 1,
            MergeOutcome::Skipped => {}
        }
    }
    if added + updated > 0 {
        session.glossary_dirty = true;
    }
    (added, updated)
}

fn parse_terms(value: &Value) -> Vec<GlossaryTerm> {
    let array = value
        .get("terms")
        .and_then(Value::as_array)
        .or_else(|| value.as_array());
    let Some(array) = array else {
        return Vec::new();
    };

    let mut terms = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for entry in array {
        let Some(object) = entry.as_object() else {
            continue;
        };
        let source = pick(object, &["source", "original", "term", "src"]);
        let target = pick(object, &["target", "translation", "translated", "dst"]);
        let Some(source) = source else { continue };
        let Some(target) = target else { continue };
        let note = pick(object, &["note", "category", "type", "remark"]).unwrap_or_default();
        if !seen.insert(source.to_lowercase()) {
            continue;
        }
        terms.push(GlossaryTerm {
            source,
            target,
            note,
            manual: false,
        });
    }
    terms
}

fn pick(object: &serde_json::Map<String, Value>, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(text) = object.get(*key).and_then(Value::as_str) {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}
