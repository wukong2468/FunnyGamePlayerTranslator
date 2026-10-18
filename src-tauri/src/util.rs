//! 通用工具：时间格式化、字符串处理。

use chrono::Local;

/// 当前时间的 RFC3339 字符串（本地时区），用于持久化与界面展示。
pub fn now_iso() -> String {
    Local::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

/// 文本的字符数量（按 Unicode 标量统计，避免按字节计算导致的误差）。
pub fn char_len(text: &str) -> usize {
    text.chars().count()
}

/// 截断文本用于日志展示，避免超长原文占满日志区域。
pub fn ellipsis(text: &str, limit: usize) -> String {
    let mut result: String = text.chars().take(limit).collect();
    if text.chars().count() > limit {
        result.push('…');
    }
    result.replace('\n', "\\n")
}
