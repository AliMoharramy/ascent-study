#![cfg_attr(windows, windows_subsystem = "windows")]

mod api;
mod credentials;
mod settings;

slint::include_modules!();

use api::{ApiClient, ApiError, FocusSession, TaskSource, WidgetTask};
use credentials::SessionCredential;
use slint::{ModelRc, VecModel};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use uuid::Uuid;
use windows_sys::Win32::System::SystemInformation::GetTickCount;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};

#[derive(Default)]
struct AppState {
    server_url: String,
    credential: Option<SessionCredential>,
    focus: Option<FocusSession>,
    idle_prompt_started: Option<Instant>,
    selected_task: Option<WidgetTask>,
    tasks: Vec<WidgetTask>,
    pending_task_creation: Option<PendingTaskCreation>,
    pending_task_completions: HashMap<String, String>,
    last_refresh_error: Option<String>,
}

struct PendingTaskCreation {
    title: String,
    request_id: String,
}

#[derive(Clone, Copy)]
enum TaskCreateEffect {
    Manual,
    Suggestion,
}

type SharedState = Arc<Mutex<AppState>>;

fn format_time(total_seconds: i32) -> String {
    let safe = total_seconds.max(0);
    let hours = safe / 3600;
    let minutes = (safe % 3600) / 60;
    let seconds = safe % 60;
    if hours > 0 {
        format!("{hours}:{minutes:02}:{seconds:02}")
    } else {
        format!("{minutes:02}:{seconds:02}")
    }
}

fn session_elapsed_seconds(session: &FocusSession) -> i32 {
    (session.elapsed_ms.max(0) / 1000) as i32
}

fn system_idle_duration() -> Option<Duration> {
    let mut input = LASTINPUTINFO {
        cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
        dwTime: 0,
    };
    if unsafe { GetLastInputInfo(&mut input) } == 0 {
        return None;
    }
    let now = unsafe { GetTickCount() };
    Some(Duration::from_millis(now.wrapping_sub(input.dwTime) as u64))
}

fn apply_focus(ui: &FocusWidget, state: &SharedState, session: Option<FocusSession>) {
    let elapsed = session.as_ref().map(session_elapsed_seconds).unwrap_or(0);
    let running = session
        .as_ref()
        .is_some_and(|current| current.status == "running");
    let status = match session.as_ref() {
        Some(current) if current.status == "running" => {
            format!("{} · focus active", kind_label(&current.kind))
        }
        Some(current) => format!(
            "{} · paused · synced with Ascent",
            kind_label(&current.kind)
        ),
        None => "Ready for a focus block".to_string(),
    };
    if let Ok(mut shared) = state.lock() {
        if !running {
            shared.idle_prompt_started = None;
        }
        if let Some(current) = session.as_ref() {
            if current.task_id.is_none() {
                shared.selected_task = None;
            } else if let Some(task) = shared.tasks.iter().find(|task| {
                Some(task.id.as_str()) == current.task_id.as_deref()
                    && Some(task.source.label()) == current.task_source.as_deref()
            }) {
                shared.selected_task = Some(task.clone());
            }
        } else {
            shared.selected_task = None;
        }
        shared.focus = session.clone();
    }
    ui.set_session_active(session.is_some());
    ui.set_session_running(running);
    ui.set_idle_prompt_visible(
        running
            && state
                .lock()
                .map(|shared| shared.idle_prompt_started.is_some())
                .unwrap_or(false),
    );
    ui.set_elapsed_seconds(elapsed);
    ui.set_timer_text(format_time(elapsed).into());
    ui.set_status_text(status.into());
    ui.set_active_task_title(
        session
            .as_ref()
            .and_then(|current| current.task_title.clone())
            .unwrap_or_default()
            .into(),
    );
    if let Some(current) = session.as_ref() {
        ui.set_selected_work_kind(current.kind.clone().into());
    }
    set_task_model(ui, state, &ui.get_selected_source());
}

fn set_task_model(ui: &FocusWidget, state: &SharedState, source: &str) {
    let tasks = state
        .lock()
        .map(|state| {
            let active_key = state
                .focus
                .as_ref()
                .and_then(|focus| focus.task_source.clone().zip(focus.task_id.clone()));
            let selected_key = active_key.clone().or_else(|| {
                state
                    .selected_task
                    .as_ref()
                    .map(|task| (task.source.label().to_string(), task.id.clone()))
            });
            state
                .tasks
                .iter()
                .filter(|task| task.source.label() == source)
                .map(|task| TaskItem {
                    id: task.id.clone().into(),
                    title: task.title.clone().into(),
                    detail: task.detail.clone().into(),
                    source: task.source.label().into(),
                    done: task.done,
                    can_complete: task.can_complete,
                    active: active_key
                        .as_ref()
                        .is_some_and(|(active_source, active_id)| {
                            active_source == task.source.label() && active_id == &task.id
                        }),
                    selected: selected_key.as_ref().is_some_and(
                        |(selected_source, selected_id)| {
                            selected_source == task.source.label() && selected_id == &task.id
                        },
                    ),
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    ui.set_has_tasks(!tasks.is_empty());
    ui.set_task_content_height((tasks.len().min(i32::MAX as usize / 63) * 63) as i32);
    ui.set_tasks(ModelRc::new(VecModel::from(tasks)));
}

fn kind_label(kind: &str) -> &str {
    match kind {
        "video" => "Video",
        "tests" => "Tests",
        "review" => "Review",
        "analysis" => "Analysis",
        "forge" => "Forge",
        _ => "Other",
    }
}

fn auth_error(ui: &FocusWidget, state: &SharedState, error: &ApiError) {
    if error.unauthorized {
        let server_url = state
            .lock()
            .map(|shared| shared.server_url.clone())
            .unwrap_or_default();
        if !server_url.is_empty() {
            let _ = credentials::clear(&server_url);
        }
        if let Ok(mut shared) = state.lock() {
            shared.credential = None;
            shared.focus = None;
            shared.tasks.clear();
        }
        ui.set_signed_in(false);
        ui.set_account_status("Not connected".into());
        ui.set_has_tasks(false);
        ui.set_tasks(ModelRc::new(VecModel::from(Vec::<TaskItem>::new())));
        apply_focus(ui, state, None);
    }
    ui.set_message(error.message.clone().into());
    ui.set_busy(false);
}

fn snapshot(state: &SharedState) -> (String, Option<SessionCredential>) {
    state
        .lock()
        .map(|shared| (shared.server_url.clone(), shared.credential.clone()))
        .unwrap_or_default()
}

fn task_creation_request_id(state: &SharedState, title: &str) -> String {
    if let Ok(mut shared) = state.lock() {
        if let Some(pending) = &shared.pending_task_creation {
            if pending.title == title {
                return pending.request_id.clone();
            }
        }
        let request_id = Uuid::new_v4().to_string();
        shared.pending_task_creation = Some(PendingTaskCreation {
            title: title.to_string(),
            request_id: request_id.clone(),
        });
        return request_id;
    }
    Uuid::new_v4().to_string()
}

fn finish_task_creation(state: &SharedState, request_id: &str) {
    if let Ok(mut shared) = state.lock() {
        if shared
            .pending_task_creation
            .as_ref()
            .is_some_and(|pending| pending.request_id == request_id)
        {
            shared.pending_task_creation = None;
        }
    }
}

fn task_completion_request_id(state: &SharedState, task_id: &str) -> String {
    if let Ok(mut shared) = state.lock() {
        return shared
            .pending_task_completions
            .entry(task_id.to_string())
            .or_insert_with(|| Uuid::new_v4().to_string())
            .clone();
    }
    Uuid::new_v4().to_string()
}

fn finish_task_completion(state: &SharedState, task_id: &str, request_id: &str) {
    if let Ok(mut shared) = state.lock() {
        if shared
            .pending_task_completions
            .get(task_id)
            .is_some_and(|pending| pending == request_id)
        {
            shared.pending_task_completions.remove(task_id);
        }
    }
}

fn submit_personal_task(
    weak: slint::Weak<FocusWidget>,
    state: SharedState,
    title: String,
    request_id: String,
    effect: TaskCreateEffect,
) {
    let (server_url, credential) = snapshot(&state);
    thread::spawn(move || {
        let result = ApiClient::new(&server_url, credential)
            .map_err(|message| ApiError {
                message,
                unauthorized: false,
            })
            .and_then(|client| {
                client.create_personal_task(&title, &request_id)?;
                client.load_tasks()
            });
        let _ = slint::invoke_from_event_loop(move || {
            let Some(ui) = weak.upgrade() else {
                return;
            };
            match result {
                Ok((tasks, preferences)) => {
                    finish_task_creation(&state, &request_id);
                    if let Ok(mut shared) = state.lock() {
                        shared.tasks = tasks;
                    }
                    ui.set_share_task_titles_with_ai(preferences.share_task_titles_with_ai);
                    let success_message = match effect {
                        TaskCreateEffect::Manual => {
                            ui.set_task_title("".into());
                            "Personal task synced"
                        }
                        TaskCreateEffect::Suggestion => {
                            ui.set_has_suggestion(false);
                            ui.set_selected_source("Mine".into());
                            "Suggestion added to Mine"
                        }
                    };
                    set_task_model(&ui, &state, &ui.get_selected_source());
                    ui.set_busy(false);
                    ui.set_message(success_message.into());
                }
                Err(error) => auth_error(&ui, &state, &error),
            }
        });
    });
}

fn start_focus_action(
    weak: slint::Weak<FocusWidget>,
    state: SharedState,
    action: String,
    task: Option<WidgetTask>,
    fallback_kind: String,
) {
    let refresh_tasks_after = action == "stop";
    let (server_url, credential) = snapshot(&state);
    thread::spawn(move || {
        let result = ApiClient::new(&server_url, credential).map_err(|message| ApiError {
            message,
            unauthorized: false,
        });
        let result = result.and_then(|client| {
            match client.focus_action(&action, task.as_ref(), &fallback_kind) {
                Ok(session) => Ok((session, None)),
                Err(error) => {
                    // A lost response can happen after the server committed the transition.
                    // Read the server state before presenting the action as unsaved.
                    let reconciled = client.focus();
                    match reconciled {
                        Ok(session) => Ok((session, Some(error))),
                        Err(sync_error) if sync_error.unauthorized => Err(sync_error),
                        Err(_) => Err(error),
                    }
                }
            }
        });
        let _ = slint::invoke_from_event_loop(move || {
            let Some(ui) = weak.upgrade() else {
                return;
            };
            match result {
                Ok((session, warning)) => {
                    apply_focus(&ui, &state, session);
                    if refresh_tasks_after {
                        ui.set_busy(true);
                        ui.set_message("Refreshing tasks after the focus session…".into());
                        refresh_from_server(ui.as_weak(), state.clone(), true);
                    } else {
                        ui.set_busy(false);
                        ui.set_message(
                            warning
                                .map(|error| {
                                    format!(
                                        "Connection interrupted; state resynced. {}",
                                        error.message
                                    )
                                })
                                .unwrap_or_default()
                                .into(),
                        );
                    }
                }
                Err(error) => auth_error(&ui, &state, &error),
            }
        });
    });
}

fn refresh_from_server(weak: slint::Weak<FocusWidget>, state: SharedState, include_tasks: bool) {
    let (server_url, credential) = snapshot(&state);
    thread::spawn(move || {
        let result = ApiClient::new(&server_url, credential)
            .map_err(|message| ApiError {
                message,
                unauthorized: false,
            })
            .and_then(|client| {
                let focus = client.focus()?;
                let tasks = if include_tasks {
                    Some(client.load_tasks()?)
                } else {
                    None
                };
                Ok((focus, tasks))
            });
        let _ = slint::invoke_from_event_loop(move || {
            let Some(ui) = weak.upgrade() else {
                return;
            };
            match result {
                Ok((focus, tasks)) => {
                    clear_recovered_refresh_error(&ui, &state);
                    apply_focus(&ui, &state, focus);
                    if let Some((tasks, preferences)) = tasks {
                        if let Ok(mut shared) = state.lock() {
                            shared.tasks = tasks;
                        }
                        ui.set_share_task_titles_with_ai(preferences.share_task_titles_with_ai);
                        set_task_model(&ui, &state, &ui.get_selected_source());
                    }
                    if include_tasks {
                        ui.set_busy(false);
                        ui.set_message("".into());
                    }
                }
                Err(error) if include_tasks || error.unauthorized => {
                    if !error.unauthorized {
                        let message = refresh_error_message(&error.message);
                        remember_refresh_error(&state, &message);
                        auth_error(&ui, &state, &error);
                        ui.set_message(message.into());
                    } else {
                        auth_error(&ui, &state, &error);
                    }
                }
                Err(error) => {
                    let message = refresh_error_message(&error.message);
                    remember_refresh_error(&state, &message);
                    ui.set_message(message.into());
                }
            }
        });
    });
}

fn remember_refresh_error(state: &SharedState, message: &str) {
    if let Ok(mut shared) = state.lock() {
        shared.last_refresh_error = Some(message.to_string());
    }
}

fn refresh_error_message(message: &str) -> String {
    format!("Connection sync paused: {message}")
}

fn clear_recovered_refresh_error(ui: &FocusWidget, state: &SharedState) {
    let error = state
        .lock()
        .ok()
        .and_then(|mut shared| shared.last_refresh_error.take());
    let current_message = ui.get_message().to_string();
    if error.as_deref() == Some(current_message.as_str()) {
        ui.set_message("".into());
    }
}

#[cfg(windows)]
fn configure_windows_window(ui: &FocusWidget, saved_position: Option<(i32, i32)>) {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::Graphics::Dwm::DwmSetWindowAttribute;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, SystemParametersInfoW, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOSIZE,
        SWP_SHOWWINDOW,
    };

    let window_handle = ui.window().window_handle();
    let Ok(window_handle) = window_handle.window_handle() else {
        return;
    };
    let RawWindowHandle::Win32(handle) = window_handle.as_raw() else {
        return;
    };
    let hwnd = handle.hwnd.get() as HWND;
    unsafe {
        // Windows 11 uses the transient system backdrop for acrylic-like blur. The UI's
        // nearly opaque surface remains the contrast-safe fallback when this is unsupported.
        let backdrop_kind = 3u32; // DWMSBT_TRANSIENTWINDOW
        let backdrop_result = DwmSetWindowAttribute(
            hwnd,
            38,
            &backdrop_kind as *const _ as _,
            std::mem::size_of_val(&backdrop_kind) as u32,
        );
        if backdrop_result == 0 {
            ui.set_backdrop_supported(true);
        }

        // Restore the last dragged position, using the upper-left as the first-run default.
        let (x, y) = saved_position.unwrap_or((16, 8));
        let _ = SetWindowPos(
            hwnd,
            HWND_TOPMOST,
            x,
            y,
            0,
            0,
            SWP_NOACTIVATE | SWP_NOSIZE | SWP_SHOWWINDOW,
        );

        // Respect Windows' client-area animation preference.
        let mut animation_enabled: i32 = 1;
        if SystemParametersInfoW(0x1042, 0, &mut animation_enabled as *mut _ as _, 0) != 0
            && animation_enabled == 0
        {
            ui.global::<WidgetMotion>().set_animation_duration(0);
        }
    }
}

#[cfg(not(windows))]
fn configure_windows_window(_ui: &FocusWidget, _saved_position: Option<(i32, i32)>) {}

#[cfg(windows)]
fn begin_window_drag(ui: &FocusWidget) -> Option<(i32, i32)> {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    use windows_sys::Win32::Foundation::{HWND, RECT};
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::ReleaseCapture;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowRect, SendMessageW, HTCAPTION, WM_NCLBUTTONDOWN,
    };

    let window_handle = ui.window().window_handle();
    let Ok(window_handle) = window_handle.window_handle() else {
        return None;
    };
    let RawWindowHandle::Win32(handle) = window_handle.as_raw() else {
        return None;
    };
    let hwnd = handle.hwnd.get() as HWND;
    unsafe {
        let _ = ReleaseCapture();
        let _ = SendMessageW(hwnd, WM_NCLBUTTONDOWN, HTCAPTION as usize, 0);
        let mut rect = std::mem::zeroed::<RECT>();
        (GetWindowRect(hwnd, &mut rect) != 0).then_some((rect.left, rect.top))
    }
}

#[cfg(not(windows))]
fn begin_window_drag(_ui: &FocusWidget) -> Option<(i32, i32)> {
    None
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let ui = FocusWidget::new()?;
    let tray = FocusTray::new()?;
    let state = Arc::new(Mutex::new(AppState::default()));
    let weak = ui.as_weak();

    let stored_settings = settings::load();
    let server_url = stored_settings.server_url.trim().to_string();
    let saved_position = stored_settings.widget_x.zip(stored_settings.widget_y);
    if let Ok(mut shared) = state.lock() {
        shared.server_url = server_url.clone();
    }
    ui.set_server_url(server_url.clone().into());

    let stored_credential = if server_url.is_empty() {
        Ok(None)
    } else {
        credentials::load(&server_url)
    };
    match stored_credential {
        Ok(Some(credential)) => {
            if let Ok(mut shared) = state.lock() {
                shared.credential = Some(credential.clone());
            }
            ui.set_signed_in(true);
            ui.set_username(credential.username.clone().into());
            ui.set_account_status(credential.username.clone().into());
            ui.set_status_text("Syncing your Ascent account".into());
            ui.set_busy(true);
            refresh_from_server(weak.clone(), state.clone(), true);
        }
        Ok(None) => {
            ui.set_status_text("Sign in to sync your focus".into());
        }
        Err(message) => {
            ui.set_message(message.into());
        }
    }

    let weak = ui.as_weak();
    ui.on_login({
        let state = state.clone();
        let weak = weak.clone();
        move || {
            let Some(ui) = weak.upgrade() else { return; };
            if ui.get_busy() { return; }
            let server_url = ui.get_server_url().to_string().trim().trim_end_matches('/').to_string();
            let username = ui.get_username().to_string().trim().to_string();
            let password = ui.get_password().to_string();
            ui.set_password("".into());
            ui.set_message("".into());
            ui.set_busy(true);

            if let Err(message) = ApiClient::new(&server_url, None) {
                ui.set_busy(false);
                ui.set_message(message.into());
                return;
            }
            let mut updated_settings = settings::load();
            updated_settings.server_url = server_url.clone();
            if let Err(message) = settings::save(&updated_settings) {
                ui.set_busy(false);
                ui.set_message(message.into());
                return;
            }
            if let Ok(mut shared) = state.lock() { shared.server_url = server_url.clone(); }

            let weak = weak.clone();
            let state = state.clone();
            thread::spawn(move || {
                let signed_in = ApiClient::new(&server_url, None)
                    .map_err(|message| ApiError { message, unauthorized: false })
                    .and_then(|client| client.sign_in(&username, &password));
                let _ = slint::invoke_from_event_loop(move || {
                    let Some(ui) = weak.upgrade() else { return; };
                    match signed_in {
                        Err(error) => auth_error(&ui, &state, &error),
                        Ok(credential) => {
                            let keyring_error = credentials::save(&server_url, &credential).err();
                            if let Ok(mut shared) = state.lock() { shared.credential = Some(credential.clone()); }
                            ui.set_signed_in(true);
                            ui.set_account_status(credential.username.clone().into());
                            ui.set_username(credential.username.clone().into());
                            ui.set_password("".into());
                            ui.set_busy(true);
                            ui.set_message("Signed in · loading your tasks".into());

                            let state = state.clone();
                            let weak = ui.as_weak();
                            let server_url = server_url.clone();
                            thread::spawn(move || {
                                let client = ApiClient::new(&server_url, Some(credential.clone()))
                                    .map_err(|message| ApiError { message, unauthorized: false });
                                let result = client.and_then(|client| {
                                    let focus = client.focus()?;
                                    let tasks = client.load_tasks()?;
                                    Ok((focus, tasks))
                                });
                                let _ = slint::invoke_from_event_loop(move || {
                                    let Some(ui) = weak.upgrade() else { return; };
                                    match result {
                                        Ok((focus, (tasks, preferences))) => {
                                            if let Ok(mut shared) = state.lock() { shared.tasks = tasks; }
                                            apply_focus(&ui, &state, focus);
                                            ui.set_share_task_titles_with_ai(preferences.share_task_titles_with_ai);
                                            set_task_model(&ui, &state, &ui.get_selected_source());
                                            ui.set_busy(false);
                                            ui.set_message(keyring_error.map(|message| format!("Signed in for this run; Windows could not save the session: {message}")).unwrap_or_default().into());
                                        }
                                        Err(error) => {
                                            ui.set_busy(false);
                                            ui.set_message(keyring_error.map(|message| format!("Signed in, but the session could not be saved: {message}")).unwrap_or_else(|| error.message.clone()).into());
                                            if error.unauthorized { auth_error(&ui, &state, &error); }
                                        }
                                    }
                                });
                            });
                        }
                    }
                });
            });
        }
    });

    let weak = ui.as_weak();
    ui.on_logout({
        let state = state.clone();
        move || {
            let Some(ui) = weak.upgrade() else {
                return;
            };
            let (server_url, credential) = snapshot(&state);
            if let Ok(mut shared) = state.lock() {
                shared.credential = None;
                shared.focus = None;
                shared.tasks.clear();
            }
            if !server_url.is_empty() {
                let _ = credentials::clear(&server_url);
            }
            ui.set_signed_in(false);
            ui.set_account_status("Not connected".into());
            ui.set_has_tasks(false);
            ui.set_tasks(ModelRc::new(VecModel::from(Vec::<TaskItem>::new())));
            apply_focus(&ui, &state, None);
            ui.set_message("Signed out".into());
            if let Some(credential) = credential {
                thread::spawn(move || {
                    if let Ok(client) = ApiClient::new(&server_url, Some(credential)) {
                        let _ = client.logout();
                    }
                });
            }
        }
    });

    let weak = ui.as_weak();
    ui.on_toggle_focus({
        let state = state.clone();
        let weak = weak.clone();
        move || {
            let Some(ui) = weak.upgrade() else {
                return;
            };
            if ui.get_busy() {
                return;
            }
            let current = state.lock().ok().and_then(|shared| shared.focus.clone());
            let action = match current.as_ref() {
                Some(session) if session.status == "running" => "pause",
                Some(_) => "resume",
                None => "start",
            };
            ui.set_busy(true);
            ui.set_message("Saving focus state to Ascent…".into());
            start_focus_action(
                weak.clone(),
                state.clone(),
                action.into(),
                None,
                ui.get_selected_work_kind().to_string(),
            );
        }
    });

    let weak = ui.as_weak();
    ui.on_finish_focus({
        let state = state.clone();
        let weak = weak.clone();
        move || {
            let Some(ui) = weak.upgrade() else {
                return;
            };
            if ui.get_busy() || !ui.get_session_active() {
                return;
            }
            ui.set_busy(true);
            ui.set_message("Finishing focus session…".into());
            start_focus_action(
                weak.clone(),
                state.clone(),
                "stop".into(),
                None,
                ui.get_selected_work_kind().to_string(),
            );
        }
    });

    let weak = ui.as_weak();
    ui.on_tick(move || {
        let Some(ui) = weak.upgrade() else {
            return;
        };
        let elapsed = ui.get_elapsed_seconds();
        let next = elapsed.saturating_add(1);
        ui.set_elapsed_seconds(next);
        ui.set_timer_text(format_time(next).into());
    });

    let weak = ui.as_weak();
    ui.on_check_idle({
        let state = state.clone();
        let weak = weak.clone();
        move || {
            let Some(ui) = weak.upgrade() else {
                return;
            };
            if !ui.get_session_running() || ui.get_busy() {
                return;
            }
            let inactivity = system_idle_duration().unwrap_or_default();
            let mut show_prompt = false;
            let mut pause_session = false;
            if let Ok(mut shared) = state.lock() {
                match shared.idle_prompt_started {
                    Some(prompted_at) if prompted_at.elapsed() >= Duration::from_secs(60) => {
                        shared.idle_prompt_started = None;
                        pause_session = true;
                    }
                    Some(_) => {}
                    None if inactivity >= Duration::from_secs(5 * 60) => {
                        shared.idle_prompt_started = Some(Instant::now());
                        show_prompt = true;
                    }
                    None => {}
                }
            }
            if show_prompt {
                ui.set_idle_prompt_visible(true);
                ui.set_panel_open(true);
                ui.set_tasks_open(false);
            }
            if pause_session {
                ui.set_idle_prompt_visible(false);
                ui.set_busy(true);
                ui.set_message("Pausing after inactivity…".into());
                start_focus_action(
                    weak.clone(),
                    state.clone(),
                    "idle".into(),
                    None,
                    ui.get_selected_work_kind().to_string(),
                );
            }
        }
    });

    let weak = ui.as_weak();
    ui.on_confirm_active({
        let state = state.clone();
        let weak = weak.clone();
        move || {
            if let Ok(mut shared) = state.lock() {
                shared.idle_prompt_started = None;
            }
            if let Some(ui) = weak.upgrade() {
                ui.set_idle_prompt_visible(false);
                ui.set_message("Focus timer continues.".into());
            }
        }
    });

    let weak = ui.as_weak();
    ui.on_reconcile_focus({
        let state = state.clone();
        let weak = weak.clone();
        move || {
            if let Some(ui) = weak.upgrade() {
                if !ui.get_busy() && ui.get_signed_in() {
                    let include_tasks = ui.get_panel_open() && ui.get_tasks_open();
                    refresh_from_server(weak.clone(), state.clone(), include_tasks);
                }
            }
        }
    });

    let weak = ui.as_weak();
    ui.on_refresh({
        let state = state.clone();
        let weak = weak.clone();
        move || {
            let Some(ui) = weak.upgrade() else {
                return;
            };
            if ui.get_busy() || !ui.get_signed_in() {
                return;
            }
            ui.set_busy(true);
            ui.set_message("Refreshing from Ascent…".into());
            refresh_from_server(weak.clone(), state.clone(), true);
        }
    });

    let weak = ui.as_weak();
    ui.on_change_source({
        let state = state.clone();
        let weak = weak.clone();
        move |source| {
            if let Some(ui) = weak.upgrade() {
                set_task_model(&ui, &state, &source.to_string());
            }
        }
    });

    let weak = ui.as_weak();
    ui.on_select_work_kind({
        let weak = weak.clone();
        move |kind| {
            if let Some(ui) = weak.upgrade() {
                if !ui.get_busy() && !ui.get_session_active() {
                    ui.set_selected_work_kind(kind.clone());
                    ui.set_message(
                        format!("Next focus type: {}", kind_label(&kind.to_string())).into(),
                    );
                }
            }
        }
    });

    let weak = ui.as_weak();
    ui.on_start_task({
        let state = state.clone();
        let weak = weak.clone();
        move |id, source| {
            let Some(ui) = weak.upgrade() else {
                return;
            };
            if ui.get_busy() {
                return;
            }
            if ui.get_session_active() {
                ui.set_message(
                    "Pause or finish the current session before starting another task.".into(),
                );
                return;
            }
            let task = state.lock().ok().and_then(|shared| {
                shared
                    .tasks
                    .iter()
                    .find(|task| {
                        task.id == id.to_string() && task.source.label() == source.to_string()
                    })
                    .cloned()
            });
            let Some(task) = task else {
                ui.set_message("That task is no longer available. Refresh and try again.".into());
                return;
            };
            if let Ok(mut shared) = state.lock() {
                shared.selected_task = Some(task.clone());
            }
            ui.set_active_task_title(task.title.clone().into());
            set_task_model(&ui, &state, &ui.get_selected_source());
            ui.set_busy(true);
            ui.set_message(format!("Starting focus for {}…", task.title).into());
            start_focus_action(
                weak.clone(),
                state.clone(),
                "start".into(),
                Some(task),
                ui.get_selected_work_kind().to_string(),
            );
        }
    });

    let weak = ui.as_weak();
    ui.on_complete_task({
        let state = state.clone();
        let weak = weak.clone();
        move |id, source| {
            let Some(ui) = weak.upgrade() else {
                return;
            };
            if ui.get_busy() {
                return;
            }
            let task = state.lock().ok().and_then(|shared| {
                shared
                    .tasks
                    .iter()
                    .find(|task| {
                        task.id == id.to_string() && task.source.label() == source.to_string()
                    })
                    .cloned()
            });
            let Some(task) = task else {
                ui.set_message("That task is no longer available. Refresh and try again.".into());
                return;
            };
            if !task.can_complete || task.done {
                ui.set_message("This item is completed by recorded focus or tests.".into());
                return;
            }
            let request_id = task_completion_request_id(&state, &task.id);
            let task_id = task.id.clone();
            ui.set_busy(true);
            ui.set_message("Saving completion to Ascent…".into());
            let (server_url, credential) = snapshot(&state);
            let weak = weak.clone();
            let state = state.clone();
            thread::spawn(move || {
                let result = ApiClient::new(&server_url, credential)
                    .map_err(|message| ApiError {
                        message,
                        unauthorized: false,
                    })
                    .and_then(|client| {
                        client.complete_task(&task, &request_id)?;
                        client.load_tasks()
                    });
                let _ = slint::invoke_from_event_loop(move || {
                    let Some(ui) = weak.upgrade() else {
                        return;
                    };
                    match result {
                        Ok((tasks, preferences)) => {
                            finish_task_completion(&state, &task_id, &request_id);
                            if let Ok(mut shared) = state.lock() {
                                shared.tasks = tasks;
                            }
                            ui.set_share_task_titles_with_ai(preferences.share_task_titles_with_ai);
                            set_task_model(&ui, &state, &ui.get_selected_source());
                            ui.set_busy(false);
                            ui.set_message("Task completion synced".into());
                        }
                        Err(error) => auth_error(&ui, &state, &error),
                    }
                });
            });
        }
    });

    let weak = ui.as_weak();
    ui.on_create_task({
        let state = state.clone();
        let weak = weak.clone();
        move |title| {
            let Some(ui) = weak.upgrade() else {
                return;
            };
            if ui.get_busy() {
                return;
            }
            let title = title.to_string().trim().to_string();
            if title.is_empty() {
                ui.set_message("Enter a task title first.".into());
                return;
            }
            let request_id = task_creation_request_id(&state, &title);
            ui.set_busy(true);
            ui.set_message("Adding personal task…".into());
            submit_personal_task(
                weak.clone(),
                state.clone(),
                title,
                request_id,
                TaskCreateEffect::Manual,
            );
        }
    });

    let weak = ui.as_weak();
    ui.on_suggest_task({
        let state = state.clone();
        let weak = weak.clone();
        move || {
            let Some(ui) = weak.upgrade() else {
                return;
            };
            if ui.get_busy() {
                return;
            }
            ui.set_busy(true);
            ui.set_message("Asking Ascent for one next step…".into());
            let (server_url, credential) = snapshot(&state);
            let weak = weak.clone();
            let state = state.clone();
            thread::spawn(move || {
                let result = ApiClient::new(&server_url, credential)
                    .map_err(|message| ApiError {
                        message,
                        unauthorized: false,
                    })
                    .and_then(|client| client.suggest_task());
                let _ = slint::invoke_from_event_loop(move || {
                    let Some(ui) = weak.upgrade() else {
                        return;
                    };
                    match result {
                        Ok(response) => {
                            ui.set_suggestion_title(response.suggestion.title.into());
                            ui.set_suggestion_reason(response.suggestion.reason.into());
                            ui.set_suggestion_minutes(
                                format!(
                                    "{} min · {}",
                                    response.suggestion.estimated_minutes, response.provider
                                )
                                .into(),
                            );
                            ui.set_suggestion_provider(response.provider.into());
                            ui.set_has_suggestion(true);
                            ui.set_busy(false);
                            ui.set_message("Suggestion ready".into());
                        }
                        Err(error) => auth_error(&ui, &state, &error),
                    }
                });
            });
        }
    });

    let weak = ui.as_weak();
    ui.on_add_suggestion({
        let state = state.clone();
        let weak = weak.clone();
        move || {
            let Some(ui) = weak.upgrade() else {
                return;
            };
            if ui.get_busy() || !ui.get_has_suggestion() {
                return;
            }
            let title = ui.get_suggestion_title().to_string();
            let request_id = task_creation_request_id(&state, &title);
            ui.set_busy(true);
            ui.set_message("Adding suggestion to Mine…".into());
            submit_personal_task(
                weak.clone(),
                state.clone(),
                title,
                request_id,
                TaskCreateEffect::Suggestion,
            );
        }
    });

    let weak = ui.as_weak();
    ui.on_work_suggestion({
        let state = state.clone();
        let weak = weak.clone();
        move || {
            let Some(ui) = weak.upgrade() else {
                return;
            };
            if ui.get_busy() || !ui.get_has_suggestion() {
                return;
            }
            if ui.get_session_active() {
                ui.set_message(
                    "Pause or finish the current session before starting another task.".into(),
                );
                return;
            }
            let task = WidgetTask {
                id: "ai-suggestion".into(),
                title: ui.get_suggestion_title().to_string(),
                detail: ui.get_suggestion_minutes().to_string(),
                source: TaskSource::Ai,
                subject_id: String::new(),
                chapter_id: String::new(),
                done: false,
                can_complete: false,
            };
            ui.set_busy(true);
            ui.set_message("Starting a focus block for this suggestion…".into());
            if let Ok(mut shared) = state.lock() {
                shared.selected_task = Some(task.clone());
            }
            ui.set_active_task_title(task.title.clone().into());
            start_focus_action(
                weak.clone(),
                state.clone(),
                "start".into(),
                Some(task),
                ui.get_selected_work_kind().to_string(),
            );
        }
    });

    let weak = ui.as_weak();
    ui.on_set_title_sharing({
        let state = state.clone();
        let weak = weak.clone();
        move |allow| {
            let Some(ui) = weak.upgrade() else {
                return;
            };
            if ui.get_busy() {
                return;
            }
            ui.set_busy(true);
            ui.set_message(
                (if allow {
                    "Saving AI title-sharing opt-in…"
                } else {
                    "Turning off AI title sharing…"
                })
                .into(),
            );
            let (server_url, credential) = snapshot(&state);
            let weak = weak.clone();
            let state = state.clone();
            thread::spawn(move || {
                let result = ApiClient::new(&server_url, credential)
                    .map_err(|message| ApiError {
                        message,
                        unauthorized: false,
                    })
                    .and_then(|client| client.set_title_sharing(allow));
                let _ = slint::invoke_from_event_loop(move || {
                    let Some(ui) = weak.upgrade() else {
                        return;
                    };
                    match result {
                        Ok(preferences) => {
                            ui.set_share_task_titles_with_ai(preferences.share_task_titles_with_ai);
                            ui.set_busy(false);
                            ui.set_message(
                                (if preferences.share_task_titles_with_ai {
                                    "Opt-in saved · AI may receive task titles"
                                } else {
                                    "Task-title sharing is off"
                                })
                                .into(),
                            );
                        }
                        Err(error) => auth_error(&ui, &state, &error),
                    }
                });
            });
        }
    });

    let weak = ui.as_weak();
    tray.on_show_widget(move || {
        if let Some(ui) = weak.upgrade() {
            ui.set_panel_open(false);
            ui.set_tasks_open(false);
            let _ = ui.window().show();
        }
    });
    let weak = ui.as_weak();
    tray.on_hide_widget(move || {
        if let Some(ui) = weak.upgrade() {
            let _ = ui.window().hide();
        }
    });
    tray.on_quit_widget(|| std::process::exit(0));
    let weak = ui.as_weak();
    ui.on_move_window(move || {
        let Some(ui) = weak.upgrade() else {
            return;
        };
        if let Some((x, y)) = begin_window_drag(&ui) {
            let mut updated_settings = settings::load();
            updated_settings.widget_x = Some(x);
            updated_settings.widget_y = Some(y);
            if settings::save(&updated_settings).is_err() {
                ui.set_message("The widget moved, but its position could not be saved".into());
            }
        }
    });
    ui.window().show()?;
    tray.show()?;
    configure_windows_window(&ui, saved_position);
    ui.run()?;
    Ok(())
}
