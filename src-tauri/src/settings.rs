//! 全局设置模型、校验与脱敏视图。

use serde::{Deserialize, Serialize};

/// 请求超时下限（秒）。
pub const MIN_TIMEOUT_SECS: f64 = 1.0;
/// 请求超时上限（秒）。
pub const MAX_TIMEOUT_SECS: f64 = 600.0;
/// 最大并发请求数。
pub const MAX_CONCURRENCY: usize = 500;
/// 单批字符数下限。
pub const MIN_BATCH_CHARS: usize = 100;
/// 单批字符数上限。
pub const MAX_BATCH_CHARS: usize = 100_000;
/// 单批条目数上限。
pub const MAX_BATCH_ITEMS: usize = 1_000;
/// 重试基础间隔上限（毫秒，即 300 秒）。
pub const MAX_BACKOFF_MS: u64 = 300_000;
/// 失败重试次数上限。
pub const MAX_RETRY_TIMES: usize = 100;
/// 额外提示词长度上限（字符）。
pub const MAX_PROMPT_CHARS: usize = 10_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ThemeMode {
    Light,
    Dark,
    System,
}

impl Default for ThemeMode {
    fn default() -> Self {
        Self::System
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Density {
    Comfortable,
    Compact,
}

impl Default for Density {
    fn default() -> Self {
        Self::Comfortable
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BackoffStrategy {
    None,
    Linear,
    Exponential,
}

impl Default for BackoffStrategy {
    fn default() -> Self {
        Self::Exponential
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GlossaryInjection {
    /// 不注入术语
    Off,
    /// 仅注入本批次原文命中的术语
    Matched,
    /// 注入命中的术语，并附带分类备注
    MatchedWithNote,
}

impl Default for GlossaryInjection {
    fn default() -> Self {
        Self::Matched
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LongTextStrategy {
    /// 超过上限 6 倍的文本直接跳过并标记失败
    Skip,
    /// 超过上限 6 倍的文本单独成批翻译
    Isolate,
}

impl Default for LongTextStrategy {
    fn default() -> Self {
        Self::Skip
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppearanceSettings {
    pub theme_mode: ThemeMode,
    pub primary_color: String,
    pub density: Density,
    pub font_family: String,
    pub font_size: f32,
}

impl Default for AppearanceSettings {
    fn default() -> Self {
        Self {
            theme_mode: ThemeMode::System,
            primary_color: "#3B82F6".to_string(),
            density: Density::Comfortable,
            font_family: "system".to_string(),
            font_size: 14.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ApiSettings {
    pub base_url: String,
    /// 仅存在于后端与本地设置文件，不通过命令返回给前端。
    pub api_key: String,
    pub model: String,
    pub temperature: f32,
    /// 请求超时（秒），支持小数。
    pub timeout_secs: f64,
    pub json_mode: bool,
}

impl Default for ApiSettings {
    fn default() -> Self {
        Self {
            base_url: "https://api.openai.com/v1".to_string(),
            api_key: String::new(),
            model: "gpt-4o-mini".to_string(),
            temperature: 0.3,
            timeout_secs: 120.0,
            json_mode: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TranslationSettings {
    pub concurrency: usize,
    pub max_chars_per_batch: usize,
    pub max_items_per_batch: usize,
    pub retry_times: usize,
    pub backoff_strategy: BackoffStrategy,
    pub backoff_ms: u64,
    pub glossary_injection: GlossaryInjection,
    pub system_prompt: String,
    pub user_prompt: String,
    pub long_text_strategy: LongTextStrategy,
    pub continue_on_batch_error: bool,
    pub glossary_batch_chars: usize,
    pub glossary_batch_items: usize,
}

impl Default for TranslationSettings {
    fn default() -> Self {
        Self {
            concurrency: 10,
            max_chars_per_batch: 4000,
            max_items_per_batch: 40,
            retry_times: 3,
            backoff_strategy: BackoffStrategy::Exponential,
            backoff_ms: 1000,
            glossary_injection: GlossaryInjection::Matched,
            system_prompt: String::new(),
            user_prompt: String::new(),
            long_text_strategy: LongTextStrategy::Skip,
            continue_on_batch_error: true,
            glossary_batch_chars: 4000,
            glossary_batch_items: 40,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub appearance: AppearanceSettings,
    pub api: ApiSettings,
    pub translation: TranslationSettings,
}

/// 返回给前端的 API 配置（不含明文密钥）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiSettingsView {
    pub base_url: String,
    pub model: String,
    pub temperature: f32,
    pub timeout_secs: f64,
    pub json_mode: bool,
    pub has_api_key: bool,
    pub api_key_masked: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    pub appearance: AppearanceSettings,
    pub api: ApiSettingsView,
    pub translation: TranslationSettings,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ApiSettingsInput {
    pub base_url: String,
    pub model: String,
    pub temperature: f32,
    pub timeout_secs: f64,
    pub json_mode: bool,
    /// 为空表示保留已保存的密钥。
    pub api_key: Option<String>,
    pub clear_api_key: bool,
}

impl Default for ApiSettingsInput {
    fn default() -> Self {
        let defaults = ApiSettings::default();
        Self {
            base_url: defaults.base_url,
            model: defaults.model,
            temperature: defaults.temperature,
            timeout_secs: defaults.timeout_secs,
            json_mode: defaults.json_mode,
            api_key: None,
            clear_api_key: false,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SettingsInput {
    pub appearance: AppearanceSettings,
    pub api: ApiSettingsInput,
    pub translation: TranslationSettings,
}

impl Default for SettingsInput {
    fn default() -> Self {
        Self {
            appearance: AppearanceSettings::default(),
            api: ApiSettingsInput::default(),
            translation: TranslationSettings::default(),
        }
    }
}

impl Settings {
    pub fn view(&self) -> SettingsView {
        SettingsView {
            appearance: self.appearance.clone(),
            api: ApiSettingsView {
                base_url: self.api.base_url.clone(),
                model: self.api.model.clone(),
                temperature: self.api.temperature,
                timeout_secs: self.api.timeout_secs,
                json_mode: self.api.json_mode,
                has_api_key: !self.api.api_key.trim().is_empty(),
                api_key_masked: mask_key(&self.api.api_key),
            },
            translation: self.translation.clone(),
        }
    }

    /// 应用前端提交的设置并执行校验。
    pub fn apply(&mut self, input: SettingsInput) -> anyhow::Result<()> {
        let next = Settings {
            appearance: input.appearance,
            api: ApiSettings {
                base_url: input.api.base_url.trim().to_string(),
                api_key: match (input.api.clear_api_key, input.api.api_key) {
                    (true, _) => String::new(),
                    (false, Some(key)) if !key.trim().is_empty() => key.trim().to_string(),
                    _ => self.api.api_key.clone(),
                },
                model: input.api.model.trim().to_string(),
                temperature: input.api.temperature,
                timeout_secs: input.api.timeout_secs,
                json_mode: input.api.json_mode,
            },
            translation: input.translation,
        };
        next.validate()?;
        *self = next;
        Ok(())
    }

    pub fn validate(&self) -> anyhow::Result<()> {
        let appearance = &self.appearance;
        if !is_hex_color(&appearance.primary_color) {
            anyhow::bail!("primaryColor: 主题色必须是 #RRGGBB 格式");
        }
        if !(12.0..=20.0).contains(&appearance.font_size) {
            anyhow::bail!("fontSize: 字号需在 12 - 20 之间");
        }
        if appearance.font_family.trim().is_empty() {
            anyhow::bail!("fontFamily: 字体不能为空");
        }

        let api = &self.api;
        let url = api.base_url.trim();
        if url.is_empty() {
            anyhow::bail!("baseUrl: API 地址不能为空");
        }
        if !(url.starts_with("http://") || url.starts_with("https://")) {
            anyhow::bail!("baseUrl: API 地址必须以 http:// 或 https:// 开头");
        }
        if url.parse::<reqwest::Url>().is_err() {
            anyhow::bail!("baseUrl: API 地址格式无效");
        }
        if api.model.trim().is_empty() {
            anyhow::bail!("model: 模型名称不能为空");
        }
        if !(0.0..=2.0).contains(&api.temperature) {
            anyhow::bail!("temperature: Temperature 需在 0 - 2 之间");
        }
        if !(MIN_TIMEOUT_SECS..=MAX_TIMEOUT_SECS).contains(&api.timeout_secs) {
            anyhow::bail!("timeoutSecs: 请求超时需在 1 - 600 秒之间");
        }

        let translation = &self.translation;
        if !(1..=MAX_CONCURRENCY).contains(&translation.concurrency) {
            anyhow::bail!("concurrency: 并发数需在 1 - 500 之间");
        }
        if !(MIN_BATCH_CHARS..=MAX_BATCH_CHARS).contains(&translation.max_chars_per_batch) {
            anyhow::bail!("maxCharsPerBatch: 单批字符上限需在 100 - 100000 之间");
        }
        if !(1..=MAX_BATCH_ITEMS).contains(&translation.max_items_per_batch) {
            anyhow::bail!("maxItemsPerBatch: 单批条目上限需在 1 - 1000 之间");
        }
        if translation.retry_times > MAX_RETRY_TIMES {
            anyhow::bail!("retryTimes: 失败重试次数需在 0 - 100 之间");
        }
        if translation.backoff_ms > MAX_BACKOFF_MS {
            anyhow::bail!("backoffMs: 重试间隔需在 0 - 300 秒之间");
        }
        if !(MIN_BATCH_CHARS..=MAX_BATCH_CHARS).contains(&translation.glossary_batch_chars) {
            anyhow::bail!("glossaryBatchChars: 术语单批字符上限需在 100 - 100000 之间");
        }
        if !(1..=MAX_BATCH_ITEMS).contains(&translation.glossary_batch_items) {
            anyhow::bail!("glossaryBatchItems: 术语单批条目上限需在 1 - 1000 之间");
        }
        if translation.system_prompt.chars().count() > MAX_PROMPT_CHARS {
            anyhow::bail!("systemPrompt: 额外系统提示词不能超过 10000 字符");
        }
        if translation.user_prompt.chars().count() > MAX_PROMPT_CHARS {
            anyhow::bail!("userPrompt: 额外用户提示词不能超过 10000 字符");
        }
        Ok(())
    }
}

/// 密钥脱敏：仅保留末尾 4 位。
pub fn mask_key(key: &str) -> String {
    let key = key.trim();
    if key.is_empty() {
        return String::new();
    }
    let chars: Vec<char> = key.chars().collect();
    if chars.len() <= 8 {
        return "••••••••".to_string();
    }
    let tail: String = chars[chars.len() - 4..].iter().collect();
    format!("••••••••{tail}")
}

fn is_hex_color(value: &str) -> bool {
    let bytes = value.trim().as_bytes();
    bytes.len() == 7 && bytes[0] == b'#' && bytes[1..].iter().all(u8::is_ascii_hexdigit)
}
