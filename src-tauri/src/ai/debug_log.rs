//! debug 构建下的 AI 请求日志：以附加方式写入当前项目工作区的 `debug.log`。
//!
//! 日志不会输出到控制台；release 编译时这些函数是空实现，不产生任何输出。

use std::path::Path;

#[cfg(debug_assertions)]
mod imp {
    use std::fs::OpenOptions;
    use std::io::Write;
    use std::path::{Path, PathBuf};
    use std::sync::{Mutex, RwLock};

    /// 单个日志文件的大小上限：20MB。
    const MAX_LOG_BYTES: u64 = 20 * 1024 * 1024;
    /// 历史日志最多保留的份数（debug.1.log ~ debug.3.log）。
    const MAX_BACKUPS: u8 = 3;

    static LOG_PATH: RwLock<Option<PathBuf>> = RwLock::new(None);
    // 并发请求可能同时写日志，这里串行化文件追加
    static WRITE_LOCK: Mutex<()> = Mutex::new(());

    /// 记录当前项目的工作区目录，之后 AI 请求日志会写入其中的 `debug.log`。
    pub fn set_workspace(workspace: &Path) {
        if let Ok(mut guard) = LOG_PATH.write() {
            *guard = Some(workspace.join("debug.log"));
        }
    }

    /// 追加一条带日期时间的日志（不覆盖已有内容）。
    pub fn log_block(block: &str) {
        let path = match LOG_PATH.read() {
            Ok(guard) => guard.clone(),
            Err(poisoned) => poisoned.into_inner().clone(),
        };
        let Some(path) = path else {
            return;
        };

        let entry = format!("[{}] {block}\n\n", timestamp());

        let _guard = match WRITE_LOCK.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        // 写入后超过 20MB 就先轮转：debug.log → debug.1.log → debug.2.log → debug.3.log（旧的丢弃）
        if let Ok(meta) = std::fs::metadata(&path) {
            if meta.len() > 0 && meta.len() + entry.len() as u64 > MAX_LOG_BYTES {
                rotate(&path);
            }
        }

        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
            let _ = file.write_all(entry.as_bytes());
            let _ = file.flush();
        }
    }

    /// 轮转日志文件：删除最旧的一份，其余依次后移，当前文件改名为 debug.1.log。
    fn rotate(path: &Path) {
        let Some(dir) = path.parent() else {
            return;
        };
        let backup = |index: u8| dir.join(format!("debug.{index}.log"));

        let _ = std::fs::remove_file(backup(MAX_BACKUPS));
        for index in (1..MAX_BACKUPS).rev() {
            let from = backup(index);
            if from.exists() {
                let _ = std::fs::rename(&from, backup(index + 1));
            }
        }
        let _ = std::fs::rename(path, backup(1));
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn rotate_shifts_backups_and_drops_oldest() {
            let dir = std::env::temp_dir().join(format!("fgpt-log-test-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).unwrap();
            let path = dir.join("debug.log");
            std::fs::write(&path, "current").unwrap();
            std::fs::write(dir.join("debug.1.log"), "one").unwrap();
            std::fs::write(dir.join("debug.2.log"), "two").unwrap();
            std::fs::write(dir.join("debug.3.log"), "three").unwrap();

            rotate(&path);

            assert!(!path.exists());
            assert_eq!(
                std::fs::read_to_string(dir.join("debug.1.log")).unwrap(),
                "current"
            );
            assert_eq!(
                std::fs::read_to_string(dir.join("debug.2.log")).unwrap(),
                "one"
            );
            assert_eq!(
                std::fs::read_to_string(dir.join("debug.3.log")).unwrap(),
                "two"
            );
            let _ = std::fs::remove_dir_all(&dir);
        }
    }

    /// 本地时间，精确到毫秒：`2026-10-19 11:02:33.123`。
    fn timestamp() -> String {
        chrono::Local::now()
            .format("%Y-%m-%d %H:%M:%S%.3f")
            .to_string()
    }
}

/// 记录当前项目的工作区目录（release 下为空实现）。
#[cfg(debug_assertions)]
pub fn set_workspace(workspace: &Path) {
    imp::set_workspace(workspace);
}

#[cfg(not(debug_assertions))]
pub fn set_workspace(_workspace: &Path) {}

/// 追加一条日志（release 下为空实现）。
#[cfg(debug_assertions)]
pub fn log_block(block: &str) {
    imp::log_block(block);
}

#[cfg(not(debug_assertions))]
#[allow(dead_code)]
pub fn log_block(_block: &str) {}
