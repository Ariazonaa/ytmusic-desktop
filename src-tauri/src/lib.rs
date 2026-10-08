// First, so that the other modules can use its macro.
#[macro_use]
mod log;

mod audio_device;
mod autostart;
mod background;
mod commands;
#[cfg(all(debug_assertions, windows))]
mod dev_inject;
mod health;
mod install;
mod notification;
mod offline;
mod plugins;
mod settings;
mod shortcuts;
mod themes;
mod tray;
mod watch;
mod window;

use settings::SettingsStore;
use tauri::{Manager, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_window_state::StateFlags;

pub fn run() {
    tauri::Builder::default()
        // Must be registered first. A second launch focuses the running app,
        // which may be hidden in the tray.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            window::show_main_window(app);
        }))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![autostart::ARGUMENT]),
        ))
        // Remembers size and position of the windows. Whether the main
        // window shows is decided here, see `start_in_tray`.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::all() - StateFlags::VISIBLE)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .register_uri_scheme_protocol(plugins::SCHEME, |context, request| {
            // An empty path matches nothing, so this answers 404 without a config directory.
            let dir = plugins::dir(context.app_handle()).unwrap_or_default();
            plugins::respond(&dir, request.uri().path())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::set_settings,
            commands::open_settings,
            commands::list_external_plugins,
            commands::open_plugins_folder,
            commands::reload_plugins,
            commands::restart_required,
            commands::restart_app,
            commands::list_shared,
            commands::save_shared,
            commands::open_shared_folder,
            commands::set_now_playing,
            commands::log_error,
            commands::open_log,
            commands::export_settings,
            commands::import_settings,
            commands::notify,
            commands::report_health,
            commands::get_health,
            commands::is_first_run,
            commands::install_plugin,
            commands::remove_plugin,
            commands::output_device
        ])
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            log::init(&config_dir);
            let store = SettingsStore::open(config_dir.join("settings.json"));
            let hidden = store.get().start_in_tray && autostart::launched_at_sign_in();
            let first_run = store.is_first_run();
            if first_run {
                // Writes the file, so that the next start is not a first one.
                if let Err(err) = store.set(store.get()) {
                    log_error!("cannot write the first settings file: {err}");
                }
            }
            autostart::sync(app.handle(), store.get().startup);
            if let Err(err) = shortcuts::apply(app.handle(), &store.get().shortcuts) {
                log_error!("shortcuts: {err}");
            }
            app.manage(store);
            app.manage(health::HealthStore::default());
            app.manage(commands::NotifyLimit::default());
            tray::create(app.handle(), &app.state::<SettingsStore>().get().language)?;
            window::create_main_window(app.handle(), hidden)?;
            watch::start(app.handle());
            if first_run && !hidden {
                // No plugin is on yet: the settings window is where to choose some.
                window::open_settings_window(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            let WindowEvent::CloseRequested { api, .. } = event else {
                return;
            };
            if window.label() != window::MAIN_WINDOW_LABEL {
                return;
            }
            if window.state::<SettingsStore>().get().minimize_to_tray {
                api.prevent_close();
                window::hide_main_window(window.app_handle());
            } else {
                // Without this an open settings window would keep the app alive.
                window.app_handle().exit(0);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
