//! 翻译与术语抽取的提示词构建。

use serde_json::{Value, json};

use crate::glossary::GlossaryTerm;

/// 语言代码转换为提示词中更可靠的中文名称。
pub fn language_name(code: &str) -> String {
    match code {
        "ja" => "日语",
        "zh-CN" => "简体中文",
        "zh-TW" => "繁体中文",
        "en" => "英语",
        "ko" => "韩语",
        "ru" => "俄语",
        "fr" => "法语",
        "de" => "德语",
        "es" => "西班牙语",
        other => other,
    }
    .to_string()
}

pub struct TranslateItem<'a> {
    pub id: String,
    pub text: &'a str,
    pub reference: Option<&'a str>,
}

pub fn translate_system(
    source_lang: &str,
    target_lang: &str,
    glossary: &[GlossaryTerm],
    include_note: bool,
    extra_system: &str,
) -> String {
    let source = language_name(source_lang);
    let target = language_name(target_lang);
    let mut prompt = format!(
        "你是一名资深的游戏本地化译者，负责把{source}游戏文本翻译成{target}。\n\
严格遵循以下规则：\n\
1. 只输出一个 JSON 对象，格式为 {{\"translations\":[{{\"id\":\"条目 id\",\"translation\":\"译文\"}}]}}；不要输出 Markdown 代码块、注释或解释。\n\
2. 输入中的每个 id 必须且只能出现一次，不得新增、遗漏、合并或重排条目。\n\
3. 保持占位符、转义符与标记原样（如 {{0}}、%s、%1$s、\\n、<color=…>、[ruby] 等），不得翻译或增删。\n\
4. 原文包含换行时，译文必须保持相同的分行数量；单行文本不要附加换行。\n\
5. 原文若本身是 JSON、代码或数据片段，只翻译其中面向玩家的自然语言字符串，保持 JSON 结构与转义合法。\n\
6. 语气、人称与专有名词译名在同一批次内保持一致，译文简洁自然，适合游戏内显示。\n\
7. 若原文已经是{target}且无需修改，原样返回；纯符号、数字、空白文本原样返回。\n"
    );

    if !glossary.is_empty() {
        prompt.push_str("\n【术语表】以下专有名词必须使用给定译名，不得改写：\n");
        for term in glossary {
            if include_note && !term.note.is_empty() {
                prompt.push_str(&format!("- {} => {}（{}）\n", term.source, term.target, term.note));
            } else {
                prompt.push_str(&format!("- {} => {}\n", term.source, term.target));
            }
        }
    }

    let extra = extra_system.trim();
    if !extra.is_empty() {
        prompt.push_str("\n【额外要求】\n");
        prompt.push_str(extra);
        prompt.push('\n');
    }
    prompt
}

pub fn translate_user(items: &[TranslateItem<'_>], extra_user: &str) -> String {
    let payload: Vec<Value> = items
        .iter()
        .map(|item| {
            let mut object = serde_json::Map::new();
            object.insert("id".into(), json!(item.id));
            object.insert("text".into(), json!(item.text));
            if let Some(reference) = item.reference {
                if !reference.trim().is_empty() {
                    object.insert("reference".into(), json!(reference));
                }
            }
            Value::Object(object)
        })
        .collect();

    let extra = extra_user.trim();
    let mut prompt = String::from("请翻译以下条目，只返回 JSON：\n");
    if !extra.is_empty() {
        prompt.push_str("提示：");
        prompt.push_str(extra);
        prompt.push('\n');
    }
    prompt.push_str(
        &serde_json::to_string(&json!({ "items": payload }))
            .unwrap_or_else(|_| "{\"items\":[]}".to_string()),
    );
    prompt
}

pub fn glossary_system(source_lang: &str, target_lang: &str) -> String {
    let source = language_name(source_lang);
    let target = language_name(target_lang);
    format!(
        "你是游戏本地化项目的术语整理助手。阅读给定的{source}文本片段，抽取其中的专有名词\
（人名、地名、道具名、技能名、组织名、称号、专有设定等），并给出{target}译名。\n\
只输出一个 JSON 对象：{{\"terms\":[{{\"source\":\"原文\",\"target\":\"译名\",\"note\":\"分类\"}}]}}，\
不要输出 Markdown 代码块或解释。\n\
规则：\n\
1. source 必须是文本中出现的完整词形，只包含名词本身，不要包含句子、标点或空格包裹。\n\
2. 只抽取专有名词，忽略普通名词、动词、助词、语气词与泛称。\n\
3. target 必须非空，使用{target}中最常见、最自然的译名。\n\
4. note 用两到四个字标注分类，例如 角色、地点、道具、技能、组织。\n\
5. 同一 source 只输出一次；没有可抽取的术语时返回 {{\"terms\":[]}}。\n"
    )
}

pub fn glossary_user(group: &str, texts: &[String]) -> String {
    serde_json::to_string(&json!({
        "group": group,
        "texts": texts,
    }))
    .unwrap_or_else(|_| "{\"texts\":[]}".to_string())
}
