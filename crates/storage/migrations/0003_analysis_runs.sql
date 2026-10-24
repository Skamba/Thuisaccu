CREATE TABLE analysis_runs (
    id INTEGER PRIMARY KEY,
    solar_import_id INTEGER NOT NULL REFERENCES solar_imports(id),
    created_at_unix_s INTEGER NOT NULL,
    model_version TEXT NOT NULL,
    title TEXT NOT NULL CHECK (length(trim(title)) > 0),
    profile_sha256 TEXT NOT NULL CHECK (length(profile_sha256) = 64),
    input_json TEXT NOT NULL CHECK (json_valid(input_json)),
    result_json TEXT NOT NULL CHECK (json_valid(result_json))
) STRICT;

CREATE INDEX idx_analysis_solar ON analysis_runs(solar_import_id);
