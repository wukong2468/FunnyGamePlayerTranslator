//! 术语表：存储、去重合并、导入导出与批次注入匹配。

use std::collections::{HashMap, HashSet};
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::storage;

/// 单个术语的最大长度，过长文本不视为术语。
const MAX_TERM_CHARS: usize = 120;
/// 单次注入的最大术语数量，避免提示词膨胀。
const MAX_INJECTED_TERMS: usize = 40;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct GlossaryTerm {
    pub source: String,
    pub target: String,
    pub note: String,
    /// 人工维护（手动新增 / 编辑 / 导入）的术语不会被 AI 结果覆盖。
    pub manual: bool,
}

impl GlossaryTerm {
    /// 清洗并校验术语；原文为空时返回 `None`。
    fn normalized(&self) -> Option<GlossaryTerm> {
        let source = self.source.trim();
        if source.is_empty() || source.chars().count() > MAX_TERM_CHARS {
            return None;
        }
        Some(GlossaryTerm {
            source: source.to_string(),
            target: self.target.trim().to_string(),
            note: self.note.trim().to_string(),
            manual: self.manual,
        })
    }

    pub fn is_translated(&self) -> bool {
        !self.target.trim().is_empty()
    }
}

/// 术语合并结果，用于统计与日志。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MergeOutcome {
    Added,
    Updated,
    Skipped,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Glossary {
    pub terms: Vec<GlossaryTerm>,
    #[serde(skip)]
    index: HashMap<String, usize>,
    #[serde(skip)]
    by_char: HashMap<char, Vec<usize>>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct TermQuery {
    pub page: usize,
    pub page_size: usize,
    pub keyword: String,
    /// all | translated | untranslated | manual
    pub filter: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TermPage {
    pub total: usize,
    pub page: usize,
    pub page_size: usize,
    pub items: Vec<GlossaryTerm>,
    pub translated: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlossaryImportReport {
    pub total: usize,
    pub added: usize,
    pub updated: usize,
    pub skipped: usize,
    pub replaced: bool,
    pub conflicts: Vec<String>,
    pub terms_total: usize,
}

impl Glossary {
    pub fn rebuild(&mut self) {
        self.index.clear();
        self.by_char.clear();
        for (position, term) in self.terms.iter().enumerate() {
            let key = normalize_key(&term.source);
            if key.is_empty() {
                continue;
            }
            self.index.entry(key).or_insert(position);
            if let Some(first) = term.source.to_lowercase().chars().next() {
                self.by_char.entry(first).or_default().push(position);
            }
        }
    }

    pub fn translated_count(&self) -> usize {
        self.terms.iter().filter(|term| term.is_translated()).count()
    }

    /// 合并 AI 抽取的术语：不覆盖已有译名，仅补全空译名。
    pub fn merge_ai_term(&mut self, term: &GlossaryTerm) -> MergeOutcome {
        let Some(term) = term.normalized() else {
            return MergeOutcome::Skipped;
        };
        let key = normalize_key(&term.source);
        if let Some(&position) = self.index.get(&key) {
            let existing = &mut self.terms[position];
            if existing.target.trim().is_empty() && !term.target.trim().is_empty() {
                existing.target = term.target;
                if existing.note.trim().is_empty() {
                    existing.note = term.note;
                }
                return MergeOutcome::Updated;
            }
            return MergeOutcome::Skipped;
        }
        let position = self.terms.len();
        self.terms.push(term);
        self.index.insert(key, position);
        if let Some(first) = self.terms[position].source.to_lowercase().chars().next() {
            self.by_char.entry(first).or_default().push(position);
        }
        MergeOutcome::Added
    }

    /// 手动新增或编辑术语（人工结果优先）。
    pub fn save_term(&mut self, term: GlossaryTerm) -> anyhow::Result<GlossaryTerm> {
        let Some(term) = term.normalized() else {
            anyhow::bail!("术语原文不能为空，且长度不能超过 {MAX_TERM_CHARS} 个字符");
        };
        let key = normalize_key(&term.source);
        if let Some(&position) = self.index.get(&key) {
            let existing = &mut self.terms[position];
            existing.source = term.source;
            existing.target = term.target;
            existing.note = term.note;
            existing.manual = true;
            let updated = existing.clone();
            self.rebuild();
            return Ok(updated);
        }
        let mut created = term;
        created.manual = true;
        self.terms.push(created.clone());
        self.rebuild();
        Ok(created)
    }

    pub fn delete_terms(&mut self, sources: &[String]) -> usize {
        let targets: HashSet<String> = sources.iter().map(|source| normalize_key(source)).collect();
        if targets.is_empty() {
            return 0;
        }
        let before = self.terms.len();
        self.terms.retain(|term| !targets.contains(&normalize_key(&term.source)));
        self.rebuild();
        before - self.terms.len()
    }

    pub fn page(&self, query: &TermQuery) -> TermPage {
        let keyword = query.keyword.trim().to_lowercase();
        let filter = query.filter.as_str();
        let matched: Vec<&GlossaryTerm> = self
            .terms
            .iter()
            .filter(|term| match filter {
                "translated" => term.is_translated(),
                "untranslated" => !term.is_translated(),
                "manual" => term.manual,
                _ => true,
            })
            .filter(|term| {
                keyword.is_empty()
                    || term.source.to_lowercase().contains(&keyword)
                    || term.target.to_lowercase().contains(&keyword)
                    || term.note.to_lowercase().contains(&keyword)
            })
            .collect();

        let page_size = query.page_size.clamp(10, 200);
        let page = query.page.max(1);
        let start = (page - 1).saturating_mul(page_size).min(matched.len());
        let end = (start + page_size).min(matched.len());

        TermPage {
            total: matched.len(),
            page,
            page_size,
            items: matched[start..end].iter().map(|term| (*term).clone()).collect(),
            translated: self.translated_count(),
        }
    }

    /// 返回本批次原文命中的术语（译名非空），按原文长度倒序，避免短词覆盖长词。
    pub fn matches_for(&self, text: &str) -> Vec<GlossaryTerm> {
        let lowered = text.to_lowercase();
        let mut seen: HashSet<usize> = HashSet::new();
        let mut hits: Vec<usize> = Vec::new();
        for ch in lowered.chars() {
            let Some(candidates) = self.by_char.get(&ch) else {
                continue;
            };
            for &position in candidates {
                if seen.contains(&position) {
                    continue;
                }
                let term = &self.terms[position];
                if !term.is_translated() {
                    continue;
                }
                if lowered.contains(&term.source.to_lowercase()) {
                    seen.insert(position);
                    hits.push(position);
                }
            }
        }
        hits.sort_by_key(|&position| std::cmp::Reverse(self.terms[position].source.chars().count()));
        hits.truncate(MAX_INJECTED_TERMS);
        hits.into_iter().map(|position| self.terms[position].clone()).collect()
    }

    /// 导入术语表文件，兼容 `{terms: []}`、纯数组与常见字段别名。
    pub fn import_file(&mut self, path: &Path, mode: &str) -> anyhow::Result<GlossaryImportReport> {
        let text = storage::read_text(path)?;
        let value: Value = serde_json::from_str(text.trim_start_matches('\u{feff}'))
            .map_err(|err| anyhow::anyhow!("术语表不是合法的 JSON：{err}"))?;

        let list = extract_term_list(&value)
            .ok_or_else(|| anyhow::anyhow!("术语表结构无效，应为数组或包含 terms 字段的对象"))?;
        let total = list.len();
        let replace = mode == "replace";
        if replace {
            self.terms.clear();
            self.rebuild();
        }

        let mut report = GlossaryImportReport {
            total,
            added: 0,
            updated: 0,
            skipped: 0,
            replaced: replace,
            conflicts: Vec::new(),
            terms_total: 0,
        };
        let mut seen: HashSet<String> = HashSet::new();

        for entry in list {
            let Some(mut term) = term_from_value(&entry) else {
                report.skipped += 1;
                continue;
            };
            term.manual = true;
            let key = normalize_key(&term.source);
            if key.is_empty() || !seen.insert(key.clone()) {
                report.skipped += 1;
                continue;
            }
            match self.index.get(&key) {
                Some(&position) => {
                    let existing = &mut self.terms[position];
                    if existing.target.trim() == term.target.trim() && existing.note == term.note {
                        report.skipped += 1;
                        continue;
                    }
                    if existing.manual && existing.is_translated() && term.is_translated() {
                        if report.conflicts.len() < 20 {
                            report.conflicts.push(format!(
                                "{}：保留“{}”，忽略导入的“{}”",
                                existing.source, existing.target, term.target
                            ));
                        }
                        report.skipped += 1;
                        continue;
                    }
                    if term.is_translated() {
                        existing.target = term.target;
                    }
                    if !term.note.is_empty() {
                        existing.note = term.note;
                    }
                    existing.manual = true;
                    report.updated += 1;
                }
                None => {
                    self.terms.push(term);
                    report.added += 1;
                }
            }
        }

        self.rebuild();
        report.terms_total = self.terms.len();
        Ok(report)
    }

    pub fn export_file(&self, path: &Path) -> anyhow::Result<()> {
        let payload = serde_json::json!({
            "terms": self
                .terms
                .iter()
                .map(|term| serde_json::json!({
                    "source": term.source,
                    "target": term.target,
                    "note": term.note,
                }))
                .collect::<Vec<_>>()
        });
        storage::write_json_atomic(path, &payload, true)
    }
}

fn normalize_key(source: &str) -> String {
    source.trim().to_lowercase()
}

fn extract_term_list(value: &Value) -> Option<Vec<Value>> {
    if let Some(array) = value.as_array() {
        return Some(array.clone());
    }
    let object = value.as_object()?;
    for key in ["terms", "glossary", "items", "data"] {
        if let Some(array) = object.get(key).and_then(Value::as_array) {
            return Some(array.clone());
        }
    }
    for (_key, nested) in object {
        if let Some(array) = nested.as_array() {
            return Some(array.clone());
        }
    }
    None
}

fn term_from_value(value: &Value) -> Option<GlossaryTerm> {
    if let Some(text) = value.as_str() {
        let source = text.trim();
        if source.is_empty() {
            return None;
        }
        return Some(GlossaryTerm {
            source: source.to_string(),
            target: String::new(),
            note: String::new(),
            manual: true,
        });
    }
    let object = value.as_object()?;
    let source = pick_str(object, &["source", "original", "src", "term", "原文"])?;
    let target = pick_str(object, &["target", "translation", "dst", "translated", "译文"])
        .unwrap_or_default();
    let note = pick_str(object, &["note", "remark", "comment", "desc", "备注"]).unwrap_or_default();
    let term = GlossaryTerm {
        source,
        target,
        note,
        manual: true,
    };
    term.normalized()
}

fn pick_str(object: &serde_json::Map<String, Value>, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(value) = object.get(*key) {
            if let Some(text) = value.as_str() {
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    return Some(trimmed.to_string());
                }
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn term(source: &str, target: &str, note: &str) -> GlossaryTerm {
        GlossaryTerm {
            source: source.to_string(),
            target: target.to_string(),
            note: note.to_string(),
            manual: false,
        }
    }

    #[test]
    fn ai_merge_does_not_overwrite_manual_targets() {
        let mut glossary = Glossary::default();
        glossary
            .save_term(GlossaryTerm {
                source: "佐伯".into(),
                target: "佐伯".into(),
                note: "角色".into(),
                manual: true,
            })
            .unwrap();

        let outcome = glossary.merge_ai_term(&term("佐伯", "沙伯", "角色"));
        assert_eq!(outcome, MergeOutcome::Skipped);
        assert_eq!(glossary.terms[0].target, "佐伯");

        let added = glossary.merge_ai_term(&term("根岸", "根岸", "角色"));
        assert_eq!(added, MergeOutcome::Added);
        assert_eq!(glossary.terms.len(), 2);
    }

    #[test]
    fn injection_matches_longest_terms_first() {
        let mut glossary = Glossary::default();
        glossary.save_term(term("回復薬", "回复药", "道具")).unwrap();
        glossary.save_term(term("薬", "药", "")).unwrap();

        let matches = glossary.matches_for("回復薬を三つ使う");
        assert_eq!(matches.len(), 2);
        assert_eq!(matches[0].source, "回復薬");
        assert!(glossary.matches_for("こんにちは").is_empty());
    }

    #[test]
    fn import_supports_aliases_and_reports_conflicts() {
        let directory = std::env::temp_dir().join("fgpt-glossary-test");
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("glossary.json");
        std::fs::write(
            &path,
            r#"{"terms":[
                {"original":"回復薬","translation":"回血药","remark":"道具"},
                {"source":"佐伯","target":"沙伯"},
                {"source":"","target":"无效"}
            ]}"#,
        )
        .unwrap();

        let mut glossary = Glossary::default();
        glossary
            .save_term(GlossaryTerm {
                source: "佐伯".into(),
                target: "佐伯".into(),
                note: "角色".into(),
                manual: true,
            })
            .unwrap();

        let report = glossary.import_file(&path, "merge").unwrap();
        assert_eq!(report.total, 3);
        assert_eq!(report.added, 1);
        assert_eq!(report.skipped, 2);
        assert_eq!(report.conflicts.len(), 1);
        assert_eq!(glossary.terms.len(), 2);
        assert_eq!(
            glossary
                .terms
                .iter()
                .find(|term| term.source == "回復薬")
                .unwrap()
                .note,
            "道具"
        );

        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_dir(&directory);
    }
}
