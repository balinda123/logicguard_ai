use std::sync::{Arc, Mutex};
use uuid::Uuid;

pub const LOCK_UNAVAILABLE: &str = "BROWSER_INTERACTION_LOCK_UNAVAILABLE";
pub(crate) type WindowHandle = isize;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GuardLease {
    owner_run_id: String,
    browser_pid: u32,
    token: String,
}

impl GuardLease {
    pub fn owner_run_id(&self) -> &str {
        &self.owner_run_id
    }

    pub fn browser_pid(&self) -> u32 {
        self.browser_pid
    }
}

pub trait InteractionGuard: Send + Sync {
    fn acquire(&self, run_id: &str, browser_pid: u32) -> Result<GuardLease, String>;
    fn release(&self, lease: &GuardLease) -> Result<(), String>;
    fn force_release_stale(&self) -> Result<(), String>;
}

pub(crate) trait WindowAdapter: Send + Sync {
    fn top_level_windows(&self, pid: u32) -> Result<Vec<WindowHandle>, String>;
    fn set_enabled(&self, hwnd: WindowHandle, enabled: bool) -> Result<(), String>;
}

#[derive(Clone)]
struct ActiveLease {
    lease: GuardLease,
    windows: Vec<WindowHandle>,
}

pub(crate) struct PidWindowGuard<A: WindowAdapter> {
    adapter: A,
    active: Mutex<Option<ActiveLease>>,
}

impl<A: WindowAdapter> PidWindowGuard<A> {
    pub(crate) fn new(adapter: A) -> Self {
        Self {
            adapter,
            active: Mutex::new(None),
        }
    }

    fn restore(&self, windows: &[WindowHandle]) -> Result<(), String> {
        let mut failed = false;
        for hwnd in windows {
            if self.adapter.set_enabled(*hwnd, true).is_err() {
                failed = true;
            }
        }
        if failed {
            Err(LOCK_UNAVAILABLE.to_string())
        } else {
            Ok(())
        }
    }
}

impl<A: WindowAdapter> InteractionGuard for PidWindowGuard<A> {
    fn acquire(&self, run_id: &str, browser_pid: u32) -> Result<GuardLease, String> {
        if run_id.trim().is_empty() || browser_pid == 0 {
            return Err(LOCK_UNAVAILABLE.to_string());
        }
        let mut active = self.active.lock().map_err(|_| LOCK_UNAVAILABLE.to_string())?;
        if let Some(existing) = active.as_ref() {
            if existing.lease.owner_run_id == run_id && existing.lease.browser_pid == browser_pid {
                return Ok(existing.lease.clone());
            }
            return Err(LOCK_UNAVAILABLE.to_string());
        }

        let windows = self
            .adapter
            .top_level_windows(browser_pid)
            .map_err(|_| LOCK_UNAVAILABLE.to_string())?;
        if windows.is_empty() {
            return Err(LOCK_UNAVAILABLE.to_string());
        }
        let mut disabled = Vec::with_capacity(windows.len());
        for hwnd in &windows {
            if self.adapter.set_enabled(*hwnd, false).is_err() {
                let _ = self.restore(&disabled);
                return Err(LOCK_UNAVAILABLE.to_string());
            }
            disabled.push(*hwnd);
        }

        let lease = GuardLease {
            owner_run_id: run_id.to_string(),
            browser_pid,
            token: Uuid::new_v4().to_string(),
        };
        *active = Some(ActiveLease {
            lease: lease.clone(),
            windows,
        });
        Ok(lease)
    }

    fn release(&self, lease: &GuardLease) -> Result<(), String> {
        let mut active = self.active.lock().map_err(|_| LOCK_UNAVAILABLE.to_string())?;
        let Some(existing) = active.as_ref() else {
            return Ok(());
        };
        if existing.lease.token != lease.token
            || existing.lease.owner_run_id != lease.owner_run_id
            || existing.lease.browser_pid != lease.browser_pid
        {
            return Ok(());
        }
        let windows = existing.windows.clone();
        let result = self.restore(&windows);
        if result.is_ok() {
            *active = None;
        }
        result
    }

    fn force_release_stale(&self) -> Result<(), String> {
        let mut active = self.active.lock().map_err(|_| LOCK_UNAVAILABLE.to_string())?;
        let Some(existing) = active.as_ref() else {
            return Ok(());
        };
        let windows = existing.windows.clone();
        let result = self.restore(&windows);
        if result.is_ok() {
            *active = None;
        }
        result
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use super::{PidWindowGuard, WindowAdapter, WindowHandle, LOCK_UNAVAILABLE};
    use std::sync::Arc;
    use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnableWindow, EnumWindows, GetWindowThreadProcessId, IsWindow, IsWindowEnabled,
        IsWindowVisible,
    };

    #[derive(Clone, Copy)]
    pub(crate) struct WindowsApi;

    struct Enumeration {
        pid: u32,
        windows: Vec<WindowHandle>,
    }

    unsafe extern "system" fn enum_window(hwnd: HWND, parameter: LPARAM) -> BOOL {
        let state = &mut *(parameter as *mut Enumeration);
        let mut owner_pid = 0;
        GetWindowThreadProcessId(hwnd, &mut owner_pid);
        if owner_pid == state.pid && IsWindowVisible(hwnd) != 0 {
            state.windows.push(hwnd as WindowHandle);
        }
        1
    }

    impl WindowAdapter for WindowsApi {
        fn top_level_windows(&self, pid: u32) -> Result<Vec<WindowHandle>, String> {
            let mut state = Enumeration {
                pid,
                windows: Vec::new(),
            };
            let enumerated = unsafe {
                EnumWindows(
                    Some(enum_window),
                    (&mut state as *mut Enumeration) as LPARAM,
                )
            };
            if enumerated == 0 {
                return Err(LOCK_UNAVAILABLE.to_string());
            }
            Ok(state.windows)
        }

        fn set_enabled(&self, hwnd: WindowHandle, enabled: bool) -> Result<(), String> {
            let hwnd = hwnd as HWND;
            if unsafe { IsWindow(hwnd) } == 0 {
                return Err(LOCK_UNAVAILABLE.to_string());
            }
            unsafe { EnableWindow(hwnd, enabled as i32) };
            if (unsafe { IsWindowEnabled(hwnd) } != 0) != enabled {
                return Err(LOCK_UNAVAILABLE.to_string());
            }
            Ok(())
        }
    }

    pub(crate) fn guard() -> Arc<dyn super::InteractionGuard> {
        Arc::new(PidWindowGuard::new(WindowsApi))
    }
}

#[cfg(not(target_os = "windows"))]
#[derive(Default)]
struct UnsupportedGuard;

#[cfg(not(target_os = "windows"))]
impl InteractionGuard for UnsupportedGuard {
    fn acquire(&self, _run_id: &str, _browser_pid: u32) -> Result<GuardLease, String> {
        Err(LOCK_UNAVAILABLE.to_string())
    }

    fn release(&self, _lease: &GuardLease) -> Result<(), String> {
        Ok(())
    }

    fn force_release_stale(&self) -> Result<(), String> {
        Ok(())
    }
}

pub fn platform_guard() -> Arc<dyn InteractionGuard> {
    #[cfg(target_os = "windows")]
    {
        platform::guard()
    }
    #[cfg(not(target_os = "windows"))]
    {
        Arc::new(UnsupportedGuard)
    }
}
