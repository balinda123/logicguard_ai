use std::{
    collections::HashMap,
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::Command,
    sync::{Mutex, OnceLock},
    time::Duration,
};

use tauri::{command, Manager};

fn dedicated_browser_processes() -> &'static Mutex<HashMap<u16, u32>> {
    static PROCESSES: OnceLock<Mutex<HashMap<u16, u32>>> = OnceLock::new();
    PROCESSES.get_or_init(|| Mutex::new(HashMap::new()))
}

pub(crate) fn dedicated_browser_pid(port: u16) -> Option<u32> {
    if let Some(pid) = dedicated_browser_processes().lock().ok()?.get(&port).copied() {
        return Some(pid);
    }
    let pid = listening_process_pid(port)?;
    if !is_supported_browser_process(pid) {
        return None;
    }
    dedicated_browser_processes().lock().ok()?.insert(port, pid);
    Some(pid)
}

pub(crate) fn ensure_dedicated_browser(app: &tauri::AppHandle, port: u16) -> Result<u32, String> {
    if let Some(pid) = dedicated_browser_pid(port) {
        return Ok(pid);
    }
    launch_chrome_cdp(app.clone(), Some(port), None)?;
    dedicated_browser_pid(port).ok_or_else(|| "BROWSER_PROCESS_REGISTRY_UNAVAILABLE".to_string())
}

#[cfg(target_os = "windows")]
fn listening_process_pid(port: u16) -> Option<u32> {
    use std::{ffi::c_void, mem::size_of};
    use windows_sys::Win32::{
        Foundation::{ERROR_INSUFFICIENT_BUFFER, NO_ERROR},
        NetworkManagement::IpHelper::{
            GetExtendedTcpTable, MIB_TCPROW_OWNER_PID, MIB_TCPTABLE_OWNER_PID,
            TCP_TABLE_OWNER_PID_LISTENER,
        },
        Networking::WinSock::AF_INET,
    };

    let mut size = 0u32;
    let first = unsafe {
        GetExtendedTcpTable(
            std::ptr::null_mut(), &mut size, 0, AF_INET as u32,
            TCP_TABLE_OWNER_PID_LISTENER, 0,
        )
    };
    if first != ERROR_INSUFFICIENT_BUFFER || size < size_of::<MIB_TCPTABLE_OWNER_PID>() as u32 {
        return None;
    }
    let mut buffer = vec![0u8; size as usize];
    if unsafe {
        GetExtendedTcpTable(
            buffer.as_mut_ptr().cast::<c_void>(), &mut size, 0, AF_INET as u32,
            TCP_TABLE_OWNER_PID_LISTENER, 0,
        )
    } != NO_ERROR {
        return None;
    }
    let table = unsafe { &*(buffer.as_ptr().cast::<MIB_TCPTABLE_OWNER_PID>()) };
    let rows = table.table.as_ptr().cast::<MIB_TCPROW_OWNER_PID>();
    (0..table.dwNumEntries).find_map(|index| {
        let row = unsafe { &*rows.add(index as usize) };
        (u16::from_be(row.dwLocalPort as u16) == port).then_some(row.dwOwningPid)
    })
}

#[cfg(not(target_os = "windows"))]
fn listening_process_pid(_port: u16) -> Option<u32> { None }

#[cfg(target_os = "windows")]
fn is_supported_browser_process(pid: u32) -> bool {
    use windows_sys::Win32::{
        Foundation::CloseHandle,
        System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION},
    };

    let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if process.is_null() {
        return false;
    }
    let mut path = vec![0u16; 32_768];
    let mut length = path.len() as u32;
    let queried = unsafe { QueryFullProcessImageNameW(process, 0, path.as_mut_ptr(), &mut length) } != 0;
    unsafe { CloseHandle(process) };
    if !queried {
        return false;
    }
    let executable = String::from_utf16_lossy(&path[..length as usize]).to_ascii_lowercase();
    executable.ends_with("\\chrome.exe") || executable.ends_with("\\msedge.exe")
}

#[cfg(not(target_os = "windows"))]
fn is_supported_browser_process(_pid: u32) -> bool { false }

pub(crate) fn runtime_assets() -> Result<(PathBuf, PathBuf), String> {
    let node_name = if cfg!(target_os = "windows") { "node.exe" } else { "node" };
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let executable_dir = executable.parent().ok_or("APP_EXECUTABLE_DIRECTORY_UNAVAILABLE")?;
    let mut roots = vec![executable_dir.join("resources"), executable_dir.to_path_buf()];
    if let Some(contents) = executable_dir.parent() {
        roots.push(contents.join("Resources").join("resources"));
    }
    roots.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources"));
    roots.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("sidecar-runtime"));

    for root in roots {
        let node = root.join("runtime").join(node_name);
        let sidecar = root.join("sidecar").join("index.js");
        if node.is_file() && sidecar.is_file() {
            return Ok((node, sidecar));
        }
    }

    let development_sidecar = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("sidecar")
        .join("index.js");
    if cfg!(debug_assertions) && development_sidecar.is_file() {
        return Ok((PathBuf::from(node_name), development_sidecar));
    }
    Err("SIDECAR_RESOURCE_MISSING".to_string())
}

#[command]
pub fn browser_check_sidecar() -> Result<bool, String> {
    runtime_assets().map(|(node, sidecar)| node.exists() && sidecar.exists())
}

fn cdp_address(port: u16) -> Result<SocketAddr, String> {
    format!("127.0.0.1:{port}").parse().map_err(|error| format!("INVALID_CDP_PORT: {error}"))
}

#[command]
pub fn browser_check_connection(port: Option<u16>) -> Result<bool, String> {
    Ok(TcpStream::connect_timeout(&cdp_address(port.unwrap_or(9222))?, Duration::from_secs(2)).is_ok())
}

#[cfg(target_os = "windows")]
fn chrome_candidates() -> Vec<String> {
    let user_profile = std::env::var("USERPROFILE").unwrap_or_default();
    vec![
        r"C:\Program Files\Google\Chrome\Application\chrome.exe".to_string(),
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe".to_string(),
        format!(r"{user_profile}\AppData\Local\Google\Chrome\Application\chrome.exe"),
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe".to_string(),
    ]
}

#[cfg(target_os = "macos")]
fn chrome_candidates() -> Vec<String> {
    vec![
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome".to_string(),
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge".to_string(),
    ]
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn chrome_candidates() -> Vec<String> {
    vec!["/usr/bin/google-chrome".to_string(), "/usr/bin/chromium".to_string()]
}

fn find_chrome_path() -> Option<String> {
    chrome_candidates().into_iter().find(|path| Path::new(path).is_file())
}

#[command]
pub fn launch_chrome_cdp(
    app: tauri::AppHandle,
    port: Option<u16>,
    user_data_dir: Option<String>,
) -> Result<String, String> {
    let port = port.unwrap_or(9222);
    if TcpStream::connect_timeout(&cdp_address(port)?, Duration::from_millis(500)).is_ok() {
        return if dedicated_browser_pid(port).is_some() {
            Ok(format!("DEDICATED_BROWSER_ALREADY_RUNNING:{port}"))
        } else {
            Err("BROWSER_NOT_DEDICATED".to_string())
        };
    }

    let chrome_path = find_chrome_path().ok_or("CHROME_NOT_FOUND")?;
    let profile = user_data_dir.map(PathBuf::from).unwrap_or_else(|| {
        app.path()
            .app_data_dir()
            .unwrap_or_else(|_| std::env::temp_dir().join("LogicGuardAI"))
            .join("ChromeProfile")
    });
    std::fs::create_dir_all(&profile).map_err(|error| format!("BROWSER_PROFILE_CREATE_FAILED: {error}"))?;

    let mut child = Command::new(&chrome_path)
        .args([
            format!("--remote-debugging-port={port}"),
            format!("--user-data-dir={}", profile.display()),
            "--no-first-run".to_string(),
            "--no-default-browser-check".to_string(),
            "--disable-features=TranslateUI".to_string(),
            "about:blank".to_string(),
        ])
        .spawn()
        .map_err(|error| format!("BROWSER_LAUNCH_FAILED: {error}"))?;
    let pid = child.id();
    std::thread::sleep(Duration::from_secs(1));
    if child.try_wait().map_err(|error| error.to_string())?.is_some() {
        return Err("BROWSER_PROCESS_EXITED".to_string());
    }
    dedicated_browser_processes()
        .lock()
        .map_err(|_| "BROWSER_PROCESS_REGISTRY_UNAVAILABLE".to_string())?
        .insert(port, pid);

    Ok(format!("DEDICATED_BROWSER_STARTED:{port}:{}", profile.display()))
}

#[command]
pub fn get_chrome_path() -> Result<String, String> {
    find_chrome_path().ok_or("CHROME_NOT_FOUND".to_string())
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::listening_process_pid;
    use std::net::TcpListener;

    #[test]
    fn recovers_the_owner_of_a_listening_port() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        assert_eq!(listening_process_pid(port), Some(std::process::id()));
    }
}
