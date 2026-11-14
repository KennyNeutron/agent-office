// Agent Office desktop shell.
//
// The office itself is unchanged: its local Express API (server/index.mjs) runs on a
// bundled Node.js sidecar bound to 127.0.0.1 on a free port, and the window loads the
// office from it. Every store (tasks, agents, schedules, chats, office project,
// interface settings and the team knowledge base) is written to this app's data
// directory on this computer, e.g. ~/.local/share/dev.agentoffice.desktop on Linux.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs::{self, File},
    net::{SocketAddr, TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, RunEvent, Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

const STARTUP_TIMEOUT: Duration = Duration::from_secs(45);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(12);

/// The running office process.
struct Office(Mutex<Option<Child>>);

fn main() {
    tauri::Builder::default()
        // A second launch focuses the open window instead of starting another office
        // on the same data directory.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .manage(Office(Mutex::new(None)))
        .setup(|app| {
            let handle = app.handle().clone();
            let port = free_port()?;
            let office = format!("http://127.0.0.1:{port}/");
            let opener = handle.clone();
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Agent Office")
                .inner_size(1440.0, 900.0)
                .min_inner_size(960.0, 640.0)
                .center()
                .on_navigation(move |url| {
                    if is_internal(url, port) {
                        return true;
                    }
                    // Links to the web open in the default browser, not inside the office.
                    if matches!(url.scheme(), "http" | "https" | "mailto") {
                        let _ = opener.opener().open_url(url.as_str(), None::<&str>);
                    }
                    false
                })
                .build()?;
            thread::spawn(move || {
                let result = launch_office(&handle, port);
                let Some(window) = handle.get_webview_window("main") else { return };
                match result.and_then(|_| Url::parse(&office).map_err(|error| error.to_string())) {
                    Ok(url) => { let _ = window.navigate(url); }
                    Err(message) => {
                        let script = format!("window.showStartupError({})", serde_json::to_string(&message).unwrap_or_default());
                        let _ = window.eval(&script);
                    }
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("could not build Agent Office")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                stop_office(app);
            }
        });
}

fn is_internal(url: &Url, port: u16) -> bool {
    match url.scheme() {
        "tauri" | "about" | "data" | "blob" => true,
        // Windows and Android serve app pages from http(s)://tauri.localhost.
        "http" | "https" if url.host_str() == Some("tauri.localhost") => true,
        "http" => url.host_str() == Some("127.0.0.1") && url.port() == Some(port),
        _ => false,
    }
}

fn free_port() -> std::io::Result<u16> {
    Ok(TcpListener::bind("127.0.0.1:0")?.local_addr()?.port())
}

/// Starts the office and waits until it accepts connections.
fn launch_office(app: &AppHandle, port: u16) -> Result<(), String> {
    let paths = app.path();
    let resources = plain_path(paths.resource_dir().map_err(|e| e.to_string())?.join("app"));
    let entry = resources.join("server").join("index.mjs");
    let data = paths.app_data_dir().map_err(|e| e.to_string())?;
    let logs = paths.app_log_dir().map_err(|e| e.to_string())?;
    let log_path = logs.join("office.log");
    if !entry.is_file() {
        return Err(format!("The office files are missing from {}. Reinstall Agent Office.", resources.display()));
    }
    fs::create_dir_all(&data).map_err(|e| format!("Could not create the data folder {}: {e}", data.display()))?;
    fs::create_dir_all(&logs).map_err(|e| format!("Could not create the log folder {}: {e}", logs.display()))?;
    let log = File::create(&log_path).map_err(|e| format!("Could not create {}: {e}", log_path.display()))?;
    let log_err = log.try_clone().map_err(|e| e.to_string())?;
    let home = paths.home_dir().map_err(|e| e.to_string())?;

    let mut command = Command::new(sidecar("agent-office-node"));
    command
        .arg(&entry)
        .current_dir(&resources)
        .env("PORT", port.to_string())
        .env("NODE_ENV", "production")
        .env("AGENT_OFFICE_DESKTOP", "1")
        .env("AGENT_OFFICE_DATA_DIR", &data)
        // Default project folder until one is chosen in the office's project picker.
        .env("AGENT_OFFICE_WORKSPACE", &home)
        .env("PATH", agent_path(&home))
        // The office stops when this pipe closes, even if the app is killed.
        .stdin(Stdio::piped())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log_err));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let child = command.spawn().map_err(|e| format!("Could not start the bundled Node.js runtime: {e}"))?;
    *app.state::<Office>().0.lock().unwrap() = Some(child);

    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let deadline = Instant::now() + STARTUP_TIMEOUT;
    loop {
        if TcpStream::connect_timeout(&address, Duration::from_millis(250)).is_ok() {
            return Ok(());
        }
        if let Some(child) = app.state::<Office>().0.lock().unwrap().as_mut() {
            if let Ok(Some(status)) = child.try_wait() {
                let reason = fs::read_to_string(&log_path).ok()
                    .and_then(|log| log.lines().rev().find(|line| line.contains("Could not start")).map(str::to_owned));
                return Err(match reason {
                    Some(line) => line.replace("Could not start Agent Office: ", ""),
                    None => format!("The local office stopped ({status}). Details are in {}.", log_path.display()),
                });
            }
        }
        if Instant::now() > deadline {
            return Err(format!("The local office did not start in time. Details are in {}.", log_path.display()));
        }
        thread::sleep(Duration::from_millis(150));
    }
}

/// Closes the office's stdin so it stops agent processes and saves its stores, then
/// waits for it, forcing it to stop only if it does not finish in time.
fn stop_office(app: &AppHandle) {
    let Some(mut child) = app.state::<Office>().0.lock().unwrap().take() else { return };
    drop(child.stdin.take());
    let deadline = Instant::now() + SHUTDOWN_TIMEOUT;
    while Instant::now() < deadline {
        if !matches!(child.try_wait(), Ok(None)) {
            return;
        }
        thread::sleep(Duration::from_millis(100));
    }
    let _ = child.kill();
    let _ = child.wait();
}

/// Tauri installs sidecars next to the app's own executable, without the target triple.
fn sidecar(name: &str) -> PathBuf {
    let exe = std::env::current_exe().unwrap_or_default();
    exe.parent().unwrap_or(Path::new(".")).join(format!("{name}{}", std::env::consts::EXE_SUFFIX))
}

/// Node.js does not accept every Windows verbatim (\\?\) path as a script path.
fn plain_path(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy();
    match text.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with("UNC\\") => PathBuf::from(rest),
        _ => path,
    }
}

/// The PATH the office uses to find the Codex, Claude Code and Antigravity CLIs.
/// Apps opened from a desktop launcher do not read the user's shell profile, so on
/// Linux and macOS the login shell's PATH (nvm, Homebrew, ~/.local/bin…) is added.
fn agent_path(home: &Path) -> std::ffi::OsString {
    let mut folders: Vec<PathBuf> = Vec::new();
    #[cfg(unix)]
    {
        if let Some(login) = login_shell_path() {
            folders.extend(std::env::split_paths(&login));
        }
    }
    if let Some(current) = std::env::var_os("PATH") {
        folders.extend(std::env::split_paths(&current));
    }
    #[cfg(unix)]
    {
        for extra in [".local/bin", ".npm-global/bin", ".bun/bin", ".cargo/bin"] {
            folders.push(home.join(extra));
        }
        for extra in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"] {
            folders.push(PathBuf::from(extra));
        }
    }
    #[cfg(not(unix))]
    let _ = home;
    let mut unique: Vec<PathBuf> = Vec::new();
    for folder in folders {
        if !folder.as_os_str().is_empty() && !unique.contains(&folder) {
            unique.push(folder);
        }
    }
    std::env::join_paths(unique).unwrap_or_else(|_| std::env::var_os("PATH").unwrap_or_default())
}

#[cfg(unix)]
fn login_shell_path() -> Option<String> {
    use std::sync::mpsc;
    const MARK: &str = "__AGENT_OFFICE_PATH__";
    let shell = std::env::var("SHELL").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| "/bin/sh".into());
    let (send, receive) = mpsc::channel();
    thread::spawn(move || {
        // Interactive too: nvm and similar tools are usually set up in ~/.bashrc or ~/.zshrc.
        let output = Command::new(&shell)
            .args(["-ilc", &format!("printf '{MARK}%s{MARK}' \"$PATH\"")])
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output();
        let _ = send.send(output);
    });
    let output = receive.recv_timeout(Duration::from_secs(5)).ok()?.ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    let value = text.split(MARK).nth(1)?.trim();
    // fish prints its PATH list separated by spaces.
    let value = if value.contains(':') { value.to_string() } else { value.replace(' ', ":") };
    (!value.is_empty()).then_some(value)
}
