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

/// 计算文件内容哈希（SHA-256 十六进制），用于判断源文件是否被修改。
pub fn file_hash(path: &Path) -> Result<String> {
    use std::io::Read;

    let mut file =
        fs::File::open(path).with_context(|| format!("读取文件失败：{}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .with_context(|| format!("读取文件失败：{}", path.display()))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
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

/// 路径哈希（取 SHA256 前 16 个十六进制字符 = 64 位），用于隔离同名不同目录的项目工作区。
pub fn path_hash(path: &str) -> String {
    hash_prefix(path, 8)
}

/// 旧版工作区使用的前 8 个十六进制字符（兼容已存在的工作区目录）。
pub fn path_hash_legacy(path: &str) -> String {
    hash_prefix(path, 4)
}

/// 完整路径哈希（64 个十六进制字符），仅在极端哈希冲突时用于兜底目录名。
pub fn path_hash_full(path: &str) -> String {
    hash_prefix(path, 32)
}

fn hash_prefix(path: &str, bytes: usize) -> String {
    let mut hasher = Sha256::new();
    hasher.update(path.to_lowercase().as_bytes());
    hasher
        .finalize()
        .iter()
        .take(bytes)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// 生成工作区目录名：`<文件名主干>-<路径哈希>`。
pub fn workspace_dir_name(source_path: &str) -> String {
    workspace_dir_name_with_hash(source_path, &path_hash(source_path))
}

/// 旧版工作区目录名（8 位哈希），用于兼容升级前创建的项目。
pub fn workspace_dir_name_legacy(source_path: &str) -> String {
    workspace_dir_name_with_hash(source_path, &path_hash_legacy(source_path))
}

/// 使用指定哈希拼接工作区目录名，便于冲突时换用完整哈希。
pub fn workspace_dir_name_with_hash(source_path: &str, hash: &str) -> String {
    let stem = Path::new(source_path)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("project");
    let safe: String = stem
        .chars()
        .map(|ch| if ch.is_alphanumeric() || ch == '-' || ch == '_' { ch } else { '_' })
        .take(60)
        .collect();
    format!("{safe}-{hash}")
}

/// 判断工作区目录是否属于该源文件（用于识别路径哈希冲突）。
///
/// 优先读轻量的 `meta.json`，缺失时回退 `project.json`；
/// 目录为空或读不出归属信息时按“属于”处理，保持旧行为。
pub fn workspace_belongs_to(workspace: &Path, source_path: &str) -> bool {
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Owner {
        #[serde(default)]
        source_path: String,
    }

    for name in ["meta.json", "project.json"] {
        let path = workspace.join(name);
        if !path.exists() {
            continue;
        }
        if let Ok(Some(owner)) = read_json::<Owner>(&path) {
            if owner.source_path.trim().is_empty() {
                return true;
            }
            return same_source_path(&owner.source_path, source_path);
        }
    }
    true
}

/// 比较两个源文件路径是否指向同一个文件（大小写与分隔符不敏感）。
fn same_source_path(left: &str, right: &str) -> bool {
    let normalize = |value: &str| value.replace('/', "\\").trim_end_matches('\\').to_lowercase();
    normalize(left) == normalize(right)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workspace_names_use_64_bit_hash() {
        let a = workspace_dir_name("D:/game1/FunnyGameTranslations.json");
        let b = workspace_dir_name("D:/game2/FunnyGameTranslations.json");
        assert_ne!(a, b);
        assert!(a.starts_with("FunnyGameTranslations-"));
        let hash = a.rsplit('-').next().unwrap();
        assert_eq!(hash.len(), 16);
        // 旧版命名仍可复现，用于兼容已存在的工作区
        let legacy = workspace_dir_name_legacy("D:/game1/FunnyGameTranslations.json");
        assert_eq!(legacy.rsplit('-').next().unwrap().len(), 8);
        assert_eq!(path_hash_full("x").len(), 64);
    }

    #[test]
    fn workspace_owner_detects_hash_collision() {
        let dir = std::env::temp_dir().join(format!("fgpt-ws-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("meta.json"),
            r#"{"sourcePath":"D:/games/A/FunnyGameTranslations.json"}"#,
        )
        .unwrap();

        assert!(workspace_belongs_to(
            &dir,
            "D:/games/A/FunnyGameTranslations.json"
        ));
        // Windows 路径大小写、分隔符不敏感
        assert!(workspace_belongs_to(
            &dir,
            "d:\\games\\a\\FunnyGameTranslations.JSON"
        ));
        // 不同源文件 → 判定为冲突
        assert!(!workspace_belongs_to(
            &dir,
            "D:/games/B/FunnyGameTranslations.json"
        ));

        let _ = std::fs::remove_dir_all(&dir);
    }

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
