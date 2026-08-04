use super::interaction_guard::*;
use std::sync::{Arc, Mutex};

#[derive(Clone, Default)]
struct FakeWindows {
    windows: Arc<Mutex<Vec<(u32, WindowHandle, bool)>>>,
}

impl FakeWindows {
    fn with_windows(windows: &[(u32, WindowHandle)]) -> Self {
        Self {
            windows: Arc::new(Mutex::new(
                windows.iter().map(|(pid, hwnd)| (*pid, *hwnd, true)).collect(),
            )),
        }
    }

    fn enabled(&self, hwnd: WindowHandle) -> bool {
        self.windows
            .lock()
            .unwrap()
            .iter()
            .find(|(_, candidate, _)| *candidate == hwnd)
            .unwrap()
            .2
    }
}

impl WindowAdapter for FakeWindows {
    fn top_level_windows(&self, pid: u32) -> Result<Vec<WindowHandle>, String> {
        Ok(self
            .windows
            .lock()
            .unwrap()
            .iter()
            .filter_map(|(owner, hwnd, _)| (*owner == pid).then_some(*hwnd))
            .collect())
    }

    fn set_enabled(&self, hwnd: WindowHandle, enabled: bool) -> Result<(), String> {
        let mut windows = self.windows.lock().unwrap();
        let entry = windows
            .iter_mut()
            .find(|(_, candidate, _)| *candidate == hwnd)
            .ok_or_else(|| "WINDOW_NOT_FOUND".to_string())?;
        entry.2 = enabled;
        Ok(())
    }
}

#[test]
fn lease_has_one_owner_and_release_is_idempotent() {
    let windows = FakeWindows::with_windows(&[(101, 1)]);
    let guard = PidWindowGuard::new(windows.clone());
    let lease = guard.acquire("run-a", 101).unwrap();

    assert!(!windows.enabled(1));
    assert_eq!(lease.owner_run_id(), "run-a");
    assert_eq!(lease.browser_pid(), 101);
    assert_eq!(guard.acquire("run-b", 101).unwrap_err(), LOCK_UNAVAILABLE);

    guard.release(&lease).unwrap();
    guard.release(&lease).unwrap();
    assert!(windows.enabled(1));
    assert!(guard.acquire("run-b", 101).is_ok());
}

#[test]
fn wrong_pid_never_disables_another_process_window() {
    let windows = FakeWindows::with_windows(&[(101, 1), (202, 2)]);
    let guard = PidWindowGuard::new(windows.clone());

    assert_eq!(guard.acquire("run-a", 303).unwrap_err(), LOCK_UNAVAILABLE);
    assert!(windows.enabled(1));
    assert!(windows.enabled(2));
}

#[test]
fn stale_recovery_reenables_only_the_recorded_windows() {
    let windows = FakeWindows::with_windows(&[(101, 1), (202, 2)]);
    let guard = PidWindowGuard::new(windows.clone());
    guard.acquire("run-a", 101).unwrap();

    guard.force_release_stale().unwrap();

    assert!(windows.enabled(1));
    assert!(windows.enabled(2));
    guard.force_release_stale().unwrap();
}
