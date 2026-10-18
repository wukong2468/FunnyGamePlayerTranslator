//! 源文件解析、条目状态、导入导出与进度合并。

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

use crate::util::char_len;

pub type Extra = Map<String, Value>;

const KNOWN_GROUP_KEYS: [&str; 3] = ["id", "translations", "items"];
const KNOWN_ITEM_KEYS: [&str; 6] = [
    "original",
    "original_sequence",
    "translation_sequence",
    "status",
    "error",
    "reference",
];

/// 单条文本的翻译状态。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ItemStatus {
    Pending,
    Done,
    Failed,
    /// 原文没有可翻译的文字（纯数字、符号或空条目），不计入翻译进度。
    Skipped,
}

impl Default for ItemStatus {
    fn default() -> Self {
        Self::Pending
    }
}

/// 扁平化的文本条目。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextItem {
    #[serde(default)]
    pub original: String,
    #[serde(default)]
    pub source_segments: Vec<String>,
    #[serde(default)]
    pub target_segments: Vec<String>,
    #[serde(default)]
    pub status: ItemStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// 「从头执行」时保留的旧译文，仅作为模型参考。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reference: Option<Vec<String>>,
    /// 因超长被跳过的条目。
    #[serde(default, skip_serializing_if = "is_false")]
    pub skipped: bool,
    /// 人工编辑或导入的译文，AI 结果不得覆盖。
    #[serde(default, skip_serializing_if = "is_false")]
    pub manual: bool,
    /// 源文件中未识别的字段，导出时原样保留。
    #[serde(flatten)]
    pub extra: Extra,
}

impl Default for TextItem {
    fn default() -> Self {
        Self {
            original: String::new(),
            source_segments: Vec::new(),
            target_segments: Vec::new(),
            status: ItemStatus::Pending,
            error: None,
            reference: None,
            skipped: false,
            manual: false,
            extra: Extra::new(),
        }
    }
}

impl TextItem {
    /// 完整原文（多段原文以换行拼接）。
    pub fn source_text(&self) -> String {
        if self.source_segments.is_empty() {
            return self.original.clone();
        }
        self.source_segments.join("\n")
    }

    /// 完整译文。
    pub fn translation_text(&self) -> String {
        self.target_segments.join("\n")
    }

    pub fn char_count(&self) -> usize {
        if self.original.is_empty() {
            char_len(&self.source_text())
        } else {
            char_len(&self.original)
        }
    }

    /// 是否可以跳过（原文没有需要翻译的内容）。
    pub fn is_translatable(&self) -> bool {
        self.source_segments
            .iter()
            .any(|segment| segment.chars().any(char::is_alphabetic))
    }

    /// 写入译文并同步状态。
    pub fn set_translation(&mut self, text: &str) {
        let trimmed = text.trim_end();
        let segments: Vec<String> = if self.source_segments.len() <= 1 {
            vec![trimmed.to_string()]
        } else {
            let parts: Vec<String> = trimmed.split('\n').map(|part| part.to_string()).collect();
            if parts.len() == self.source_segments.len() {
                parts
            } else {
                // 分段数量无法对应时整体写入首段，其余留空，保证结构长度不变
                let mut result = vec![String::new(); self.source_segments.len()];
                if let Some(first) = result.first_mut() {
                    *first = trimmed.to_string();
                }
                result
            }
        };
        self.status = if trimmed.trim().is_empty() {
            ItemStatus::Pending
        } else {
            ItemStatus::Done
        };
        self.target_segments = segments;
        self.error = None;
        self.skipped = false;
        self.reference = None;
        // 人工填写的译文会受到保护，后续 AI 批次不得覆盖
        self.manual = self.status != ItemStatus::Pending;
    }

    /// 导入的译文视为人工校对结果，同样不被 AI 覆盖。
    pub fn apply_imported_translation(&mut self, text: &str) {
        self.apply_model_translation(text);
        self.manual = true;
    }

    /// 把模型返回的译文按原分段数量切分，尽量保持与原文对齐。
    pub fn apply_model_translation(&mut self, text: &str) {
        let cleaned = text.trim_matches(['\n', '\r']);
        let source_len = self.source_segments.len().max(1);
        let segments = if source_len == 1 {
            vec![cleaned.to_string()]
        } else {
            let parts: Vec<String> = cleaned
                .split('\n')
                .map(|part| part.trim_end_matches('\r').to_string())
                .collect();
            if parts.len() == source_len {
                parts
            } else {
                let mut result = vec![String::new(); source_len];
                if let Some(first) = result.first_mut() {
                    *first = cleaned.to_string();
                }
                result
            }
        };
        self.target_segments = segments;
        self.status = ItemStatus::Done;
        self.error = None;
        self.skipped = false;
        self.reference = None;
        self.manual = false;
    }

    pub fn mark_failed(&mut self, reason: &str, skipped: bool) {
        self.status = ItemStatus::Failed;
        self.error = Some(reason.to_string());
        self.skipped = skipped;
    }
}

/// 一个原始文本分组，对应源文件中的 `translations` 数组。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub id: String,
    #[serde(default)]
    pub items: Vec<TextItem>,
    #[serde(flatten)]
    pub extra: Extra,
}

/// 任务状态快照（持久化到项目文件，用于重启后恢复）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct JobMeta {
    pub phase: String,
    pub total: usize,
    pub done: usize,
    pub failed: usize,
    pub message: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub updated_at: Option<String>,
}

impl Default for JobMeta {
    fn default() -> Self {
        Self {
            phase: "idle".to_string(),
            total: 0,
            done: 0,
            failed: 0,
            message: String::new(),
            started_at: None,
            finished_at: None,
            updated_at: None,
        }
    }
}

pub const WORKSPACE_VERSION: u32 = 1;

/// 项目工作区（同时也是 project.json 的存储结构）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Project {
    pub version: u32,
    pub saved_at: String,
    /// 上次加载源文件时的内容哈希，用于判断源文件是否被修改。
    pub source_hash: String,
    pub source_path: String,
    pub file_name: String,
    pub source_lang: String,
    pub target_lang: String,
    pub groups: Vec<Group>,
    pub job: JobMeta,
}

impl Default for Project {
    fn default() -> Self {
        Self {
            version: WORKSPACE_VERSION,
            saved_at: String::new(),
            source_hash: String::new(),
            source_path: String::new(),
            file_name: String::new(),
            source_lang: "ja".to_string(),
            target_lang: "zh-CN".to_string(),
            groups: Vec::new(),
            job: JobMeta::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemView {
    pub key: String,
    pub group: String,
    pub group_index: usize,
    pub index_in_group: usize,
    pub original: String,
    pub translation: String,
    pub status: ItemStatus,
    pub error: Option<String>,
    pub segment_count: usize,
    pub skipped: bool,
    pub has_reference: bool,
    pub manual: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemPage {
    pub total: usize,
    pub page: usize,
    pub page_size: usize,
    pub items: Vec<ItemView>,
    pub done: usize,
    pub failed: usize,
    pub pending: usize,
    pub skipped: usize,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ItemQuery {
    pub page: usize,
    pub page_size: usize,
    /// all | pending | done | failed
    pub status: String,
    pub group_index: Option<usize>,
    pub keyword: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupOption {
    pub index: usize,
    pub id: String,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCounts {
    pub group_count: usize,
    pub item_count: usize,
    pub char_count: usize,
    pub done_count: usize,
    pub failed_count: usize,
    pub pending_count: usize,
    /// 无需翻译（纯数字、符号或空条目）的条目数。
    pub skipped_count: usize,
}

/// 条目状态统计：只数状态，不计算字符数，适合在任务过程中频繁调用。
#[derive(Debug, Clone, Copy, Default)]
pub struct StatusCounts {
    pub total: usize,
    pub done: usize,
    pub failed: usize,
    pub skipped: usize,
}

impl StatusCounts {
    /// 需要翻译的条目数（总数去掉无需翻译的条目）。
    pub fn actionable(&self) -> usize {
        self.total.saturating_sub(self.skipped)
    }
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub total_groups: usize,
    pub matched_groups: usize,
    pub unknown_groups: usize,
    pub applied: usize,
    pub skipped: usize,
    pub mismatched: usize,
}

/// 源文件解析后的分组。
#[derive(Debug, Deserialize)]
struct RawGroup {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    translations: Option<Vec<RawTranslation>>,
    #[serde(default)]
    items: Option<Vec<RawTranslation>>,
    #[serde(flatten)]
    extra: Extra,
}

#[derive(Debug, Deserialize)]
struct RawTranslation {
    #[serde(default)]
    original: String,
    #[serde(default)]
    original_sequence: Vec<String>,
    #[serde(default)]
    translation_sequence: Vec<String>,
    #[serde(flatten)]
    extra: Extra,
}

#[derive(Debug, Deserialize)]
struct RawDocument {
    #[serde(alias = "data")]
    groups: Vec<RawGroup>,
}

impl Project {
    /// 解析 FunnyGameTranslations.json。
    pub fn parse(source_path: &str, text: &str) -> anyhow::Result<Self> {
        let trimmed = text.trim_start_matches('\u{feff}');
        let raw = parse_groups(trimmed)?;
        if raw.is_empty() {
            anyhow::bail!("文件中没有任何翻译分组");
        }

        let mut groups = Vec::with_capacity(raw.len());
        let mut item_total = 0usize;
        for (index, raw_group) in raw.into_iter().enumerate() {
            let translations = raw_group
                .translations
                .or(raw_group.items)
                .ok_or_else(|| anyhow::anyhow!("第 {} 个分组缺少 translations 数组", index + 1))?;
            let id = raw_group
                .id
                .filter(|id| !id.trim().is_empty())
                .unwrap_or_else(|| format!("group{index}"));
            let mut items = Vec::with_capacity(translations.len());
            for raw_item in translations {
                items.push(build_item(raw_item));
            }
            item_total += items.len();
            groups.push(Group {
                id,
                items,
                extra: filter_extra(raw_group.extra, &KNOWN_GROUP_KEYS),
            });
        }

        if item_total == 0 {
            anyhow::bail!("文件不包含任何文本条目");
        }

        let file_name = std::path::Path::new(source_path)
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or(source_path)
            .to_string();

        Ok(Self {
            version: WORKSPACE_VERSION,
            saved_at: String::new(),
            source_hash: String::new(),
            source_path: source_path.to_string(),
            file_name,
            source_lang: "ja".to_string(),
            target_lang: "zh-CN".to_string(),
            groups,
            job: JobMeta::default(),
        })
    }

    pub fn counts(&self) -> ProjectCounts {
        let mut counts = ProjectCounts {
            group_count: self.groups.len(),
            ..ProjectCounts::default()
        };
        for group in &self.groups {
            for item in &group.items {
                counts.item_count += 1;
                counts.char_count += item.char_count();
                match item.status {
                    ItemStatus::Done => counts.done_count += 1,
                    ItemStatus::Failed => counts.failed_count += 1,
                    ItemStatus::Pending => counts.pending_count += 1,
                    ItemStatus::Skipped => counts.skipped_count += 1,
                }
            }
        }
        counts
    }

    /// 仅统计条目状态（不计算字符数），用于任务过程中的实时进度校准。
    pub fn status_counts(&self) -> StatusCounts {
        let mut counts = StatusCounts::default();
        for group in &self.groups {
            for item in &group.items {
                counts.total += 1;
                match item.status {
                    ItemStatus::Done => counts.done += 1,
                    ItemStatus::Failed => counts.failed += 1,
                    ItemStatus::Pending => {}
                    ItemStatus::Skipped => counts.skipped += 1,
                }
            }
        }
        counts
    }

    pub fn group_options(&self) -> Vec<GroupOption> {
        self.groups
            .iter()
            .enumerate()
            .map(|(index, group)| GroupOption {
                index,
                id: group.id.clone(),
                count: group.items.len(),
            })
            .collect()
    }

    pub fn item(&self, group_index: usize, index_in_group: usize) -> Option<&TextItem> {
        self.groups.get(group_index)?.items.get(index_in_group)
    }

    pub fn item_mut(&mut self, group_index: usize, index_in_group: usize) -> Option<&mut TextItem> {
        self.groups.get_mut(group_index)?.items.get_mut(index_in_group)
    }

    /// 分页查询条目。
    pub fn items_page(&self, query: &ItemQuery) -> ItemPage {
        let keyword = query.keyword.trim().to_lowercase();
        let status = query.status.as_str();
        let counts = self.counts();
        let mut matched: Vec<ItemView> = Vec::new();

        for (group_index, group) in self.groups.iter().enumerate() {
            if let Some(filter) = query.group_index {
                if filter != group_index {
                    continue;
                }
            }
            for (index_in_group, item) in group.items.iter().enumerate() {
                let status_ok = match status {
                    "pending" => item.status == ItemStatus::Pending,
                    "done" => item.status == ItemStatus::Done,
                    "failed" => item.status == ItemStatus::Failed,
                    "skipped" => item.status == ItemStatus::Skipped,
                    _ => true,
                };
                if !status_ok {
                    continue;
                }
                if !keyword.is_empty() {
                    let original = item.source_text().to_lowercase();
                    let translation = item.translation_text().to_lowercase();
                    if !original.contains(&keyword) && !translation.contains(&keyword) {
                        continue;
                    }
                }
                matched.push(ItemView {
                    key: format!("{group_index}-{index_in_group}"),
                    group: group.id.clone(),
                    group_index,
                    index_in_group,
                    original: item.source_text(),
                    translation: item.translation_text(),
                    status: item.status,
                    error: item.error.clone(),
                    segment_count: item.source_segments.len(),
                    skipped: item.skipped,
                    has_reference: item.reference.is_some(),
                    manual: item.manual,
                });
            }
        }

        let page_size = query.page_size.clamp(10, 200);
        let page = query.page.max(1);
        let start = (page - 1).saturating_mul(page_size).min(matched.len());
        let end = (start + page_size).min(matched.len());

        ItemPage {
            total: matched.len(),
            page,
            page_size,
            items: matched[start..end].to_vec(),
            done: counts.done_count,
            failed: counts.failed_count,
            pending: counts.pending_count,
            skipped: counts.skipped_count,
        }
    }

    /// 手动修改译文。
    pub fn set_translation(
        &mut self,
        group_index: usize,
        index_in_group: usize,
        text: &str,
    ) -> anyhow::Result<()> {
        let item = self
            .item_mut(group_index, index_in_group)
            .ok_or_else(|| anyhow::anyhow!("条目不存在，可能项目已重新加载"))?;
        item.set_translation(text);
        Ok(())
    }

    /// 继续执行：把失败条目重新放回待处理队列（失败计数随之清零，重新累积）。
    pub fn reset_failed(&mut self) {
        for group in &mut self.groups {
            for item in &mut group.items {
                if item.status == ItemStatus::Failed {
                    item.status = ItemStatus::Pending;
                    item.error = None;
                    item.skipped = false;
                }
            }
        }
    }

    /// 修正历史数据：无需翻译的条目统一标记为 Skipped。
    pub fn normalize_statuses(&mut self) {
        for group in &mut self.groups {
            for item in &mut group.items {
                if !item.is_translatable() && item.status != ItemStatus::Skipped {
                    item.status = ItemStatus::Skipped;
                    item.error = None;
                    item.skipped = false;
                }
            }
        }
    }

    /// 按源文件重建项目后，用上一版数据补齐译文。
    ///
    /// 规则：
    /// - 原文与上一版完全一致且已完成的条目，保留译文（人工标记一并保留）；
    /// - 失败、待处理、超长跳过的条目重置为待处理；
    /// - 源文件中已不存在的条目不会出现在新项目里，其原文与译文一并丢弃；
    /// - 术语表与术语收集进度由工作区文件保存，不受影响。
    pub fn apply_reload_from(&mut self, previous: &Project) {
        use std::collections::{HashMap, VecDeque};

        // 按原文收集上一版已完成的译文；相同原文按出现顺序依次消费
        let mut completed: HashMap<String, VecDeque<(Vec<String>, bool)>> = HashMap::new();
        for group in &previous.groups {
            for item in &group.items {
                if item.status != ItemStatus::Done {
                    continue;
                }
                let key = item.source_text();
                if key.trim().is_empty() || item.target_segments == item.source_segments {
                    continue;
                }
                completed
                    .entry(key)
                    .or_default()
                    .push_back((item.target_segments.clone(), item.manual));
            }
        }

        for group in &mut self.groups {
            for item in &mut group.items {
                item.target_segments = item.source_segments.clone();
                item.status = if item.is_translatable() {
                    ItemStatus::Pending
                } else {
                    ItemStatus::Skipped
                };
                item.error = None;
                item.reference = None;
                item.skipped = false;
                item.manual = false;

                if item.status != ItemStatus::Pending {
                    continue;
                }
                let key = item.source_text();
                if let Some(queue) = completed.get_mut(&key) {
                    if let Some((target, manual)) = queue.pop_front() {
                        // 分段数量必须与原文一致，避免结构变化导致错位
                        if target.len() == item.source_segments.len() {
                            item.target_segments = target;
                            item.status = ItemStatus::Done;
                            item.manual = manual;
                        }
                    }
                }
            }
        }
        self.job = JobMeta::default();
    }

    /// 从头执行：保留旧译文作为参考，全部重置为待处理。
    pub fn prepare_restart(&mut self) {
        for group in &mut self.groups {
            for item in &mut group.items {
                let source = item.source_text();
                let translation = item.translation_text();
                if !translation.trim().is_empty() && translation != source {
                    item.reference = Some(item.target_segments.clone());
                }
                item.target_segments = item.source_segments.clone();
                item.status = if item.is_translatable() {
                    ItemStatus::Pending
                } else {
                    ItemStatus::Skipped
                };
                item.error = None;
                item.skipped = false;
                item.manual = false;
            }
        }
    }

    /// 合并上次保存的进度：按分组 id + 组内序号匹配，且原文必须一致。
    pub fn merge_saved(&mut self, saved: &Project) {
        use std::collections::HashMap;
        let mut map: HashMap<(&str, usize), &TextItem> = HashMap::new();
        for group in &saved.groups {
            for (index, item) in group.items.iter().enumerate() {
                map.insert((group.id.as_str(), index), item);
            }
        }
        for group in &mut self.groups {
            for (index, item) in group.items.iter_mut().enumerate() {
                if let Some(old) = map.get(&(group.id.as_str(), index)) {
                    if old.source_segments == item.source_segments {
                        item.target_segments = old.target_segments.clone();
                        item.status = old.status;
                        item.error = old.error.clone();
                        item.reference = old.reference.clone();
                        item.skipped = old.skipped;
                        item.manual = old.manual;
                    }
                }
            }
        }
        self.source_lang = saved.source_lang.clone();
        self.target_lang = saved.target_lang.clone();
        self.job = saved.job.clone();
    }

    /// 导出为与源文件结构一致的 JSON。
    pub fn export_value(&self) -> Value {
        let groups: Vec<Value> = self
            .groups
            .iter()
            .map(|group| {
                let translations: Vec<Value> = group
                    .items
                    .iter()
                    .map(|item| {
                        let mut object = Map::new();
                        object.insert("original".into(), json!(item.original));
                        object.insert("original_sequence".into(), json!(item.source_segments));
                        object.insert("translation_sequence".into(), json!(item.target_segments));
                        for (key, value) in &item.extra {
                            object.entry(key.clone()).or_insert_with(|| value.clone());
                        }
                        Value::Object(object)
                    })
                    .collect();
                let mut object = Map::new();
                object.insert("id".into(), json!(group.id));
                object.insert("translations".into(), Value::Array(translations));
                for (key, value) in &group.extra {
                    object.entry(key.clone()).or_insert_with(|| value.clone());
                }
                Value::Object(object)
            })
            .collect();
        Value::Array(groups)
    }

    /// 导入译文：按分组 id 与组内序号定位，并校验原文一致性。
    pub fn import_translations(&mut self, text: &str) -> anyhow::Result<ImportReport> {
        let raw = parse_groups(text.trim_start_matches('\u{feff}'))?;
        let mut report = ImportReport {
            total_groups: raw.len(),
            ..Default::default()
        };

        // 同名分组可能出现多次，按出现顺序逐一消费，避免错位覆盖
        let mut index_by_id: std::collections::HashMap<String, Vec<usize>> = std::collections::HashMap::new();
        for (index, group) in self.groups.iter().enumerate() {
            index_by_id.entry(group.id.clone()).or_default().push(index);
        }
        let mut used: std::collections::HashMap<String, usize> = std::collections::HashMap::new();

        for raw_group in &raw {
            let id = raw_group.id.as_deref().unwrap_or_default();
            let Some(candidates) = index_by_id.get(id) else {
                report.unknown_groups += 1;
                continue;
            };
            let slot = used.entry(id.to_string()).or_insert(0);
            let Some(&group_index) = candidates.get(*slot) else {
                report.unknown_groups += 1;
                continue;
            };
            *slot += 1;
            report.matched_groups += 1;

            let Some(translations) = raw_group.translations.as_ref().or(raw_group.items.as_ref()) else {
                continue;
            };
            let group = &mut self.groups[group_index];
            for (index, incoming) in translations.iter().enumerate() {
                let Some(item) = group.items.get_mut(index) else {
                    report.skipped += 1;
                    continue;
                };
                let incoming_source = if incoming.original_sequence.is_empty() {
                    vec![incoming.original.clone()]
                } else {
                    incoming.original_sequence.clone()
                };
                if incoming.translation_sequence.is_empty() {
                    report.skipped += 1;
                    continue;
                }
                if incoming_source != item.source_segments && !incoming.original.is_empty()
                    && incoming.original != item.original
                {
                    report.mismatched += 1;
                    continue;
                }
                let translation = incoming.translation_sequence.join("\n");
                if translation.trim().is_empty() {
                    report.skipped += 1;
                    continue;
                }
                item.apply_imported_translation(&translation);
                // 与原文相同视为尚未翻译
                if item.target_segments == item.source_segments {
                    item.status = if item.is_translatable() {
                        ItemStatus::Pending
                    } else {
                        ItemStatus::Skipped
                    };
                    item.manual = false;
                }
                report.applied += 1;
            }
        }

        Ok(report)
    }
}

fn parse_groups(text: &str) -> anyhow::Result<Vec<RawGroup>> {
    match serde_json::from_str::<Vec<RawGroup>>(text) {
        Ok(groups) => Ok(groups),
        Err(array_error) => match serde_json::from_str::<RawDocument>(text) {
            Ok(document) => Ok(document.groups),
            Err(_) => Err(anyhow::anyhow!(
                "JSON 结构不符合 FunnyGameTranslations 格式：应为包含 id 与 translations 的对象数组（{array_error}）"
            )),
        },
    }
}

fn build_item(raw: RawTranslation) -> TextItem {
    let source_segments = if !raw.original_sequence.is_empty() {
        raw.original_sequence.clone()
    } else if !raw.original.is_empty() {
        vec![raw.original.clone()]
    } else {
        Vec::new()
    };

    let target_segments = if !raw.translation_sequence.is_empty() {
        if raw.translation_sequence.len() == source_segments.len() {
            raw.translation_sequence.clone()
        } else {
            let joined = raw.translation_sequence.join("\n");
            vec![joined]
        }
    } else {
        source_segments.clone()
    };

    let has_source = source_segments.iter().any(|segment| !segment.trim().is_empty());
    let translatable = source_segments
        .iter()
        .any(|segment| segment.chars().any(char::is_alphabetic));
    let translated = target_segments.iter().any(|segment| !segment.trim().is_empty())
        && target_segments != source_segments;

    TextItem {
        original: if raw.original.is_empty() {
            source_segments.join("\n")
        } else {
            raw.original.clone()
        },
        source_segments,
        target_segments,
        status: if !has_source || !translatable {
            ItemStatus::Skipped
        } else if translated {
            ItemStatus::Done
        } else {
            ItemStatus::Pending
        },
        ..TextItem::default()
    }
    .with_extra(filter_extra(raw.extra, &KNOWN_ITEM_KEYS))
}

impl TextItem {
    fn with_extra(mut self, extra: Extra) -> Self {
        self.extra = extra;
        self
    }
}

fn filter_extra(extra: Extra, known: &[&str]) -> Extra {
    extra
        .into_iter()
        .filter(|(key, _)| !known.contains(&key.as_str()))
        .collect()
}

fn is_false(value: &bool) -> bool {
    !*value
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"[
      {
        "id": "g1",
        "note": "保留未知字段",
        "translations": [
          {"original": "佐伯", "original_sequence": ["佐伯"], "translation_sequence": ["佐伯"]},
          {"original": "回復薬", "original_sequence": ["回復薬"], "translation_sequence": ["回复药"]},
          {"original": "複数", "original_sequence": ["A", "B"], "translation_sequence": ["A", "B"]}
        ]
      }
    ]"#;

    #[test]
    fn parse_and_export_preserve_structure() {
        let project = Project::parse("D:/data/FunnyGameTranslations.json", SAMPLE).unwrap();
        let counts = project.counts();
        assert_eq!(counts.group_count, 1);
        assert_eq!(counts.item_count, 3);
        assert_eq!(counts.done_count, 1);
        assert_eq!(counts.pending_count, 2);

        let value = project.export_value();
        let group = &value.as_array().unwrap()[0];
        assert_eq!(group["id"], "g1");
        assert_eq!(group["note"], "保留未知字段");
        assert_eq!(group["translations"].as_array().unwrap().len(), 3);
        assert_eq!(group["translations"][1]["translation_sequence"][0], "回复药");
    }

    #[test]
    fn items_without_letters_are_skipped() {
        let sample = r#"[
          {"id": "g1", "translations": [
            {"original": "1234", "original_sequence": ["1234"], "translation_sequence": ["1234"]},
            {"original": "！？", "original_sequence": ["！？"], "translation_sequence": ["！？"]},
            {"original": "佐伯", "original_sequence": ["佐伯"], "translation_sequence": ["佐伯"]}
          ]},
          {"id": "empty", "translations": []}
        ]"#;
        let project = Project::parse("D:/data/test.json", sample).unwrap();
        let counts = project.counts();
        assert_eq!(counts.item_count, 3);
        assert_eq!(counts.skipped_count, 2);
        assert_eq!(counts.done_count, 0);
        assert_eq!(counts.pending_count, 1);
    }

    #[test]
    fn reload_keeps_completed_translations_and_drops_missing_items() {
        // 上一版项目：三条条目，其中“回復薬”已翻译完成
        let previous = Project::parse("D:/data/FunnyGameTranslations.json", SAMPLE).unwrap();
        // 新源文件：删掉了第三条“複数”，其余原文不变
        let next = r#"[
          {"id": "g1", "translations": [
            {"original": "佐伯", "original_sequence": ["佐伯"], "translation_sequence": ["佐伯"]},
            {"original": "回復薬", "original_sequence": ["回復薬"], "translation_sequence": ["回復薬"]}
          ]}
        ]"#;
        let mut project = Project::parse("D:/data/FunnyGameTranslations.json", next).unwrap();
        project.job.phase = "running".to_string();

        project.apply_reload_from(&previous);

        assert_eq!(project.groups[0].items.len(), 2);
        // 未翻译的条目保持待处理
        assert_eq!(project.groups[0].items[0].status, ItemStatus::Pending);
        // 原文未变且已完成的条目保留译文
        let kept = &project.groups[0].items[1];
        assert_eq!(kept.status, ItemStatus::Done);
        assert_eq!(kept.translation_text(), "回复药");
        assert_eq!(project.job.phase, "idle");
    }

    #[test]
    fn import_skips_mismatched_original() {
        let mut project = Project::parse("D:/data/FunnyGameTranslations.json", SAMPLE).unwrap();
        let incoming = r#"[
          {"id": "g1", "translations": [
            {"original": "佐伯", "original_sequence": ["佐伯"], "translation_sequence": ["佐伯（译）"]},
            {"original": "别的内容", "original_sequence": ["别的内容"], "translation_sequence": ["不应写入"]}
          ]},
          {"id": "unknown", "translations": []}
        ]"#;
        let report = project.import_translations(incoming).unwrap();
        assert_eq!(report.applied, 1);
        assert_eq!(report.mismatched, 1);
        assert_eq!(report.unknown_groups, 1);
        assert_eq!(project.groups[0].items[0].translation_text(), "佐伯（译）");
        assert_eq!(project.groups[0].items[1].translation_text(), "回复药");
    }

    #[test]
    fn restart_keeps_reference_and_resets_status() {
        let mut project = Project::parse("D:/data/FunnyGameTranslations.json", SAMPLE).unwrap();
        project.prepare_restart();
        let item = &project.groups[0].items[1];
        assert_eq!(item.status, ItemStatus::Pending);
        assert_eq!(item.reference.as_ref().unwrap()[0], "回复药");
        assert_eq!(item.translation_text(), "回復薬");
    }

    #[test]
    fn manual_translation_survives_restart_flag() {
        let mut project = Project::parse("D:/data/FunnyGameTranslations.json", SAMPLE).unwrap();
        project.set_translation(0, 0, "人工译文").unwrap();
        assert!(project.groups[0].items[0].manual);
        project.prepare_restart();
        assert!(!project.groups[0].items[0].manual);
    }

    #[test]
    fn item_page_supports_status_keyword_and_pagination() {
        let mut project = Project::parse("D:/data/FunnyGameTranslations.json", SAMPLE).unwrap();
        project.set_translation(0, 2, "多段译文").unwrap();

        let done = project.items_page(&ItemQuery {
            page: 1,
            page_size: 20,
            status: "done".into(),
            group_index: None,
            keyword: String::new(),
        });
        assert_eq!(done.total, 2);
        assert_eq!(done.items.len(), 2);

        let keyword = project.items_page(&ItemQuery {
            page: 1,
            page_size: 20,
            status: "all".into(),
            group_index: None,
            keyword: "回復".into(),
        });
        assert_eq!(keyword.total, 1);
        assert_eq!(keyword.items[0].group_index, 0);

        let paged = project.items_page(&ItemQuery {
            page: 1,
            page_size: 2,
            status: "all".into(),
            group_index: None,
            keyword: String::new(),
        });
        assert_eq!(paged.total, 3);
        assert_eq!(paged.items.len(), 3);
        // 每页条数会被限制在 10..=200，避免一次渲染过多内容
        assert_eq!(paged.page_size, 10);

        let empty_page = project.items_page(&ItemQuery {
            page: 2,
            page_size: 10,
            status: "all".into(),
            group_index: None,
            keyword: String::new(),
        });
        assert!(empty_page.items.is_empty());
        assert_eq!(empty_page.page, 2);
    }

    #[test]
    #[ignore = "需要仓库外部的 FunnyGameTranslations.json"]
    fn parse_real_source_file() {
        let path = std::path::Path::new("../../FunnyGameTranslations.json");
        if !path.exists() {
            return;
        }
        let text = std::fs::read_to_string(path).unwrap();
        let project = Project::parse("FunnyGameTranslations.json", &text).unwrap();
        let counts = project.counts();
        println!("{:?}", counts);
        assert_eq!(counts.group_count, 1186);
        assert_eq!(counts.item_count, 81627);
    }
}
