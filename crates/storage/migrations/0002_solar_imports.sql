CREATE TABLE solar_imports (
    id INTEGER PRIMARY KEY,
    filename TEXT NOT NULL CHECK (length(trim(filename)) > 0),
    sha256 TEXT NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
    imported_at_unix_s INTEGER NOT NULL CHECK (imported_at_unix_s >= 0),
    options_json TEXT NOT NULL CHECK (json_valid(options_json)),
    summary_json TEXT NOT NULL CHECK (json_valid(summary_json)),
    UNIQUE (sha256, options_json)
) STRICT;

CREATE TABLE solar_intervals (
    import_id INTEGER NOT NULL REFERENCES solar_imports(id),
    start_unix_s INTEGER NOT NULL,
    end_unix_s INTEGER NOT NULL CHECK (end_unix_s > start_unix_s),
    production_wh REAL NOT NULL CHECK (production_wh >= 0 AND production_wh < 1e308),
    consumption_wh REAL CHECK (consumption_wh >= 0 AND consumption_wh < 1e308),
    PRIMARY KEY (import_id, start_unix_s)
) STRICT;

CREATE TABLE reference_imports (
    key TEXT PRIMARY KEY,
    imported_at_unix_s INTEGER NOT NULL
) STRICT;
