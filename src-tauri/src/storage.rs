//! 原子文件读写与工作区目录工具。

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::Serialize;
use serde::de::DeserializeOwned;
use sha2::{Digest, Sha256};

/// 读取 JSON 文件，文件不存在时返回 `None`。
pub fn read_json<T: DeserializeOwned>(path: &Path) -> Result<Option<T>> {
    if !path.exists() {
        return Ok(None);
    }
    let bytes = fs::read(path).with_context(|| format!("读取文件失败：{}", path.display()))?;
    if bytes.iter().all(|byte| byte.is_ascii_whitespace()) {
        return Ok(None);
    }
    let value = serde_json::from_slice(&bytes)
        .with_context(|| format!("解析 JSON 失败：{}", path.display()))?;
    Ok(Some(value))
}

/// 读取文本文件：兼容 UTF-8 BOM 与少量非 UTF-8 场景（回退为 UTF-8 有损解码）。
pub fn read_text(path: &Path) -> Result<String> {
    let bytes = fs::read(path).with_context(|| format!("读取文件失败：{}", path.display()))?;
    let text = match String::from_utf8(bytes) {
        Ok(text) => text,
        Err(err) => String::from_utf8_lossy(err.as_bytes()).into_owned(),
    };
    Ok(text.strip_prefix('\u{feff}').map(str::to_string).unwrap_or(text))
}

/// 写入二进制文件：先写临时文件并落盘，再原子替换目标文件。
pub fn write_bytes_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("创建目录失败：{}", parent.display()))?;
    }
    let tmp = temp_path(path);
    {
        let mut file = fs::File::create(&tmp)
            .with_context(|| format!("创建临时文件失败：{}", tmp.display()))?;
        file.write_all(bytes)
            .with_context(|| format!("写入临时文件失败：{}", tmp.display()))?;
        file.sync_all().ok();
    }
    fs::rename(&tmp, path).with_context(|| format!("替换文件失败：{}", path.display()))?;
    Ok(())
}

/// 原子写入 JSON。
pub fn write_json_atomic<T: Serialize>(path: &Path, value: &T, pretty: bool) -> Result<()> {
    let bytes = if pretty {
        serde_json::to_vec_pretty(value)
    } else {
        serde_json::to_vec(value)
    }
    .context("序列化 JSON 失败")?;
    write_bytes_atomic(path, &bytes)
}

/// 以 4 空格缩进序列化 JSON，用于导出给用户查看的文件。
pub fn to_vec_indent4<T: Serialize>(value: &T) -> Result<Vec<u8>> {
    let mut buffer = Vec::new();
    {
        let formatter = serde_json::ser::PrettyFormatter::with_indent(b"    ");
        let mut serializer = serde_json::Serializer::with_formatter(&mut buffer, formatter);
        value
            .serialize(&mut serializer)
            .context("序列化 JSON 失败")?;
    }
    Ok(buffer)
}

/// 以 4 空格缩进原子写入导出的 JSON 文件。
pub fn write_json_atomic_indent4<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    let bytes = to_vec_indent4(value)?;
    write_bytes_atomic(path, &bytes)
}

fn temp_path(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("data");
    path.with_file_name(format!("{file_name}.tmp"))
}

/// 路径哈希（取 SHA256 前 8 个十六进制字符），用于隔离同名不同目录的项目工作区。
pub fn path_hash(path: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(path.to_lowercase().as_bytes());
    let digest = hasher.finalize();
    digest.iter().take(4).map(|byte| format!("{byte:02x}")).collect()
}

/// 生成工作区目录名：`<文件名主干>-<路径哈希>`。
pub fn workspace_dir_name(source_path: &str) -> String {
    let stem = Path::new(source_path)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("project");
    let safe: String = stem
        .chars()
        .map(|ch| if ch.is_alphanumeric() || ch == '-' || ch == '_' { ch } else { '_' })
        .take(60)
        .collect();
    format!("{safe}-{}", path_hash(source_path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn indent4_serializes_multiline_with_four_spaces() {
        let value = serde_json::json!({ "a": [1, { "b": 2 }] });
        let text = String::from_utf8(to_vec_indent4(&value).unwrap()).unwrap();
        assert_eq!(
            text,
            "{\n    \"a\": [\n        1,\n        {\n            \"b\": 2\n        }\n    ]\n}"
        );
    }
}
