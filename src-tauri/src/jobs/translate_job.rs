//! 翻译任务：批次切分、并发执行、失败重试、进度与持久化。

use std::collections::HashMap;
use std::sync::Arc;

use serde_json::Value;
use tokio::task::JoinSet;
use tokio_util::sync::CancellationToken;

use crate::ai::{client, prompt};
use crate::glossary::GlossaryTerm;
use crate::project::{ItemStatus, Project};
use crate::settings::{ApiSettings, GlossaryInjection, LongTextStrategy, TranslationSettings};
use crate::state::AppState;
use crate::util::{char_len, ellipsis};

use super::{backoff_delay, JobKind, JobPhase};

#[derive(Debug, Clone)]
struct Batch {
    label: String,
    /// (分组下标, 组内条目下标)
    items: Vec<(usize, usize)>,
    chars: usize,
}

/// 批次内待翻译条目的定位与原文快照。
struct Entry {
    group: usize,
    item: usize,
    text: String,
    reference: Option<String>,
}

struct BatchResult {
    done: usize,
    failed: usize,
    error: Option<String>,
}

/// 启动或继续翻译任务。
pub async fn spawn(state: Arc<AppState>, restart: bool) -> anyhow::Result<()> {
    let runtime_handle = state.job_runtime(JobKind::Translate).await;
    {
        let runtime = runtime_handle.lock().await;
        if runtime.is_running() {
            anyhow::bail!("翻译任务正在执行中，请先中断当前任务");
        }
    }

    let settings = state.settings.read().await.clone();
    settings.validate()?;
    if settings.api.base_url.trim().is_empty() || settings.api.model.trim().is_empty() {
        anyhow::bail!("请先在「全局设置 → AI 接口」中配置 API 地址与模型");
    }

    let (batches, queued_items, source_lang, target_lang, skipped) = {
        let mut guard = state.session.write().await;
        let session = guard.as_mut().ok_or_else(|| anyhow::anyhow!("尚未打开项目"))?;

        if restart {
            session.project.prepare_restart();
        } else {
            session.project.reset_failed();
        }
        let (batches, skipped_items) = build_batches(&mut session.project, &settings.translation);
        let queued = batches.iter().map(|batch| batch.items.len()).sum::<usize>();
        session.project_dirty = true;
        session.updated_at = crate::util::now_iso();
        (
            batches,
            queued,
            session.project.source_lang.clone(),
            session.project.target_lang.clone(),
            skipped_items,
        )
    };

    if batches.is_empty() {
        let message = if skipped > 0 {
            format!("没有可翻译条目，{skipped} 条超长文本已被跳过")
        } else {
            "没有需要翻译的条目，所有文本均已完成".to_string()
        };
        {
            let mut runtime = runtime_handle.lock().await;
            runtime.log("info", message.clone());
        }
        state
            .set_job_finished(JobKind::Translate, JobPhase::Completed, message)
            .await;
        return Ok(());
    }

    let batch_total = batches.len();
    let total_items = queued_items + skipped;
    let token = {
        let mut runtime = runtime_handle.lock().await;
        // 二次检查：避免并发触发时重复启动任务
        if runtime.is_running() {
            anyhow::bail!("翻译任务正在执行中，请先中断当前任务");
        }
        let token = runtime.begin(
            total_items,
            batch_total,
            &format!("准备翻译 {queued_items} 条文本（{batch_total} 个批次）"),
        );
        runtime.failed = skipped;
        runtime.log(
            "info",
            format!(
                "任务开始：{queued_items} 条待翻译，{skipped} 条超长跳过，{batch_total} 个批次，并发 {}，单批上限 {} 字 / {} 条",
                settings.translation.concurrency,
                settings.translation.max_chars_per_batch,
                settings.translation.max_items_per_batch
            ),
        );
        if skipped > 0 {
            runtime.log(
                "warn",
                format!("{skipped} 条文本超过单批上限的 6 倍，已按超长文本策略跳过"),
            );
        }
        token
    };

    let api = settings.api.clone();
    let translation = settings.translation.clone();
    tauri::async_runtime::spawn(async move {
        run(
            state,
            batches,
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

fn build_batches(project: &mut Project, settings: &TranslationSettings) -> (Vec<Batch>, usize) {
    let limit = settings.max_chars_per_batch.max(1);
    let hard_limit = limit.saturating_mul(6);
    let max_items = settings.max_items_per_batch.max(1);
    let mut batches: Vec<Batch> = Vec::new();
    let mut current: Vec<(usize, usize)> = Vec::new();
    let mut current_chars = 0usize;
    let mut current_label = String::new();
    let mut skipped = 0usize;

    for (group_index, group) in project.groups.iter_mut().enumerate() {
        let group_id = group.id.clone();
        for (item_index, item) in group.items.iter_mut().enumerate() {
            if item.status != ItemStatus::Pending {
                continue;
            }
            if !item.is_translatable() {
                item.status = ItemStatus::Done;
                continue;
            }
            let text = item.source_text();
            let size = char_len(&text);

            if size > hard_limit {
                if settings.long_text_strategy == LongTextStrategy::Skip {
                    item.mark_failed(
                        &format!(
                            "文本长度 {size} 字符，超过单批上限的 6 倍（{hard_limit}），已跳过"
                        ),
                        true,
                    );
                    skipped += 1;
                    continue;
                }
                // 单独成批，避免拖垮其他条目
                if !current.is_empty() {
                    batches.push(Batch {
                        label: std::mem::take(&mut current_label),
                        items: std::mem::take(&mut current),
                        chars: current_chars,
                    });
                    current_chars = 0;
                }
                batches.push(Batch {
                    label: format!("{group_id}#{item_index}"),
                    items: vec![(group_index, item_index)],
                    chars: size,
                });
                continue;
            }

            if !current.is_empty() && (current_chars + size > limit || current.len() >= max_items) {
                batches.push(Batch {
                    label: std::mem::take(&mut current_label),
                    items: std::mem::take(&mut current),
                    chars: current_chars,
                });
                current_chars = 0;
            }
            if current.is_empty() {
                current_label = format!("{group_id}#{item_index}");
            }
            current.push((group_index, item_index));
            current_chars += size;
        }
    }

    if !current.is_empty() {
        batches.push(Batch {
            label: current_label,
            items: current,
            chars: current_chars,
        });
    }

    (batches, skipped)
}

async fn run(
    state: Arc<AppState>,
    batches: Vec<Batch>,
    api: ApiSettings,
    settings: TranslationSettings,
    source_lang: String,
    target_lang: String,
    token: CancellationToken,
) {
    let concurrency = settings.concurrency.clamp(1, 16);
    let mut set: JoinSet<BatchResult> = JoinSet::new();
    let mut pending = batches.into_iter();
    let mut aborting = false;
    let mut aborted_by_error = false;
    let mut reported_running = usize::MAX;
    let mut last_checkpoint = std::time::Instant::now();

    loop {
        if !aborting && !token.is_cancelled() {
            while set.len() < concurrency {
                let Some(batch) = pending.next() else { break };
                let state_clone = state.clone();
                let api_clone = api.clone();
                let settings_clone = settings.clone();
                let source = source_lang.clone();
                let target = target_lang.clone();
                let token_clone = token.clone();
                set.spawn(async move {
                    execute_batch(
                        state_clone,
                        batch,
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
            let mut runtime = state.job_runtime(JobKind::Translate).await.lock_owned().await;
            runtime.running = running;
        }

        let Some(joined) = set.join_next().await else { break };

        match joined {
            Ok(result) => {
                {
                    let mut runtime = state.job_runtime(JobKind::Translate).await.lock_owned().await;
                    runtime.done += result.done;
                    runtime.failed += result.failed;
                    runtime.batch_done += 1;
                    runtime.message = format!(
                        "已完成 {}/{} 条，失败 {} 条",
                        runtime.done, runtime.total, runtime.failed
                    );
                    if let Some(error) = &result.error {
                        runtime.log("error", error.clone());
                    }
                }

                if result.error.is_some() && !settings.continue_on_batch_error {
                    aborting = true;
                    aborted_by_error = true;
                    token.cancel();
                }

                // 工作区可能包含数万条文本，按时间间隔落盘而不是按批次数量
                if last_checkpoint.elapsed().as_secs() >= 30 {
                    last_checkpoint = std::time::Instant::now();
                    state.persist_session().await;
                }
            }
            Err(err) => {
                let mut runtime = state.job_runtime(JobKind::Translate).await.lock_owned().await;
                runtime.log("error", format!("批次执行异常：{err}"));
            }
        }
    }

    let (phase, message) = {
        let mut runtime = state.job_runtime(JobKind::Translate).await.lock_owned().await;
        let cancelled = token.is_cancelled();
        let (phase, message) = if aborted_by_error {
            (
                JobPhase::Failed,
                format!(
                    "批次失败，已按设置停止任务；已完成 {} 条，失败 {} 条",
                    runtime.done, runtime.failed
                ),
            )
        } else if cancelled {
            (
                JobPhase::Paused,
                format!(
                    "任务已中断；已完成 {} 条，失败 {} 条，可继续执行",
                    runtime.done, runtime.failed
                ),
            )
        } else if runtime.failed > 0 {
            (
                JobPhase::Completed,
                format!("翻译完成，其中 {} 条失败，可继续执行重试", runtime.failed),
            )
        } else {
            (
                JobPhase::Completed,
                format!("翻译完成，共 {} 条", runtime.done),
            )
        };
        runtime.log("info", message.clone());
        (phase, message)
    };

    state
        .set_job_finished(JobKind::Translate, phase, message)
        .await;
}

async fn execute_batch(
    state: Arc<AppState>,
    batch: Batch,
    api: ApiSettings,
    settings: TranslationSettings,
    source_lang: String,
    target_lang: String,
    token: CancellationToken,
) -> BatchResult {
    if token.is_cancelled() {
        return BatchResult {
            done: 0,
            failed: 0,
            error: None,
        };
    }

    // 1. 读取批次原文，并按命中情况挑选术语
    let (entries, glossary) = {
        let guard = state.session.read().await;
        let Some(session) = guard.as_ref() else {
            return BatchResult {
                done: 0,
                failed: 0,
                error: Some("项目已关闭，批次取消".to_string()),
            };
        };
        let mut entries = Vec::with_capacity(batch.items.len());
        for (group_index, item_index) in &batch.items {
            if let Some(item) = session.project.item(*group_index, *item_index) {
                entries.push(Entry {
                    group: *group_index,
                    item: *item_index,
                    text: item.source_text(),
                    reference: item
                        .reference
                        .as_ref()
                        .map(|segments| segments.join("\n")),
                });
            }
        }
        let mut terms: Vec<GlossaryTerm> = Vec::new();
        if settings.glossary_injection != GlossaryInjection::Off {
            let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
            for entry in &entries {
                for term in session.glossary.matches_for(&entry.text) {
                    if seen.insert(term.source.clone()) {
                        terms.push(term);
                    }
                }
            }
        }
        (entries, terms)
    };

    if entries.is_empty() {
        return BatchResult {
            done: 0,
            failed: 0,
            error: None,
        };
    }

    // 2. 构建提示词
    let include_note = settings.glossary_injection == GlossaryInjection::MatchedWithNote;
    let system = prompt::translate_system(
        &source_lang,
        &target_lang,
        &glossary,
        include_note,
        &settings.system_prompt,
    );
    let prompt_items: Vec<prompt::TranslateItem<'_>> = entries
        .iter()
        .enumerate()
        .map(|(index, entry)| prompt::TranslateItem {
            id: index.to_string(),
            text: &entry.text,
            reference: entry.reference.as_deref(),
        })
        .collect();
    let user = prompt::translate_user(&prompt_items, &settings.user_prompt);

    // 3. 调用接口（带退避重试）
    {
        let mut runtime = state.job_runtime(JobKind::Translate).await.lock_owned().await;
        runtime.log(
            "info",
            format!(
                "开始批次 {}：{} 条 / {} 字，注入术语 {} 个",
                batch.label,
                entries.len(),
                batch.chars,
                glossary.len()
            ),
        );
    }

    let mut attempt = 0usize;
    let raw = loop {
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
                    let mut runtime = state.job_runtime(JobKind::Translate).await.lock_owned().await;
                    runtime.log(
                        "warn",
                        format!(
                            "批次 {} 请求失败（第 {}/{} 次重试）：{}",
                            batch.label, attempt, settings.retry_times, err.message
                        ),
                    );
                }
                let delay = backoff_delay(settings.backoff_strategy, settings.backoff_ms, attempt);
                tokio::select! {
                    _ = token.cancelled() => break Err("任务已中断".to_string()),
                    _ = tokio::time::sleep(delay) => {}
                }
            }
        }
    };

    let content = match raw {
        Ok(content) => content,
        Err(message) => {
            if token.is_cancelled() {
                return BatchResult {
                    done: 0,
                    failed: 0,
                    error: None,
                };
            }
            let reason = format!("批次 {} 失败：{}", batch.label, message);
            let failed = fail_entries(&state, &entries, &reason).await;
            return BatchResult {
                done: 0,
                failed,
                error: Some(reason),
            };
        }
    };

    // 4. 解析并校验条目对应关系
    let value = match client::extract_json(&content) {
        Ok(value) => value,
        Err(err) => {
            let reason = format!("批次 {} 返回内容无法解析：{}", batch.label, err.message);
            let failed = fail_entries(&state, &entries, &reason).await;
            return BatchResult {
                done: 0,
                failed,
                error: Some(reason),
            };
        }
    };

    let mut translations: HashMap<String, String> = HashMap::new();
    collect_translations(&value, &mut translations);

    // 5. 写回译文
    let (done, failed, total) = {
        let mut guard = state.session.write().await;
        let Some(session) = guard.as_mut() else {
            return BatchResult {
                done: 0,
                failed: 0,
                error: Some("项目已关闭，批次取消".to_string()),
            };
        };
        let mut done = 0usize;
        let mut failed = 0usize;
        for (index, entry) in entries.iter().enumerate() {
            let translation = translations.get(&index.to_string());
            match translation {
                Some(text) if !text.trim().is_empty() => {
                    if let Some(item) = session.project.item_mut(entry.group, entry.item) {
                        // 批次执行期间被人工编辑/导入的条目保持人工结果
                        if item.manual {
                            done += 1;
                        } else {
                            item.apply_model_translation(text);
                            done += 1;
                        }
                    }
                }
                _ => {
                    if let Some(item) = session.project.item_mut(entry.group, entry.item) {
                        if item.manual {
                            done += 1;
                        } else {
                            item.mark_failed("模型未返回该条目，可继续执行重试", false);
                            failed += 1;
                        }
                    }
                }
            }
        }
        session.project_dirty = true;
        (done, failed, entries.len())
    };

    {
        let mut runtime = state.job_runtime(JobKind::Translate).await.lock_owned().await;
        if done == total {
            runtime.log("info", format!("批次 {} 完成：{done} 条", batch.label));
        } else {
            runtime.log(
                "warn",
                format!(
                    "批次 {} 部分完成：成功 {done} 条，失败 {failed} 条；返回片段：{}",
                    batch.label,
                    ellipsis(&content, 60)
                ),
            );
        }
    }

    BatchResult {
        done,
        failed,
        error: None,
    }
}

async fn fail_entries(state: &Arc<AppState>, entries: &[Entry], reason: &str) -> usize {
    let mut guard = state.session.write().await;
    let Some(session) = guard.as_mut() else {
        return 0;
    };
    let mut failed = 0;
    for entry in entries {
        if let Some(item) = session.project.item_mut(entry.group, entry.item) {
            // 人工校对过的条目不因为批次失败而被覆盖状态
            if item.manual {
                continue;
            }
            item.mark_failed(reason, false);
            failed += 1;
        }
    }
    session.project_dirty = true;
    failed
}

fn collect_translations(value: &Value, output: &mut HashMap<String, String>) {
    let array = value
        .get("translations")
        .and_then(Value::as_array)
        .or_else(|| value.as_array());

    if let Some(array) = array {
        for entry in array {
            let Some(object) = entry.as_object() else {
                continue;
            };
            let id = object
                .get("id")
                .or_else(|| object.get("index"))
                .and_then(|value| {
                    value
                        .as_str()
                        .map(str::to_string)
                        .or_else(|| value.as_u64().map(|number| number.to_string()))
                });
            let text = object
                .get("translation")
                .or_else(|| object.get("text"))
                .or_else(|| object.get("target"))
                .or_else(|| object.get("content"))
                .and_then(Value::as_str);
            if let (Some(id), Some(text)) = (id, text) {
                output.entry(id).or_insert_with(|| text.to_string());
            }
        }
        return;
    }

    // 兼容 {"0": "译文", "1": "译文"} 结构
    if let Some(object) = value.as_object() {
        for (key, value) in object {
            if let Some(text) = value.as_str() {
                output.entry(key.clone()).or_insert_with(|| text.to_string());
            }
        }
    }
}
