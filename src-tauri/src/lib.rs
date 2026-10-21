// First, so that the other modules can use its macro.
#[macro_use]
mod log;

mod audio_device;
mod audio_output;
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
mod mini;
mod notification;
mod now_playing;
mod offline;
mod plugins;
mod portable;
mod settings;
mod shortcuts;
mod sleep;
mod stats;
mod taskbar;
mod themes;
mod tray;
mod unload;
mod update;
mod watch;
mod webauthn;
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
        // Before anything can ask for a plugin's files.
        .manage(frames::FrameGuard::default())
        .manage(sleep::SleepTimer::default())
        .manage(mini::MiniPlayer::default())
        // Must be registered first. A second launch focuses the running app,
        // which may be hidden in the tray.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            let args: Vec<String> = args.into_iter().skip(1).collect();
            if args.iter().any(|arg| arg == "--mini-player") {
                mini::toggle(app);
                return;
            }
            // `--output=<device>` or `--output=default` chooses the sound's device.
            if let Some(name) = args.iter().find_map(|arg| arg.strip_prefix("--output=")) {
                let name = if name == "default" { "" } else { name };
                commands::set_output_device(app, name);
                return;
            }
            // `--sleep=30` and the like set the sleep timer of the running app.
            if let Some(choice) = sleep::from_args(args.iter().cloned()) {
                sleep::set(app, choice);
                return;
            }
            // `--next` and the like control the running app and leave its window as it is.
            if let Some(action) = window::player_action(args.iter().cloned()) {
                window::control_player(app, action);
                return;
            }
            // A click on a notification, which Windows passes on as a link.
            if let Some(click_id) = notification::clicked_link(&args) {
                notification::clicked(app, click_id);
                return;
            }
            match window::music_link(args) {
                Some(link) => window::open_music_link(app, link),
                None => window::show_main_window(app),
            }
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
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .register_uri_scheme_protocol(plugins::SCHEME, |context, request| {
            // An empty path matches nothing, so this answers 404 without a config directory.
            let dir = plugins::dir(context.app_handle()).unwrap_or_default();
            let guarded = context.app_handle().state::<frames::FrameGuard>().active();
            plugins::serve(&dir, request.uri().path(), guarded)
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
            commands::set_playback,
            commands::sleep_done,
            commands::mini_player_state,
            commands::mini_player_control,
            commands::mini_player_close,
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
            commands::portable_folder,
            commands::pending_update,
            commands::check_update,
            commands::install_update,
            commands::discord_set_activity,
            commands::discord_clear_activity,
            commands::discord_preview,
            commands::marketplace_list,
            commands::marketplace_install,
            commands::marketplace_open_homepage,
            commands::open_repository,
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
            commands::open_link,
            commands::webauthn_get,
            commands::webauthn_cancel
        ])
        .setup(|app| {
            let config_dir = portable::config_dir(app.handle())?;
            log::init(&config_dir);
            if let Some(problem) = portable::problem() {
                log_error!("portable mode is off: {problem}");
            }
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
            app.manage(audio_output::Outputs::default());
            app.manage(unload::Unloader::default());
            #[cfg(target_os = "linux")]
            app.manage(webauthn::WebAuthn::default());
            // Without a tray icon (on Linux it fails when the runtime directory
            // cannot be written) the app runs on, its window shows at start,
            // and closing it ends the app: nothing else could bring it back.
            let has_tray = match tray::create(app.handle(), &app.state::<SettingsStore>().get()) {
                Ok(()) => true,
                Err(err) => {
                    log_error!("no tray icon: {err}");
                    false
                }
            };
            let hidden = hidden && has_tray;
            let link = window::music_link(std::env::args().skip(1));
            window::create_main_window(app.handle(), hidden, link)?;
            watch::start(app.handle());
            audio_output::start(app.handle());
            unload::start(app.handle());
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
            if window.state::<SettingsStore>().get().minimize_to_tray
                && tray::exists(window.app_handle())
            {
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
