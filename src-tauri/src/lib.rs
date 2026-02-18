use enigo::{Enigo, Mouse, Keyboard, Settings, Coordinate, Button, Direction, Key};
use serde::Deserialize;
use std::sync::Mutex;
use tauri::State;

#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXSCREEN, SM_CYSCREEN};

struct EnigoState(Mutex<Enigo>);

#[derive(Deserialize)]
struct MouseMoveCmd {
    x: f64,
    y: f64,
    screen_w: i32,
    screen_h: i32,
}

#[derive(Deserialize)]
struct MouseClickCmd {
    button: u8, // 0=left, 1=middle, 2=right
    action: String, // "down" | "up" | "click"
}

#[derive(Deserialize)]
struct KeyCmd {
    key: String,
    action: String, // "down" | "up" | "press"
}

fn map_button(b: u8) -> Button {
    match b {
        1 => Button::Middle,
        2 => Button::Right,
        _ => Button::Left,
    }
}

fn map_key(k: &str) -> Key {
    match k {
        "Enter" => Key::Return,
        "Backspace" => Key::Backspace,
        "Tab" => Key::Tab,
        "Escape" => Key::Escape,
        "Delete" => Key::Delete,
        "Home" => Key::Home,
        "End" => Key::End,
        "PageUp" => Key::PageUp,
        "PageDown" => Key::PageDown,
        "ArrowUp" => Key::UpArrow,
        "ArrowDown" => Key::DownArrow,
        "ArrowLeft" => Key::LeftArrow,
        "ArrowRight" => Key::RightArrow,
        "Control" => Key::Control,
        "Shift" => Key::Shift,
        "Alt" => Key::Alt,
        "Meta" => Key::Meta,
        "F1" => Key::F1,
        "F2" => Key::F2,
        "F3" => Key::F3,
        "F4" => Key::F4,
        "F5" => Key::F5,
        "F6" => Key::F6,
        "F7" => Key::F7,
        "F8" => Key::F8,
        "F9" => Key::F9,
        "F10" => Key::F10,
        "F11" => Key::F11,
        "F12" => Key::F12,
        " " => Key::Space,
        other => {
            if let Some(c) = other.chars().next() {
                Key::Unicode(c)
            } else {
                Key::Space
            }
        }
    }
}

#[tauri::command]
fn mouse_move(cmd: MouseMoveCmd, state: State<EnigoState>) -> Result<(), String> {
    // Validate bounds
    let x = cmd.x.clamp(0.0, 1.0);
    let y = cmd.y.clamp(0.0, 1.0);
    let sw = cmd.screen_w.max(1).min(15360);
    let sh = cmd.screen_h.max(1).min(8640);

    let mut enigo = state.0.lock().map_err(|e| e.to_string())?;
    let abs_x = (x * sw as f64) as i32;
    let abs_y = (y * sh as f64) as i32;
    enigo.move_mouse(abs_x, abs_y, Coordinate::Abs).map_err(|e| e.to_string())
}

#[tauri::command]
fn mouse_click(cmd: MouseClickCmd, state: State<EnigoState>) -> Result<(), String> {
    // Validate button (0=left, 1=middle, 2=right)
    if cmd.button > 2 {
        return Err("Invalid button".into());
    }
    let action = match cmd.action.as_str() {
        "down" | "up" | "click" => cmd.action.as_str(),
        _ => return Err("Invalid action".into()),
    };

    let mut enigo = state.0.lock().map_err(|e| e.to_string())?;
    let btn = map_button(cmd.button);
    match action {
        "down" => enigo.button(btn, Direction::Press).map_err(|e| e.to_string()),
        "up" => enigo.button(btn, Direction::Release).map_err(|e| e.to_string()),
        _ => enigo.button(btn, Direction::Click).map_err(|e| e.to_string()),
    }
}

#[tauri::command]
fn key_input(cmd: KeyCmd, state: State<EnigoState>) -> Result<(), String> {
    // Validate key length
    if cmd.key.is_empty() || cmd.key.len() > 20 {
        return Err("Invalid key".into());
    }
    let action = match cmd.action.as_str() {
        "down" | "up" | "press" => cmd.action.as_str(),
        _ => return Err("Invalid action".into()),
    };

    let mut enigo = state.0.lock().map_err(|e| e.to_string())?;
    let key = map_key(&cmd.key);
    match action {
        "down" => enigo.key(key, Direction::Press).map_err(|e| e.to_string()),
        "up" => enigo.key(key, Direction::Release).map_err(|e| e.to_string()),
        _ => enigo.key(key, Direction::Click).map_err(|e| e.to_string()),
    }
}

#[tauri::command]
fn get_screen_size() -> (i32, i32) {
    #[cfg(target_os = "windows")]
    {
        let w = unsafe { GetSystemMetrics(SM_CXSCREEN) };
        let h = unsafe { GetSystemMetrics(SM_CYSCREEN) };
        if w > 0 && h > 0 {
            return (w, h);
        }
    }
    (1920, 1080) // fallback
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let enigo = Enigo::new(&Settings::default()).expect("Failed to create Enigo instance");

    tauri::Builder::default()
        .manage(EnigoState(Mutex::new(enigo)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .invoke_handler(tauri::generate_handler![
            mouse_move,
            mouse_click,
            key_input,
            get_screen_size,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
