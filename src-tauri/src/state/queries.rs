// Database CRUD operations
use chrono::Utc;
use rusqlite::params;
use uuid::Uuid;

use super::db::{DbConnection, DbResult};
use super::models::{
    Artifact, ArtifactKind, CalibrationProfile, Project, ProjectSummary, Run, RunStatus,
    RunWithArtifacts,
};

// ==================== PROJECT QUERIES ====================

/// Create a new project
pub fn create_project(
    db: &DbConnection,
    name: String,
    input_path: String,
    input_sha256: String,
    duration_ms: i64,
) -> DbResult<Project> {
    let project = Project {
        id: Uuid::new_v4(),
        created_at: Utc::now(),
        name,
        input_path,
        input_sha256,
        duration_ms,
    };

    let conn = db.lock();
    conn.execute(
        "INSERT INTO projects (id, created_at, name, input_path, input_sha256, duration_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            project.id.to_string(),
            project.created_at.to_rfc3339(),
            project.name,
            project.input_path,
            project.input_sha256,
            project.duration_ms,
        ],
    )?;

    Ok(project)
}

/// Get a project by ID
pub fn get_project(db: &DbConnection, id: &Uuid) -> DbResult<Option<Project>> {
    let conn = db.lock();
    let mut stmt = conn.prepare(
        "SELECT id, created_at, name, input_path, input_sha256, duration_ms
         FROM projects WHERE id = ?1",
    )?;

    let result = stmt.query_row([id.to_string()], |row| {
        Ok(Project {
            id: Uuid::parse_str(&row.get::<_, String>(0)?).unwrap(),
            created_at: row.get::<_, String>(1)?.parse().unwrap(),
            name: row.get(2)?,
            input_path: row.get(3)?,
            input_sha256: row.get(4)?,
            duration_ms: row.get(5)?,
        })
    });

    match result {
        Ok(project) => Ok(Some(project)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// List all projects with run counts
pub fn list_projects(db: &DbConnection) -> DbResult<Vec<ProjectSummary>> {
    let conn = db.lock();
    let mut stmt = conn.prepare(
        "SELECT p.id, p.name, p.created_at, p.duration_ms,
                COUNT(r.id) as run_count
         FROM projects p
         LEFT JOIN runs r ON p.id = r.project_id
         GROUP BY p.id
         ORDER BY p.created_at DESC",
    )?;

    let projects = stmt
        .query_map([], |row| {
            Ok(ProjectSummary {
                id: Uuid::parse_str(&row.get::<_, String>(0)?).unwrap(),
                name: row.get(1)?,
                created_at: row.get::<_, String>(2)?.parse().unwrap(),
                duration_ms: row.get(3)?,
                run_count: row.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(projects)
}

// ==================== RUN QUERIES ====================

/// Create a new run
pub fn create_run(
    db: &DbConnection,
    project_id: Uuid,
    pipeline_version: String,
    theme: String,
    bpm: f64,
    swing: f64,
    quantize_strength: f64,
    b_emphasis: f64,
) -> DbResult<Run> {
    let run = Run {
        id: Uuid::new_v4(),
        project_id,
        created_at: Utc::now(),
        pipeline_version,
        theme,
        bpm,
        swing,
        quantize_strength,
        b_emphasis,
        status: RunStatus::Pending,
    };

    let conn = db.lock();
    conn.execute(
        "INSERT INTO runs (id, project_id, created_at, pipeline_version, theme, bpm, swing, quantize_strength, b_emphasis, status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            run.id.to_string(),
            run.project_id.to_string(),
            run.created_at.to_rfc3339(),
            run.pipeline_version,
            run.theme,
            run.bpm,
            run.swing,
            run.quantize_strength,
            run.b_emphasis,
            run.status.to_string(),
        ],
    )?;

    Ok(run)
}

/// Get a run by ID
pub fn get_run(db: &DbConnection, id: &Uuid) -> DbResult<Option<Run>> {
    let conn = db.lock();
    let mut stmt = conn.prepare(
        "SELECT id, project_id, created_at, pipeline_version, theme, bpm, swing, quantize_strength, b_emphasis, status
         FROM runs WHERE id = ?1",
    )?;

    let result = stmt.query_row([id.to_string()], |row| {
        Ok(Run {
            id: Uuid::parse_str(&row.get::<_, String>(0)?).unwrap(),
            project_id: Uuid::parse_str(&row.get::<_, String>(1)?).unwrap(),
            created_at: row.get::<_, String>(2)?.parse().unwrap(),
            pipeline_version: row.get(3)?,
            theme: row.get(4)?,
            bpm: row.get(5)?,
            swing: row.get(6)?,
            quantize_strength: row.get(7)?,
            b_emphasis: row.get(8)?,
            status: RunStatus::from_string(&row.get::<_, String>(9)?),
        })
    });

    match result {
        Ok(run) => Ok(Some(run)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// List all runs for a project
pub fn list_runs_for_project(db: &DbConnection, project_id: &Uuid) -> DbResult<Vec<Run>> {
    let conn = db.lock();
    let mut stmt = conn.prepare(
        "SELECT id, project_id, created_at, pipeline_version, theme, bpm, swing, quantize_strength, b_emphasis, status
         FROM runs WHERE project_id = ?1
         ORDER BY created_at DESC",
    )?;

    let runs = stmt
        .query_map([project_id.to_string()], |row| {
            Ok(Run {
                id: Uuid::parse_str(&row.get::<_, String>(0)?).unwrap(),
                project_id: Uuid::parse_str(&row.get::<_, String>(1)?).unwrap(),
                created_at: row.get::<_, String>(2)?.parse().unwrap(),
                pipeline_version: row.get(3)?,
                theme: row.get(4)?,
                bpm: row.get(5)?,
                swing: row.get(6)?,
                quantize_strength: row.get(7)?,
                b_emphasis: row.get(8)?,
                status: RunStatus::from_string(&row.get::<_, String>(9)?),
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(runs)
}

/// Update run status
pub fn update_run_status(db: &DbConnection, run_id: &Uuid, status: RunStatus) -> DbResult<()> {
    let conn = db.lock();
    conn.execute(
        "UPDATE runs SET status = ?1 WHERE id = ?2",
        params![status.to_string(), run_id.to_string()],
    )?;
    Ok(())
}

// ==================== ARTIFACT QUERIES ====================

/// Create a new artifact
pub fn create_artifact(
    db: &DbConnection,
    run_id: Uuid,
    kind: ArtifactKind,
    path: String,
    sha256: String,
    bytes: i64,
) -> DbResult<Artifact> {
    let artifact = Artifact {
        id: Uuid::new_v4(),
        run_id,
        kind,
        path,
        sha256,
        bytes,
    };

    let conn = db.lock();
    conn.execute(
        "INSERT INTO artifacts (id, run_id, kind, path, sha256, bytes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            artifact.id.to_string(),
            artifact.run_id.to_string(),
            artifact.kind.to_string(),
            artifact.path,
            artifact.sha256,
            artifact.bytes,
        ],
    )?;

    Ok(artifact)
}

/// Get all artifacts for a run
pub fn get_artifacts_for_run(db: &DbConnection, run_id: &Uuid) -> DbResult<Vec<Artifact>> {
    let conn = db.lock();
    let mut stmt = conn.prepare(
        "SELECT id, run_id, kind, path, sha256, bytes
         FROM artifacts WHERE run_id = ?1",
    )?;

    let artifacts = stmt
        .query_map([run_id.to_string()], |row| {
            Ok(Artifact {
                id: Uuid::parse_str(&row.get::<_, String>(0)?).unwrap(),
                run_id: Uuid::parse_str(&row.get::<_, String>(1)?).unwrap(),
                kind: ArtifactKind::from_string(&row.get::<_, String>(2)?),
                path: row.get(3)?,
                sha256: row.get(4)?,
                bytes: row.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(artifacts)
}

/// Get a run with all its artifacts
pub fn get_run_with_artifacts(db: &DbConnection, run_id: &Uuid) -> DbResult<Option<RunWithArtifacts>> {
    let run = match get_run(db, run_id)? {
        Some(r) => r,
        None => return Ok(None),
    };

    let artifacts = get_artifacts_for_run(db, run_id)?;

    Ok(Some(RunWithArtifacts { run, artifacts }))
}

// ==================== CALIBRATION PROFILE QUERIES ====================

/// Create a new calibration profile
pub fn create_calibration_profile(
    db: &DbConnection,
    name: String,
    profile_json_path: String,
    notes: Option<String>,
) -> DbResult<CalibrationProfile> {
    let profile = CalibrationProfile {
        id: Uuid::new_v4(),
        name,
        created_at: Utc::now(),
        profile_json_path,
        notes,
    };

    let conn = db.lock();
    conn.execute(
        "INSERT INTO calibration_profiles (id, name, created_at, profile_json_path, notes)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            profile.id.to_string(),
            profile.name,
            profile.created_at.to_rfc3339(),
            profile.profile_json_path,
            profile.notes,
        ],
    )?;

    Ok(profile)
}

/// Get a calibration profile by ID
pub fn get_calibration_profile(
    db: &DbConnection,
    id: &Uuid,
) -> DbResult<Option<CalibrationProfile>> {
    let conn = db.lock();
    let mut stmt = conn.prepare(
        "SELECT id, name, created_at, profile_json_path, notes
         FROM calibration_profiles WHERE id = ?1",
    )?;

    let result = stmt.query_row([id.to_string()], |row| {
        Ok(CalibrationProfile {
            id: Uuid::parse_str(&row.get::<_, String>(0)?).unwrap(),
            name: row.get(1)?,
            created_at: row.get::<_, String>(2)?.parse().unwrap(),
            profile_json_path: row.get(3)?,
            notes: row.get(4)?,
        })
    });

    match result {
        Ok(profile) => Ok(Some(profile)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// List all calibration profiles
pub fn list_calibration_profiles(db: &DbConnection) -> DbResult<Vec<CalibrationProfile>> {
    let conn = db.lock();
    let mut stmt = conn.prepare(
        "SELECT id, name, created_at, profile_json_path, notes
         FROM calibration_profiles
         ORDER BY created_at DESC",
    )?;

    let profiles = stmt
        .query_map([], |row| {
            Ok(CalibrationProfile {
                id: Uuid::parse_str(&row.get::<_, String>(0)?).unwrap(),
                name: row.get(1)?,
                created_at: row.get::<_, String>(2)?.parse().unwrap(),
                profile_json_path: row.get(3)?,
                notes: row.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(profiles)
}

/// Update a calibration profile
pub fn update_calibration_profile(
    db: &DbConnection,
    id: &Uuid,
    name: Option<String>,
    notes: Option<String>,
) -> DbResult<()> {
    let conn = db.lock();

    if let Some(name) = name {
        conn.execute(
            "UPDATE calibration_profiles SET name = ?1 WHERE id = ?2",
            params![name, id.to_string()],
        )?;
    }

    if let Some(notes) = notes {
        conn.execute(
            "UPDATE calibration_profiles SET notes = ?1 WHERE id = ?2",
            params![notes, id.to_string()],
        )?;
    }

    Ok(())
}

/// Delete a calibration profile
pub fn delete_calibration_profile(db: &DbConnection, id: &Uuid) -> DbResult<()> {
    let conn = db.lock();
    conn.execute(
        "DELETE FROM calibration_profiles WHERE id = ?1",
        params![id.to_string()],
    )?;
    Ok(())
}
