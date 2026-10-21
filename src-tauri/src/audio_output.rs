//! The device the app plays on, chosen in the tray menu instead of the
//! system's default.
//!
//! On Linux the sound server (PulseAudio, or PipeWire with its PulseAudio
//! side) is asked through `pactl`: it lists the devices, and the app's
//! streams, which come from its web view's processes, are moved to the
//! chosen one, also each new stream as it starts. Without `pactl` there is
//! no choice.
//!
//! On Windows the app lists the devices itself, and the page sends its sound
//! to the chosen one (`audio/output-switch.ts`). The page sees the devices
//! only with the microphone permission, which it gets from the app while a
//! device is chosen and loses again with the default; it cannot open the
//! microphone all the same. Other systems have no choice.

// The sound server's side is for Linux only.
#![cfg_attr(not(target_os = "linux"), allow(dead_code))]

use crate::settings::SettingsStore;
use serde::Deserialize;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

const MAX_LABEL_CHARS: usize = 80;
/// More devices than a menu should list.
const MAX_OUTPUTS: usize = 32;
pub const MAX_NAME_CHARS: usize = 256;

/// A device sound can go to: the sound server's name for it, and what the
/// system shows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Output {
    pub name: String,
    pub label: String,
}

/// The devices last seen.
#[derive(Default)]
pub struct Outputs(Mutex<Vec<Output>>);

impl Outputs {
    fn set(&self, outputs: Vec<Output>) -> bool {
        let mut current = self.0.lock().unwrap_or_else(|err| err.into_inner());
        let changed = *current != outputs;
        *current = outputs;
        changed
    }
}

/// Whether a setting names a device the way the sound server could.
pub fn is_valid_name(name: &str) -> bool {
    name.len() <= MAX_NAME_CHARS && !name.chars().any(char::is_control)
}

#[derive(Deserialize)]
struct Sink {
    index: u32,
    name: String,
    #[serde(default)]
    description: String,
}

#[derive(Deserialize)]
struct SinkInput {
    index: u32,
    sink: u32,
    #[serde(default)]
    properties: std::collections::HashMap<String, String>,
}

fn label(sink: &Sink) -> String {
    let text = if sink.description.trim().is_empty() {
        &sink.name
    } else {
        &sink.description
    };
    text.chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .take(MAX_LABEL_CHARS)
        .collect()
}

/// The devices in `pactl --format=json list sinks`, without the ones no one
/// hears (`auto_null` stands in when there is no device at all).
fn parse_sinks(json: &str) -> Vec<(u32, Output)> {
    let sinks: Vec<Sink> = serde_json::from_str(json).unwrap_or_default();
    sinks
        .into_iter()
        .filter(|sink| is_valid_name(&sink.name) && sink.name != "auto_null")
        .take(MAX_OUTPUTS)
        .map(|sink| {
            let output = Output {
                label: label(&sink),
                name: sink.name.clone(),
            };
            (sink.index, output)
        })
        .collect()
}

/// The streams in `pactl --format=json list sink-inputs`: their number, the
/// device's number and the process they come from.
fn parse_inputs(json: &str) -> Vec<(u32, u32, Option<u32>)> {
    let inputs: Vec<SinkInput> = serde_json::from_str(json).unwrap_or_default();
    inputs
        .into_iter()
        .map(|input| {
            let pid = input
                .properties
                .get("application.process.id")
                .and_then(|pid| pid.parse().ok());
            (input.index, input.sink, pid)
        })
        .collect()
}

/// The process a `/proc/<pid>/stat` line names as parent. The program's name
/// is in parentheses and may hold spaces and parentheses itself.
fn parent_in_stat(stat: &str) -> Option<u32> {
    let after_name = &stat[stat.rfind(')')? + 1..];
    after_name.split_whitespace().nth(1)?.parse().ok()
}

#[cfg(target_os = "linux")]
mod pactl {
    use super::*;
    use std::io::{BufRead, BufReader};
    use std::process::{Command, Stdio};

    fn run(args: &[&str]) -> Option<String> {
        let output = Command::new("pactl")
            .args(args)
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output()
            .ok()?;
        output
            .status
            .success()
            .then(|| String::from_utf8_lossy(&output.stdout).into_owned())
    }

    pub fn available() -> bool {
        run(&["--format=json", "list", "short", "sinks"]).is_some()
    }

    pub fn sinks() -> Vec<(u32, Output)> {
        run(&["--format=json", "list", "sinks"])
            .map(|json| parse_sinks(&json))
            .unwrap_or_default()
    }

    /// Whether a stream's process is this app or one of its web view's.
    fn is_ours(pid: u32) -> bool {
        let me = std::process::id();
        pid == me
            || std::fs::read_to_string(format!("/proc/{pid}/stat"))
                .ok()
                .and_then(|stat| parent_in_stat(&stat))
                == Some(me)
    }

    /// Moves the app's streams that are elsewhere to the device `name`.
    /// Returns how many streams it moved.
    pub fn move_ours(name: &str) -> usize {
        let sinks = sinks();
        let target = if name.is_empty() {
            run(&["get-default-sink"]).map(|default| default.trim().to_owned())
        } else {
            Some(name.to_owned())
        };
        let Some(target) = target else { return 0 };
        let Some(index) = sinks
            .iter()
            .find(|(_, output)| output.name == target)
            .map(|(index, _)| *index)
        else {
            // Unplugged: the sound server has moved the streams somewhere already.
            return 0;
        };
        let inputs = run(&["--format=json", "list", "sink-inputs"])
            .map(|json| parse_inputs(&json))
            .unwrap_or_default();
        let mut moved = 0;
        for (input, sink, pid) in inputs {
            if sink != index && pid.is_some_and(is_ours) {
                if run(&["move-sink-input", &input.to_string(), &target]).is_some() {
                    moved += 1;
                } else {
                    log_error!("cannot move the sound to {target}");
                }
            }
        }
        moved
    }

    /// Calls `changed` with what the sound server reports: true for a
    /// device that came or went, false for a new stream. Returns when
    /// `pactl subscribe` ends.
    pub fn watch(mut changed: impl FnMut(bool)) {
        use std::os::unix::process::CommandExt;
        let mut command = Command::new("pactl");
        command
            .arg("subscribe")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        // SAFETY: only an async-signal-safe call between fork and exec. It
        // ends `pactl` with the app, which it would outlive otherwise: it
        // writes nothing until the sound server has news.
        unsafe {
            command.pre_exec(|| {
                if libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGTERM) == -1 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
        let Ok(mut child) = command.spawn() else {
            return;
        };
        if let Some(stdout) = child.stdout.take() {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                // Event 'new' on sink-input #42 / Event 'remove' on sink #3
                if line.contains("'new' on sink-input") {
                    changed(false);
                } else if line.contains(" on sink #")
                    && (line.contains("'new'") || line.contains("'remove'"))
                {
                    changed(true);
                }
            }
        }
        let _ = child.wait();
    }
}

fn chosen(app: &AppHandle) -> String {
    app.state::<SettingsStore>().get().output_device
}

/// Moves the app's streams to the chosen device, one move at a time and each
/// to the device chosen when it runs: a move started earlier for another
/// choice cannot end after the latest one. With nothing chosen, the streams
/// go back to the default only when asked, else the sound server decides.
#[cfg(target_os = "linux")]
fn follow(app: &AppHandle, back_to_default: bool) {
    static MOVING: Mutex<()> = Mutex::new(());
    let _one_at_a_time = MOVING.lock().unwrap_or_else(|err| err.into_inner());
    let name = chosen(app);
    if name.is_empty() && !back_to_default {
        return;
    }
    // The sound server may put a stream back where it remembers it, as when
    // the player starts anew: looked at again a moment after each move.
    for _ in 0..3 {
        if pactl::move_ours(&name) == 0 {
            break;
        }
        std::thread::sleep(std::time::Duration::from_secs(1));
    }
}

/// Lists the devices again and shows them in the tray menu.
#[cfg(any(target_os = "linux", windows))]
fn refresh(app: &AppHandle) {
    #[cfg(target_os = "linux")]
    let outputs: Vec<Output> = pactl::sinks()
        .into_iter()
        .map(|(_, output)| output)
        .collect();
    #[cfg(windows)]
    let outputs = windows_side::outputs();
    if app.state::<Outputs>().set(outputs.clone()) {
        crate::tray::set_outputs(app, &outputs, &chosen(app));
    }
}

/// Starts looking after the sound's device, if the system can say which
/// devices there are.
pub fn start(app: &AppHandle) {
    #[cfg(target_os = "linux")]
    {
        let app = app.clone();
        std::thread::spawn(move || {
            if !pactl::available() {
                return;
            }
            refresh(&app);
            follow(&app, false);
            loop {
                pactl::watch(|device| {
                    if device {
                        refresh(&app);
                    }
                    follow(&app, false);
                });
                // The sound server restarted, or went away for a while.
                std::thread::sleep(std::time::Duration::from_secs(10));
                refresh(&app);
            }
        });
    }
    #[cfg(windows)]
    {
        let app = app.clone();
        // Windows tells of new devices through a COM callback; looking now
        // and then is enough for a menu.
        std::thread::spawn(move || loop {
            refresh(&app);
            std::thread::sleep(std::time::Duration::from_secs(5));
        });
    }
    #[cfg(not(any(target_os = "linux", windows)))]
    let _ = app;
}

/// Before the main window's page loads: with a device chosen, the page may
/// list the devices, so that it can send its sound there; without one it may
/// not, also if the app ended before it took the permission back. Windows only.
pub fn prepare(window: &tauri::WebviewWindow, chosen: &str) {
    #[cfg(windows)]
    windows_side::set_permission(window, !chosen.is_empty());
    #[cfg(not(windows))]
    let _ = (window, chosen);
}

/// The device setting changed: the sound goes there now, or back to the
/// system's default.
pub fn chosen_changed(app: &AppHandle, name: &str) {
    crate::tray::tick_output(app, name);
    #[cfg(target_os = "linux")]
    {
        let app = app.clone();
        std::thread::spawn(move || follow(&app, true));
    }
    #[cfg(windows)]
    if let Some(window) = app.get_webview_window(crate::window::MAIN_WINDOW_LABEL) {
        let name = name.to_owned();
        if !name.is_empty() {
            windows_side::set_permission(&window, true);
        }
        std::thread::spawn(move || {
            // The permission is in place a moment after it is asked for.
            std::thread::sleep(std::time::Duration::from_millis(300));
            windows_side::tell_page(&window, &name);
            if name.is_empty() {
                // The page has gone back to the default by then.
                std::thread::sleep(std::time::Duration::from_secs(3));
                windows_side::set_permission(&window, false);
            }
        });
    }
}

#[cfg(windows)]
mod windows_side {
    use super::{is_valid_name, Output, MAX_LABEL_CHARS, MAX_OUTPUTS};
    use tauri::WebviewWindow;

    /// The output devices in use, by the names Windows shows for them, like
    /// `Lautsprecher (Focusrite USB Audio)`.
    pub fn outputs() -> Vec<Output> {
        use windows::Win32::{
            Devices::FunctionDiscovery::PKEY_Device_FriendlyName,
            Media::Audio::{eRender, IMMDeviceEnumerator, MMDeviceEnumerator, DEVICE_STATE_ACTIVE},
            System::Com::{
                CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
                STGM_READ,
            },
        };
        // SAFETY: plain COM calls with valid arguments, as in `audio_device`:
        // COM is set up for this thread first and taken down only if this
        // call set it up.
        let names = unsafe {
            let initialized = CoInitializeEx(None, COINIT_MULTITHREADED).is_ok();
            let names = (|| -> windows::core::Result<Vec<String>> {
                let enumerator: IMMDeviceEnumerator =
                    CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
                let devices = enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)?;
                let mut names = Vec::new();
                for index in 0..devices.GetCount()? {
                    let properties = devices.Item(index)?.OpenPropertyStore(STGM_READ)?;
                    names.push(properties.GetValue(&PKEY_Device_FriendlyName)?.to_string());
                }
                Ok(names)
            })();
            if initialized {
                CoUninitialize();
            }
            names.unwrap_or_default()
        };
        names
            .into_iter()
            .filter(|name| !name.trim().is_empty() && is_valid_name(name))
            .take(MAX_OUTPUTS)
            .map(|name| Output {
                label: name.chars().take(MAX_LABEL_CHARS).collect(),
                name,
            })
            .collect()
    }

    /// Gives YouTube Music the microphone permission, or takes it back. The
    /// page needs it to see the devices and to send its sound to one.
    pub fn set_permission(window: &WebviewWindow, allow: bool) {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2Profile4, ICoreWebView2_13, COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
            COREWEBVIEW2_PERMISSION_STATE_ALLOW, COREWEBVIEW2_PERMISSION_STATE_DEFAULT,
        };
        use webview2_com::SetPermissionStateCompletedHandler;
        use windows_core::{Interface, HSTRING};

        let state = if allow {
            COREWEBVIEW2_PERMISSION_STATE_ALLOW
        } else {
            COREWEBVIEW2_PERMISSION_STATE_DEFAULT
        };
        let result = window.with_webview(move |webview| {
            let done = SetPermissionStateCompletedHandler::create(Box::new(|result| {
                if let Err(err) = result {
                    log_error!("cannot set the permission for the sound devices: {err}");
                }
                Ok(())
            }));
            // SAFETY: plain COM calls on the live webview, on the thread that
            // owns it, which is where `with_webview` runs this.
            let asked = unsafe {
                webview
                    .controller()
                    .CoreWebView2()
                    .and_then(|core| core.cast::<ICoreWebView2_13>())
                    .and_then(|core| core.Profile())
                    .and_then(|profile| profile.cast::<ICoreWebView2Profile4>())
                    .and_then(|profile| {
                        profile.SetPermissionState(
                            COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
                            &HSTRING::from("https://music.youtube.com"),
                            state,
                            &done,
                        )
                    })
            };
            if let Err(err) = asked {
                log_error!("cannot set the permission for the sound devices: {err}");
            }
        });
        if let Err(err) = result {
            log_error!("cannot reach the webview: {err}");
        }
    }

    /// Asks the page to send its sound to the device, "" for the default.
    pub fn tell_page(window: &WebviewWindow, name: &str) {
        let name = serde_json::Value::from(name);
        if let Err(err) = window.eval(format!("window.__ytmDesktop?.setOutput?.({name})")) {
            log_error!("cannot tell the page the sound device: {err}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_the_devices_one_can_hear() {
        let json = r#"[
            {"index": 33, "name": "auto_null", "description": "Dummy Output"},
            {"index": 51, "name": "alsa_output.pci.analog-stereo", "description": "Built-in Audio\nAnalog Stereo"},
            {"index": 60, "name": "bluez_output.AA_BB", "description": ""}
        ]"#;
        let outputs = parse_sinks(json);
        assert_eq!(outputs.len(), 2);
        assert_eq!(outputs[0].0, 51);
        assert_eq!(outputs[0].1.label, "Built-in Audio Analog Stereo");
        assert_eq!(outputs[1].1.label, "bluez_output.AA_BB");
        assert!(parse_sinks("not json").is_empty());
    }

    #[test]
    fn reads_where_each_stream_comes_from() {
        let json = r#"[
            {"index": 569, "sink": 35, "properties": {"application.process.id": "715157", "media.role": "webaudio"}},
            {"index": 580, "sink": 35, "properties": {}}
        ]"#;
        assert_eq!(
            parse_inputs(json),
            vec![(569, 35, Some(715157)), (580, 35, None)]
        );
    }

    #[test]
    fn finds_the_parent_past_an_odd_program_name() {
        assert_eq!(
            parent_in_stat("715157 (WebKitWebProces) S 715029 715029 0"),
            Some(715029)
        );
        assert_eq!(parent_in_stat("9 (a) b (c) S 12 9 9"), Some(12));
        assert_eq!(parent_in_stat("garbage"), None);
    }

    #[test]
    fn takes_names_a_sound_server_could_have() {
        assert!(is_valid_name(""));
        assert!(is_valid_name("alsa_output.pci-0000_00_1f.3.analog-stereo"));
        assert!(!is_valid_name("a\nb"));
        assert!(!is_valid_name(&"x".repeat(MAX_NAME_CHARS + 1)));
    }
}
