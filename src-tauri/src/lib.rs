// Beatrice - Beatbox to Synth Beat Generator
// Module declarations

use tauri::Manager;

mod arranger;
mod audio;
mod commands;
mod events;
mod groove;
mod pipeline;
mod render;
mod state;
mod themes;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Initialize database
            let db = state::init_db()
                .map_err(|e| {
                    log::error!("Failed to initialize database: {}", e);
                    e
                })
                .expect("Failed to initialize database");

            // Add database to managed state
            app.manage(db);

            // Add recorder state
            app.manage(commands::RecorderState::default());

            log::info!("Beatrice initialized successfully");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::greet,
            commands::create_project,
            commands::get_project,
            commands::list_projects,
            commands::create_run,
            commands::get_run,
            commands::list_runs_for_project,
            commands::get_run_with_artifacts,
            commands::update_run_status,
            commands::create_artifact,
            commands::list_calibration_profiles,
            commands::create_calibration_profile,
            commands::get_calibration_profile,
            commands::update_calibration_profile,
            commands::delete_calibration_profile,
            commands::detect_onsets,
            commands::detect_events,
            commands::extract_features,
            commands::estimate_tempo,
            commands::quantize_events_command,
            commands::arrange_events_command,
            commands::export_midi_command,
            commands::list_themes,
            commands::get_theme,
            commands::list_theme_names,
            commands::render_preview,
            commands::start_recording,
            commands::stop_recording,
            commands::is_recording,
            commands::get_recording_level,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
