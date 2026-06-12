use std::sync::Mutex;
use tauri::{Manager, Emitter};

mod commands;

/// 存储深链接回调参数（OAuth 回调 URL）
pub struct DeepLinkState(Mutex<Option<String>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(DeepLinkState(Mutex::new(None)))
        .setup(|app| {
            // 单实例插件：防止协议回调时打开第二个窗口（仅桌面端）
            #[cfg(desktop)]
            let _ = app.handle().plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
                println!("[Tauri] 单实例收到外部启动参数: {:?}", args);
                for arg in &args {
                    if arg.starts_with("dynamic://") || arg.starts_with("com.zhaishis.dynamic://") {
                        println!("[Tauri] 收到深链接回调: {}", arg);
                        if let Some(state) = app.try_state::<DeepLinkState>() {
                            *state.0.lock().unwrap() = Some(arg.clone());
                            // 通知前端
                            app.emit("deep-link-received", arg).ok();
                        }
                    }
                }
            }));

            // 首次启动时检查命令行参数中的深链接
            let args: Vec<String> = std::env::args().collect();
            for arg in &args {
                if arg.starts_with("dynamic://") || arg.starts_with("com.zhaishis.dynamic://") {
                    println!("[Tauri] 启动参数中发现深链接: {}", arg);
                    if let Some(state) = app.try_state::<DeepLinkState>() {
                        *state.0.lock().unwrap() = Some(arg.clone());
                        app.emit("deep-link-received", arg).ok();
                    }
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_deep_link_url,
            commands::clear_deep_link_url,
            commands::set_deep_link_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
