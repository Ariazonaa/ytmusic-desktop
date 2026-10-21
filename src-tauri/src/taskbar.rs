//! The Windows taskbar: previous, play / pause and next under the window's
//! thumbnail, the track's progress in the taskbar button, and the same three
//! in the button's jump list, which start the app with `--play-pause` and the
//! like (see `window::player_action`).
//!
//! The page reports what plays through `set_playback`. Elsewhere this does nothing.

use tauri::{AppHandle, WebviewWindow};

// What follows up to `attach` is only used on Windows, and tested everywhere.
/// The buttons, by their id.
#[cfg(any(windows, test))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Glyph {
    Previous,
    Play,
    Pause,
    Next,
}

/// Side of the drawn icons in pixels; Windows scales them to the button.
#[cfg(any(windows, test))]
const SIZE: usize = 32;

/// White shapes on transparent, as BGRA rows from the top, for an icon.
/// Each pixel is sampled four by four, so edges are smooth.
#[cfg(any(windows, test))]
fn draw(glyph: Glyph) -> Vec<u8> {
    let inside = |x: f32, y: f32| -> bool {
        let triangle = |left: f32, right: f32| {
            // Pointing right from `left` to `right`, or left if right < left.
            let (from, to) = (left, right);
            let t = (x - from) / (to - from);
            (0.0..=1.0).contains(&t) && (y - 0.5).abs() <= 0.28 * (1.0 - t)
        };
        let bar = |left: f32, right: f32| (left..=right).contains(&x) && (0.22..=0.78).contains(&y);
        match glyph {
            Glyph::Play => triangle(0.3, 0.8),
            Glyph::Pause => bar(0.27, 0.42) || bar(0.58, 0.73),
            Glyph::Next => triangle(0.2, 0.64) || bar(0.66, 0.78),
            Glyph::Previous => triangle(0.8, 0.36) || bar(0.22, 0.34),
        }
    };
    let mut pixels = vec![0u8; SIZE * SIZE * 4];
    for row in 0..SIZE {
        for column in 0..SIZE {
            let mut hits = 0u32;
            for sy in 0..4 {
                for sx in 0..4 {
                    let x = (column as f32 + (sx as f32 + 0.5) / 4.0) / SIZE as f32;
                    let y = (row as f32 + (sy as f32 + 0.5) / 4.0) / SIZE as f32;
                    hits += u32::from(inside(x, y));
                }
            }
            let alpha = (hits * 255 / 16) as u8;
            let at = (row * SIZE + column) * 4;
            pixels[at..at + 4].copy_from_slice(&[255, 255, 255, alpha]);
        }
    }
    pixels
}

/// Texts of buttons and jump list, in the menu's language.
#[cfg(any(windows, test))]
fn label(german: bool, glyph: Glyph) -> &'static str {
    match (german, glyph) {
        (false, Glyph::Previous) => "Previous",
        (false, Glyph::Play) => "Play",
        (false, Glyph::Pause) => "Pause",
        (false, Glyph::Next) => "Next",
        (true, Glyph::Previous) => "Zurück",
        (true, Glyph::Play) => "Wiedergabe",
        (true, Glyph::Pause) => "Pause",
        (true, Glyph::Next) => "Weiter",
    }
}

/// Puts buttons and jump list on the main window's taskbar button.
pub fn attach(app: &AppHandle, window: &WebviewWindow) {
    #[cfg(windows)]
    native::attach(app, window);
    #[cfg(not(windows))]
    let _ = (app, window);
}

/// What plays, as the page reports it: for the play / pause button and the progress.
pub fn set_playback(app: &AppHandle, paused: bool, position: f64, duration: Option<f64>) {
    #[cfg(windows)]
    native::set_playback(app, paused, position, duration);
    #[cfg(not(windows))]
    let _ = (app, paused, position, duration);
}

#[cfg(windows)]
mod native {
    use super::{draw, label, Glyph, SIZE};
    use crate::settings::SettingsStore;
    use crate::window::{self, PlayerAction};
    use std::cell::RefCell;
    use std::sync::atomic::{AtomicU32, Ordering};
    use tauri::{AppHandle, Manager, WebviewWindow};
    use windows::core::{w, Interface, HSTRING, PWSTR};
    use windows::Win32::Foundation::{E_FAIL, HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::Graphics::Gdi::{CreateBitmap, DeleteObject};
    use windows::Win32::Storage::EnhancedStorage::PKEY_Title;
    use windows::Win32::System::Com::StructuredStorage::{PropVariantClear, PROPVARIANT};
    use windows::Win32::System::Com::{CoCreateInstance, CoTaskMemAlloc, CLSCTX_INPROC_SERVER};
    use windows::Win32::System::Variant::VT_LPWSTR;
    use windows::Win32::UI::Shell::Common::{IObjectArray, IObjectCollection};
    use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;
    use windows::Win32::UI::Shell::{
        DefSubclassProc, DestinationList, EnumerableObjectCollection, ICustomDestinationList,
        IShellLinkW, ITaskbarList3, SetWindowSubclass, ShellLink, TaskbarList, TBPF_NOPROGRESS,
        TBPF_NORMAL, TBPF_PAUSED, THBF_ENABLED, THBN_CLICKED, THB_FLAGS, THB_ICON, THB_TOOLTIP,
        THUMBBUTTON,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateIconIndirect, RegisterWindowMessageW, HICON, ICONINFO, WM_COMMAND,
    };

    const BUTTONS: [Glyph; 3] = [Glyph::Previous, Glyph::Play, Glyph::Next];
    /// Sent when the taskbar button exists, also after Explorer restarted.
    static BUTTON_CREATED: AtomicU32 = AtomicU32::new(0);

    /// Lives on the main thread, where the window and its COM objects are.
    struct Bar {
        hwnd: HWND,
        list: Option<ITaskbarList3>,
        icons: [HICON; 4],
        german: bool,
        paused: bool,
    }

    thread_local! {
        static BAR: RefCell<Option<Bar>> = const { RefCell::new(None) };
    }

    fn id(glyph: Glyph) -> u32 {
        glyph as u32 + 1
    }

    fn icon(glyph: Glyph) -> windows::core::Result<HICON> {
        let pixels = draw(glyph);
        let side = SIZE as i32;
        // SAFETY: the bits are SIZE × SIZE × 32 bits; the bitmaps are copied
        // into the icon and deleted after.
        unsafe {
            let color = CreateBitmap(side, side, 1, 32, Some(pixels.as_ptr().cast()));
            let mask = CreateBitmap(side, side, 1, 1, None);
            let info = ICONINFO {
                fIcon: true.into(),
                hbmColor: color,
                hbmMask: mask,
                ..Default::default()
            };
            let icon = CreateIconIndirect(&info);
            let _ = DeleteObject(color.into());
            let _ = DeleteObject(mask.into());
            icon
        }
    }

    fn button(german: bool, glyph: Glyph, icon: HICON) -> THUMBBUTTON {
        let mut tip = [0u16; 260];
        for (place, unit) in tip.iter_mut().zip(label(german, glyph).encode_utf16()) {
            *place = unit;
        }
        THUMBBUTTON {
            dwMask: THB_ICON | THB_TOOLTIP | THB_FLAGS,
            iId: id(match glyph {
                Glyph::Pause => Glyph::Play,
                other => other,
            }),
            hIcon: icon,
            szTip: tip,
            dwFlags: THBF_ENABLED,
            ..Default::default()
        }
    }

    impl Bar {
        fn icon_of(&self, glyph: Glyph) -> HICON {
            self.icons[glyph as usize]
        }

        fn buttons(&self) -> Vec<THUMBBUTTON> {
            BUTTONS
                .iter()
                .map(|&glyph| {
                    let shown = if glyph == Glyph::Play && !self.paused {
                        Glyph::Pause
                    } else {
                        glyph
                    };
                    button(self.german, shown, self.icon_of(shown))
                })
                .collect()
        }

        /// The taskbar button exists (again): a fresh list and the buttons on it.
        fn button_created(&mut self) {
            // SAFETY: COM calls on the main thread, which has COM set up for the window.
            let list: windows::core::Result<ITaskbarList3> = unsafe {
                CoCreateInstance(&TaskbarList, None, CLSCTX_INPROC_SERVER)
                    .and_then(|list: ITaskbarList3| list.HrInit().map(|()| list))
            };
            match list.and_then(|list| {
                // SAFETY: as above; the buttons are copied by the call.
                unsafe { list.ThumbBarAddButtons(self.hwnd, &self.buttons()) }.map(|()| list)
            }) {
                Ok(list) => self.list = Some(list),
                Err(err) => log_error!("cannot put buttons on the taskbar: {err}"),
            }
        }

        fn show(&mut self, paused: bool, position: f64, duration: Option<f64>) {
            let Some(list) = &self.list else {
                return;
            };
            if paused != self.paused {
                self.paused = paused;
                let buttons = self.buttons();
                // SAFETY: COM call on the main thread with buttons it copies.
                if let Err(err) = unsafe { list.ThumbBarUpdateButtons(self.hwnd, &buttons) } {
                    log_error!("cannot update the taskbar buttons: {err}");
                }
            }
            // SAFETY: COM calls on the main thread.
            let result = unsafe {
                match duration.filter(|total| *total > 0.0) {
                    Some(total) => list
                        .SetProgressState(self.hwnd, if paused { TBPF_PAUSED } else { TBPF_NORMAL })
                        .and_then(|()| {
                            let done = (position.clamp(0.0, total) * 1000.0) as u64;
                            list.SetProgressValue(self.hwnd, done, (total * 1000.0) as u64)
                        }),
                    None => list.SetProgressState(self.hwnd, TBPF_NOPROGRESS),
                }
            };
            if let Err(err) = result {
                log_error!("cannot show the progress on the taskbar: {err}");
            }
        }
    }

    unsafe extern "system" fn subclass(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _id: usize,
        app: usize,
    ) -> LRESULT {
        if message == BUTTON_CREATED.load(Ordering::Relaxed) {
            BAR.with_borrow_mut(|bar| {
                if let Some(bar) = bar {
                    bar.button_created();
                }
            });
        } else if message == WM_COMMAND && (wparam.0 >> 16) as u32 == THBN_CLICKED {
            let action = match (wparam.0 & 0xffff) as u32 {
                x if x == id(Glyph::Previous) => Some(PlayerAction::Previous),
                x if x == id(Glyph::Play) => Some(PlayerAction::PlayPause),
                x if x == id(Glyph::Next) => Some(PlayerAction::Next),
                _ => None,
            };
            if let Some(action) = action {
                // SAFETY: `app` is the AppHandle leaked in `attach`, alive for the program's run.
                let app = unsafe { &*(app as *const AppHandle) };
                window::control_player(app, action);
                return LRESULT(0);
            }
        }
        // SAFETY: passes the message on to the window's own procedure.
        unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
    }

    pub fn attach(app: &AppHandle, window: &WebviewWindow) {
        let german = crate::tray::wants_german(
            &app.state::<SettingsStore>().get().language,
            sys_locale::get_locale().as_deref(),
        );
        let hwnd = match window.hwnd() {
            // As a number: the handle itself may not move to another thread.
            Ok(hwnd) => hwnd.0 as isize,
            Err(err) => {
                log_error!("cannot reach the window for the taskbar: {err}");
                return;
            }
        };
        let app = app.clone();
        let result = window.run_on_main_thread(move || {
            let hwnd = HWND(hwnd as *mut core::ffi::c_void);
            let icons = [Glyph::Previous, Glyph::Play, Glyph::Pause, Glyph::Next].map(|glyph| {
                icon(glyph).unwrap_or_else(|err| {
                    log_error!("cannot draw a taskbar icon: {err}");
                    HICON::default()
                })
            });
            // SAFETY: a constant name.
            BUTTON_CREATED.store(
                unsafe { RegisterWindowMessageW(w!("TaskbarButtonCreated")) },
                Ordering::Relaxed,
            );
            let mut bar = Bar {
                hwnd,
                list: None,
                icons,
                german,
                paused: true,
            };
            // The window may already have its taskbar button.
            bar.button_created();
            BAR.with_borrow_mut(|slot| *slot = Some(bar));
            // The subclass keeps the handle for as long as the program runs.
            let app = Box::into_raw(Box::new(app)) as usize;
            // SAFETY: the window belongs to this thread; `subclass` lives as long as the program.
            if !unsafe { SetWindowSubclass(hwnd, Some(subclass), 1, app) }.as_bool() {
                log_error!("cannot hear the taskbar buttons");
            }
            if let Err(err) = jump_list(german) {
                log_error!("cannot fill the jump list: {err}");
            }
        });
        if let Err(err) = result {
            log_error!("cannot set up the taskbar: {err}");
        }
    }

    pub fn set_playback(app: &AppHandle, paused: bool, position: f64, duration: Option<f64>) {
        let result = app.run_on_main_thread(move || {
            BAR.with_borrow_mut(|bar| {
                if let Some(bar) = bar {
                    bar.show(paused, position, duration);
                }
            });
        });
        if let Err(err) = result {
            log_error!("cannot update the taskbar: {err}");
        }
    }

    /// A string property as the shell wants it: VT_LPWSTR in memory it frees.
    fn text_value(text: &str) -> windows::core::Result<PROPVARIANT> {
        let wide: Vec<u16> = text.encode_utf16().chain(Some(0)).collect();
        let mut value = PROPVARIANT::default();
        // SAFETY: the copy is as long as `wide`; PropVariantClear frees it with CoTaskMemFree.
        unsafe {
            let memory = CoTaskMemAlloc(wide.len() * 2).cast::<u16>();
            if memory.is_null() {
                return Err(windows::core::Error::from(E_FAIL));
            }
            memory.copy_from_nonoverlapping(wide.as_ptr(), wide.len());
            let inner = &mut value.Anonymous.Anonymous;
            inner.vt = VT_LPWSTR;
            inner.Anonymous.pwszVal = PWSTR(memory);
        }
        Ok(value)
    }

    /// Play / pause, next and previous in the taskbar button's jump list.
    fn jump_list(german: bool) -> windows::core::Result<()> {
        let program = std::env::current_exe().map_err(|_| windows::core::Error::from(E_FAIL))?;
        let program = HSTRING::from(program.as_os_str());
        // SAFETY: COM calls on the main thread; the objects release themselves when dropped.
        unsafe {
            let list: ICustomDestinationList =
                CoCreateInstance(&DestinationList, None, CLSCTX_INPROC_SERVER)?;
            let mut slots = 0u32;
            let _removed: IObjectArray = list.BeginList(&mut slots)?;
            let tasks: IObjectCollection =
                CoCreateInstance(&EnumerableObjectCollection, None, CLSCTX_INPROC_SERVER)?;
            for (glyph, argument, title) in [
                (
                    Glyph::Play,
                    "--play-pause",
                    if german {
                        "Wiedergabe / Pause"
                    } else {
                        "Play / Pause"
                    },
                ),
                (Glyph::Next, "--next", label(german, Glyph::Next)),
                (
                    Glyph::Previous,
                    "--previous",
                    label(german, Glyph::Previous),
                ),
            ] {
                let _ = glyph;
                let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
                link.SetPath(&program)?;
                link.SetArguments(&HSTRING::from(argument))?;
                link.SetIconLocation(&program, 0)?;
                let store: IPropertyStore = link.cast()?;
                let mut value = text_value(title)?;
                let set = store
                    .SetValue(&PKEY_Title, &value)
                    .and_then(|()| store.Commit());
                let _ = PropVariantClear(&mut value);
                set?;
                tasks.AddObject(&link)?;
            }
            let tasks: IObjectArray = tasks.cast()?;
            list.AddUserTasks(&tasks)?;
            list.CommitList()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn alpha_at(pixels: &[u8], x: usize, y: usize) -> u8 {
        pixels[(y * SIZE + x) * 4 + 3]
    }

    #[test]
    fn draws_white_shapes_on_transparent() {
        for glyph in [Glyph::Previous, Glyph::Play, Glyph::Pause, Glyph::Next] {
            let pixels = draw(glyph);
            assert_eq!(pixels.len(), SIZE * SIZE * 4);
            // The corners stay clear, something is drawn, and all of it is white.
            assert_eq!(alpha_at(&pixels, 0, 0), 0, "{glyph:?}");
            assert_eq!(alpha_at(&pixels, SIZE - 1, SIZE - 1), 0, "{glyph:?}");
            assert!(pixels.chunks(4).any(|p| p[3] == 255), "{glyph:?}");
            assert!(
                pixels.chunks(4).all(|p| p[..3] == [255, 255, 255]),
                "{glyph:?}"
            );
        }
        // Pause has a gap in the middle, play does not.
        assert_eq!(alpha_at(&draw(Glyph::Pause), SIZE / 2, SIZE / 2), 0);
        assert_eq!(alpha_at(&draw(Glyph::Play), SIZE / 2, SIZE / 2), 255);
        // Next points right: its left edge in the middle row is filled, previous mirrors that.
        assert!(alpha_at(&draw(Glyph::Next), 8, SIZE / 2) > 0);
        assert!(alpha_at(&draw(Glyph::Previous), SIZE - 9, SIZE / 2) > 0);
    }

    #[test]
    fn labels_in_both_languages() {
        assert_eq!(label(false, Glyph::Next), "Next");
        assert_eq!(label(true, Glyph::Previous), "Zurück");
    }
}
