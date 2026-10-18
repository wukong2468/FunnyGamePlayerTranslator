//! OpenAI 兼容（`/chat/completions`）客户端，带可重试错误分类。

use std::time::Duration;

use reqwest::Client;
use serde_json::{Value, json};
use tokio_util::sync::CancellationToken;

use crate::settings::{ApiSettings, MAX_TIMEOUT_SECS, MIN_TIMEOUT_SECS};

/// 统一的 AI 调用错误，区分是否可重试。
#[derive(Debug, Clone)]
pub struct AiError {
    pub message: String,
    pub retryable: bool,
}

impl AiError {
    pub fn retryable(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            retryable: true,
        }
    }

    pub fn fatal(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            retryable: false,
        }
    }
}

impl std::fmt::Display for AiError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}", self.message)
    }
}

/// 拼接 chat/completions 地址，兼容只填 `/v1` 或完整地址。
pub fn endpoint(base_url: &str) -> String {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.ends_with("/chat/completions") {
        trimmed.to_string()
    } else {
        format!("{trimmed}/chat/completions")
    }
}

/// 生效的请求超时（秒）：支持小数，非法值回退默认并夹到 1 - 600 秒。
fn timeout_secs(api: &ApiSettings) -> f64 {
    if api.timeout_secs.is_finite() {
        api.timeout_secs.clamp(MIN_TIMEOUT_SECS, MAX_TIMEOUT_SECS)
    } else {
        120.0
    }
}

/// 发起一次对话请求，返回模型输出的文本内容。
pub async fn chat(
    http: &Client,
    api: &ApiSettings,
    system: &str,
    user: &str,
    cancel: &CancellationToken,
) -> Result<String, AiError> {
    if api.model.trim().is_empty() {
        return Err(AiError::fatal("尚未配置模型名称，请先在设置中填写模型"));
    }

    let mut body = json!({
        "model": api.model,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": user }
        ],
        "temperature": api.temperature,
        "stream": false
    });
    if api.json_mode {
        body["response_format"] = json!({ "type": "json_object" });
    }

    let mut request = http
        .post(endpoint(&api.base_url))
        .timeout(Duration::from_secs_f64(timeout_secs(&api)))
        .header("Content-Type", "application/json")
        .json(&body);
    let key = api.api_key.trim();
    if !key.is_empty() {
        request = request.bearer_auth(key);
    }

    let response = tokio::select! {
        _ = cancel.cancelled() => return Err(AiError::fatal("任务已中断")),
        result = request.send() => result.map_err(|err| {
            if err.is_timeout() || err.is_connect() || err.is_request() {
                AiError::retryable(format!("网络请求失败：{err}"))
            } else {
                AiError::retryable(format!("网络请求失败：{err}"))
            }
        })?,
    };

    let status = response.status();
    let text = tokio::select! {
        _ = cancel.cancelled() => return Err(AiError::fatal("任务已中断")),
        result = response.text() => result.map_err(|err| AiError::retryable(format!("读取响应失败：{err}")))?,
    };

    if !status.is_success() {
        let brief = redact(&text.chars().take(600).collect::<String>(), key);
        let retryable = status.as_u16() == 408
            || status.as_u16() == 409
            || status.as_u16() == 425
            || status.as_u16() == 429
            || status.is_server_error();
        let message = format!("接口返回 HTTP {}：{}", status.as_u16(), brief.trim());
        return Err(if retryable {
            AiError::retryable(message)
        } else {
            AiError::fatal(message)
        });
    }

    let value: Value = serde_json::from_str(&text)
        .map_err(|_| AiError::retryable("接口返回内容不是合法 JSON，可能是网关错误页"))?;
    let content = extract_content(&value)?;
    if content.trim().is_empty() {
        return Err(AiError::retryable("模型返回内容为空"));
    }
    Ok(content)
}

fn extract_content(value: &Value) -> Result<String, AiError> {
    let choices = value
        .get("choices")
        .and_then(Value::as_array)
        .ok_or_else(|| AiError::retryable("接口返回缺少 choices 字段，请确认 API 兼容 OpenAI 协议"))?;
    let first = choices
        .first()
        .ok_or_else(|| AiError::retryable("接口没有返回任何结果"))?;

    if let Some(content) = first.get("message").and_then(|message| message.get("content")) {
        if let Some(text) = content.as_str() {
            return Ok(text.to_string());
        }
        if let Some(parts) = content.as_array() {
            let mut merged = String::new();
            for part in parts {
                if let Some(text) = part.get("text").and_then(Value::as_str) {
                    merged.push_str(text);
                }
            }
            if !merged.is_empty() {
                return Ok(merged);
            }
        }
    }
    if let Some(text) = first.get("text").and_then(Value::as_str) {
        return Ok(text.to_string());
    }
    Err(AiError::retryable("接口返回内容为空"))
}

/// 从模型回复中提取 JSON：兼容代码块包裹与前后解释文字。
pub fn extract_json(text: &str) -> Result<Value, AiError> {
    let trimmed = text.trim();
    if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
        return Ok(value);
    }

    let mut cleaned = trimmed;
    if cleaned.starts_with("```") {
        cleaned = cleaned
            .trim_start_matches("```json")
            .trim_start_matches("```JSON")
            .trim_start_matches("```");
        if let Some(position) = cleaned.rfind("```") {
            cleaned = &cleaned[..position];
        }
        cleaned = cleaned.trim();
        if let Ok(value) = serde_json::from_str::<Value>(cleaned) {
            return Ok(value);
        }
    }

    for (open, close) in [('{', '}'), ('[', ']')] {
        if let (Some(start), Some(end)) = (trimmed.find(open), trimmed.rfind(close)) {
            if end > start {
                if let Ok(value) = serde_json::from_str::<Value>(&trimmed[start..=end]) {
                    return Ok(value);
                }
            }
        }
    }

    Err(AiError::retryable("模型回复中未找到合法 JSON"))
}

fn redact(text: &str, key: &str) -> String {
    if key.is_empty() {
        text.to_string()
    } else {
        text.replace(key, "***")
    }
}
