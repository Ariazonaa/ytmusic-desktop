// First, so that the other modules can use its macro.
#[macro_use]
mod log;

mod audio_device;
mod autostart;
mod background;
mod commands;
mod cover;
#[cfg(all(debug_assertions, windows))]
mod dev_inject;
mod discord;
mod download;
mod frames;
mod health;
mod install;
mod marketplace;
mod notification;
mod now_playing;
mod offline;
mod plugins;
mod settings;
mod shortcuts;
mod stats;
mod themes;
mod tray;
mod update;
mod watch;
mod webview_runtime;
mod window;

use settings::SettingsStore;
use tauri::{Manager, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_window_state::StateFlags;

pub fn run() {
    #[cfg(windows)]
    webview_runtime::use_unregistered_runtime();
    tauri::Builder::default()
        .manage(frames::FrameIsolation::default())
        // Must be registered first. A second launch focuses the running app,
        // which may be hidden in the tray.
        .plugin(tauri_plugin_single_instance::init(
            |app, args, _cwd| match window::music_link(args.into_iter().skip(1)) {
                Some(link) => window::open_music_link(app, link),
                None => window::show_main_window(app),
            },
        ))
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .register_uri_scheme_protocol(plugins::SCHEME, |context, request| {
            // An empty path matches nothing, so this answers 404 without a config directory.
            let dir = plugins::dir(context.app_handle()).unwrap_or_default();
            plugins::respond(
                &dir,
                request.uri().path(),
                &context.app_handle().state::<frames::FrameIsolation>(),
            )
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::update_settings,
            commands::update_plugin_settings,
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
            commands::output_device,
            commands::app_version,
            commands::pending_update,
            commands::check_update,
            commands::install_update,
            commands::discord_set_activity,
            commands::discord_clear_activity,
            commands::discord_preview,
            commands::marketplace_list,
            commands::marketplace_install,
            commands::marketplace_open_homepage,
            commands::save_cover,
            commands::now_playing_update,
            commands::now_playing_serve,
            commands::open_now_playing_folder,
            commands::stats_record,
            commands::stats_summary,
            commands::stats_clear,
            commands::save_text,
            commands::lyrics_overlay,
            commands::lyrics_overlay_line,
            commands::open_link
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
            app.manage(commands::OpenLimit::default());
            app.manage(marketplace::MarketStore::default());
            app.manage(now_playing::NowPlaying::default());
            app.manage(stats::StatsStore::default());
            app.manage(update::UpdateStore::default());
            app.manage(discord::Discord::default());
            tray::create(app.handle(), &app.state::<SettingsStore>().get().language)?;
            let link = window::music_link(std::env::args().skip(1));
            window::create_main_window(app.handle(), hidden, link)?;
            watch::start(app.handle());
            update::check_at_start(app.handle());
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
