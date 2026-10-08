fn main() {
    // Declaring the app commands makes them permission-gated: a webview can
    // only call them through a capability that allows them.
    let manifest = tauri_build::AppManifest::new().commands(&[
        "get_settings",
        "set_settings",
        "open_settings",
        "list_external_plugins",
        "open_plugins_folder",
        "reload_plugins",
        "restart_required",
        "restart_app",
        "list_shared",
        "save_shared",
        "open_shared_folder",
        "set_now_playing",
        "log_error",
        "open_log",
        "export_settings",
        "import_settings",
        "notify",
        "report_health",
        "get_health",
        "is_first_run",
        "install_plugin",
        "remove_plugin",
        "output_device",
    ]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest))
        .expect("failed to run tauri-build");
}
