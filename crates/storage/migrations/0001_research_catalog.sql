-- Claims blijven aan een concrete uitvoering en bron gekoppeld.
-- Geen DELETE CASCADE: verwijder geen herkomst door een catalogusrij te wissen.
CREATE TABLE manufacturers (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(name)) > 0),
    website TEXT
) STRICT;

CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    manufacturer_id INTEGER NOT NULL REFERENCES manufacturers(id),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    model_code TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL CHECK (kind IN ('battery_module', 'battery_system', 'inverter', 'controller', 'gateway', 'accessory')),
    UNIQUE (manufacturer_id, name, model_code)
) STRICT;

CREATE TABLE configurations (
    id INTEGER PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    variant_code TEXT NOT NULL DEFAULT '',
    hardware_revision TEXT NOT NULL DEFAULT '',
    UNIQUE (product_id, name, variant_code, hardware_revision)
) STRICT;

CREATE TABLE configuration_components (
    id INTEGER PRIMARY KEY,
    entry_id INTEGER NOT NULL REFERENCES research_entries(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    role TEXT NOT NULL CHECK (length(trim(role)) > 0),
    UNIQUE (entry_id, product_id, role)
) STRICT;

CREATE TABLE sources (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('datasheet', 'manual', 'warranty', 'compatibility_list', 'certification', 'independent_test', 'offer', 'product_page', 'other')),
    title TEXT NOT NULL CHECK (length(trim(title)) > 0),
    url TEXT NOT NULL CHECK (url LIKE 'https://_%' OR url LIKE 'http://_%' OR url LIKE 'urn:thuisaccu:manual:%'),
    document_revision TEXT,
    published_on TEXT CHECK (published_on IS NULL OR (
        length(published_on) = 10 AND date(published_on, '+0 days') IS NOT NULL
        AND date(published_on, '+0 days') = published_on
    )),
    retrieved_at_unix_s INTEGER NOT NULL CHECK (retrieved_at_unix_s >= 0),
    sha256 TEXT CHECK (sha256 IS NULL OR (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-fA-F]*')),
    archived_path TEXT
) STRICT;

CREATE TABLE research_entries (
    id INTEGER PRIMARY KEY,
    configuration_id INTEGER NOT NULL REFERENCES configurations(id),
    source_id INTEGER NOT NULL REFERENCES sources(id),
    locator TEXT NOT NULL CHECK (length(trim(locator)) > 0),
    observed_at_unix_s INTEGER NOT NULL CHECK (observed_at_unix_s >= 0),
    market TEXT NOT NULL CHECK (length(trim(market)) > 0),
    firmware_revision TEXT,
    review_status TEXT NOT NULL DEFAULT 'unreviewed' CHECK (review_status IN ('unreviewed', 'reviewed', 'disputed', 'superseded')),
    reviewed_by TEXT,
    reviewed_at_unix_s INTEGER,
    conditions TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    CHECK (
        (review_status = 'unreviewed' AND reviewed_by IS NULL AND reviewed_at_unix_s IS NULL)
        OR (review_status <> 'unreviewed' AND reviewed_by IS NOT NULL
            AND length(trim(reviewed_by)) > 0 AND reviewed_at_unix_s IS NOT NULL
            AND reviewed_at_unix_s >= observed_at_unix_s)
    )
) STRICT;

CREATE TABLE numeric_metrics (
    key TEXT PRIMARY KEY,
    unit TEXT NOT NULL,
    min_value REAL,
    max_value REAL,
    integer_only INTEGER NOT NULL DEFAULT 0 CHECK (integer_only IN (0, 1)),
    CHECK (min_value IS NULL OR max_value IS NULL OR min_value <= max_value)
) STRICT;

INSERT INTO numeric_metrics (key, unit, min_value, max_value, integer_only) VALUES
    ('nominal_energy_wh', 'Wh', 0.001, NULL, 0),
    ('usable_energy_wh', 'Wh', 0.001, NULL, 0),
    ('continuous_charge_power_w', 'W', 0, NULL, 0),
    ('continuous_discharge_power_w', 'W', 0, NULL, 0),
    ('peak_discharge_power_w', 'W', 0, NULL, 0),
    ('peak_duration_s', 's', 0, NULL, 0),
    ('apparent_power_va', 'VA', 0, NULL, 0),
    ('backup_power_w', 'W', 0, NULL, 0),
    ('round_trip_efficiency_pct', '%', 0, 100, 0),
    ('charge_efficiency_pct', '%', 0, 100, 0),
    ('discharge_efficiency_pct', '%', 0, 100, 0),
    ('depth_of_discharge_pct', '%', 0, 100, 0),
    ('standby_power_w', 'W', 0, NULL, 0),
    ('self_discharge_pct_per_month', '%/month', 0, 100, 0),
    ('cycle_life_cycles', 'cycles', 0, NULL, 1),
    ('end_of_life_capacity_pct', '%', 0, 100, 0),
    ('design_life_years', 'years', 0, NULL, 0),
    ('nominal_voltage_v', 'V', 0, NULL, 0),
    ('operating_voltage_v', 'V', 0, NULL, 0),
    ('continuous_charge_current_a', 'A', 0, NULL, 0),
    ('continuous_discharge_current_a', 'A', 0, NULL, 0),
    ('peak_current_a', 'A', 0, NULL, 0),
    ('grid_frequency_hz', 'Hz', 0, NULL, 0),
    ('phase_count', 'count', 1, NULL, 1),
    ('module_count', 'count', 1, NULL, 1),
    ('max_parallel_units', 'count', 1, NULL, 1),
    ('max_system_energy_wh', 'Wh', 0.001, NULL, 0),
    ('height_mm', 'mm', 0.001, NULL, 0),
    ('width_mm', 'mm', 0.001, NULL, 0),
    ('depth_mm', 'mm', 0.001, NULL, 0),
    ('weight_kg', 'kg', 0.001, NULL, 0),
    ('charge_temperature_c', 'degC', -273.15, NULL, 0),
    ('discharge_temperature_c', 'degC', -273.15, NULL, 0),
    ('storage_temperature_c', 'degC', -273.15, NULL, 0),
    ('noise_db_a', 'dB(A)', NULL, NULL, 0),
    ('max_altitude_m', 'm', NULL, NULL, 0),
    ('relative_humidity_pct', '%', 0, 100, 0),
    ('transfer_time_ms', 'ms', 0, NULL, 0),
    ('pv_input_power_w', 'W', 0, NULL, 0),
    ('mppt_count', 'count', 0, NULL, 1),
    ('system_performance_index_5kw_pct', '%', 0, 100, 0),
    ('system_performance_index_10kw_pct', '%', 0, 100, 0),
    ('settling_time_s', 's', 0, NULL, 0);

CREATE TABLE numeric_observations (
    id INTEGER PRIMARY KEY,
    entry_id INTEGER NOT NULL REFERENCES research_entries(id),
    metric_key TEXT NOT NULL REFERENCES numeric_metrics(key),
    qualifier TEXT NOT NULL CHECK (qualifier IN ('exact', 'approximate', 'at_least', 'at_most', 'range', 'less_than', 'greater_than')),
    value REAL NOT NULL CHECK (value > -1e308 AND value < 1e308),
    upper_value REAL CHECK (upper_value IS NULL OR (upper_value > -1e308 AND upper_value < 1e308)),
    boundary TEXT NOT NULL CHECK (boundary IN ('unspecified', 'battery_dc', 'system_ac', 'dc_dc', 'ac_ac', 'pv_ac')),
    reported_value TEXT NOT NULL CHECK (length(trim(reported_value)) > 0),
    test_temperature_c REAL CHECK (test_temperature_c >= -273.15 AND test_temperature_c < 1e308),
    test_power_w REAL CHECK (test_power_w >= 0 AND test_power_w < 1e308),
    test_soc_pct REAL CHECK (test_soc_pct BETWEEN 0 AND 100),
    test_depth_of_discharge_pct REAL CHECK (test_depth_of_discharge_pct BETWEEN 0 AND 100),
    test_c_rate REAL CHECK (test_c_rate >= 0 AND test_c_rate < 1e308),
    conditions TEXT NOT NULL DEFAULT '',
    CHECK ((qualifier = 'range' AND upper_value IS NOT NULL AND upper_value >= value)
        OR (qualifier <> 'range' AND upper_value IS NULL))
) STRICT;

-- Grenswaarden worden ook bij directe SQL-writes afgedwongen.
CREATE TRIGGER validate_numeric_insert BEFORE INSERT ON numeric_observations BEGIN
    SELECT RAISE(ABORT, 'numeric value outside metric bounds')
    WHERE EXISTS (SELECT 1 FROM numeric_metrics m WHERE m.key = NEW.metric_key AND (
        NEW.value < m.min_value OR NEW.value > m.max_value
        OR NEW.upper_value < m.min_value OR NEW.upper_value > m.max_value
        OR (m.integer_only = 1 AND (NEW.value <> CAST(NEW.value AS INTEGER)
            OR NEW.upper_value <> CAST(NEW.upper_value AS INTEGER)))
    ));
END;

CREATE TRIGGER validate_numeric_update BEFORE UPDATE ON numeric_observations BEGIN
    SELECT RAISE(ABORT, 'numeric value outside metric bounds')
    WHERE EXISTS (SELECT 1 FROM numeric_metrics m WHERE m.key = NEW.metric_key AND (
        NEW.value < m.min_value OR NEW.value > m.max_value
        OR NEW.upper_value < m.min_value OR NEW.upper_value > m.max_value
        OR (m.integer_only = 1 AND (NEW.value <> CAST(NEW.value AS INTEGER)
            OR NEW.upper_value <> CAST(NEW.upper_value AS INTEGER)))
    ));
END;

CREATE TABLE feature_observations (
    id INTEGER PRIMARY KEY,
    entry_id INTEGER NOT NULL REFERENCES research_entries(id),
    metric_key TEXT NOT NULL CHECK (metric_key IN (
        'backup', 'off_grid', 'black_start', 'three_phase_backup', 'asymmetric_output',
        'grid_charging', 'grid_export', 'dynamic_tariffs', 'local_api', 'remote_control',
        'offline_operation', 'cloud_required', 'subscription_required', 'indoor', 'outdoor',
        'expandable', 'inverter_included', 'ems_included'
    )),
    status TEXT NOT NULL CHECK (status IN ('supported', 'unsupported', 'conditional', 'unknown')),
    conditions TEXT NOT NULL DEFAULT '',
    CHECK (status <> 'conditional' OR length(trim(conditions)) > 0)
) STRICT;

CREATE TABLE text_observations (
    id INTEGER PRIMARY KEY,
    entry_id INTEGER NOT NULL REFERENCES research_entries(id),
    metric_key TEXT NOT NULL CHECK (metric_key IN (
        'chemistry', 'coupling', 'phase_topology', 'ip_rating', 'cooling', 'mounting',
        'communication', 'control_protocol', 'ems_provider', 'required_accessories',
        'installation_requirements', 'recycling', 'repairability', 'service_region'
    )),
    value TEXT NOT NULL CHECK (length(trim(value)) > 0),
    conditions TEXT NOT NULL DEFAULT ''
) STRICT;

CREATE TABLE warranty_terms (
    id INTEGER PRIMARY KEY,
    entry_id INTEGER NOT NULL REFERENCES research_entries(id),
    product_months INTEGER CHECK (product_months > 0),
    performance_months INTEGER CHECK (performance_months > 0),
    retained_capacity_pct REAL CHECK (retained_capacity_pct BETWEEN 0 AND 100),
    cycle_limit INTEGER CHECK (cycle_limit > 0),
    throughput_wh INTEGER CHECK (throughput_wh > 0),
    limit_rule TEXT NOT NULL CHECK (limit_rule IN ('first_reached', 'other', 'not_stated')),
    application TEXT NOT NULL CHECK (length(trim(application)) > 0),
    activation_required INTEGER CHECK (activation_required IN (0, 1)),
    internet_required INTEGER CHECK (internet_required IN (0, 1)),
    labour_included INTEGER CHECK (labour_included IN (0, 1)),
    transferable INTEGER CHECK (transferable IN (0, 1)),
    exclusions TEXT NOT NULL DEFAULT ''
) STRICT;

CREATE TABLE compatibility_claims (
    id INTEGER PRIMARY KEY,
    entry_id INTEGER NOT NULL REFERENCES research_entries(id),
    counterpart_product_id INTEGER NOT NULL REFERENCES products(id),
    status TEXT NOT NULL CHECK (status IN ('compatible', 'incompatible', 'conditional', 'required')),
    counterpart_firmware TEXT,
    battery_firmware TEXT,
    min_modules INTEGER CHECK (min_modules > 0),
    max_modules INTEGER CHECK (max_modules > 0),
    min_parallel_units INTEGER CHECK (min_parallel_units > 0),
    max_parallel_units INTEGER CHECK (max_parallel_units > 0),
    conditions TEXT NOT NULL DEFAULT '',
    CHECK (min_modules IS NULL OR max_modules IS NULL OR min_modules <= max_modules),
    CHECK (min_parallel_units IS NULL OR max_parallel_units IS NULL OR min_parallel_units <= max_parallel_units),
    CHECK (status <> 'conditional' OR length(trim(conditions)) > 0)
) STRICT;

CREATE TABLE conformity_claims (
    id INTEGER PRIMARY KEY,
    entry_id INTEGER NOT NULL REFERENCES research_entries(id),
    standard TEXT NOT NULL CHECK (length(trim(standard)) > 0),
    edition TEXT,
    status TEXT NOT NULL CHECK (status IN ('claimed', 'certified', 'tested', 'pending')),
    certificate_reference TEXT,
    conditions TEXT NOT NULL DEFAULT ''
) STRICT;

CREATE TABLE offers (
    id INTEGER PRIMARY KEY,
    entry_id INTEGER NOT NULL REFERENCES research_entries(id),
    seller TEXT NOT NULL CHECK (length(trim(seller)) > 0),
    currency TEXT NOT NULL CHECK (length(currency) = 3 AND currency NOT GLOB '*[^A-Z]*'),
    minor_unit_exponent INTEGER NOT NULL CHECK (minor_unit_exponent BETWEEN 0 AND 4),
    upfront_amount_minor INTEGER NOT NULL CHECK (upfront_amount_minor >= 0),
    recurring_amount_minor INTEGER CHECK (recurring_amount_minor >= 0),
    recurring_period TEXT CHECK (recurring_period IN ('month', 'year')),
    tax_basis TEXT NOT NULL CHECK (tax_basis IN ('included', 'excluded', 'unknown')),
    tax_rate_bps INTEGER CHECK (tax_rate_bps >= 0),
    includes_battery INTEGER CHECK (includes_battery IN (0, 1)),
    includes_inverter INTEGER CHECK (includes_inverter IN (0, 1)),
    includes_gateway INTEGER CHECK (includes_gateway IN (0, 1)),
    includes_installation INTEGER CHECK (includes_installation IN (0, 1)),
    includes_delivery INTEGER CHECK (includes_delivery IN (0, 1)),
    valid_until_unix_s INTEGER CHECK (valid_until_unix_s >= 0),
    availability TEXT NOT NULL CHECK (availability IN ('in_stock', 'preorder', 'out_of_stock', 'on_request', 'unknown')),
    additional_costs_notes TEXT NOT NULL DEFAULT '',
    CHECK ((recurring_amount_minor IS NULL AND recurring_period IS NULL)
        OR (recurring_amount_minor IS NOT NULL AND recurring_period IS NOT NULL))
) STRICT;

CREATE INDEX idx_products_manufacturer ON products(manufacturer_id);
CREATE INDEX idx_configurations_product ON configurations(product_id);
CREATE INDEX idx_components_product ON configuration_components(product_id);
CREATE INDEX idx_entries_config_date ON research_entries(configuration_id, observed_at_unix_s);
CREATE INDEX idx_entries_source ON research_entries(source_id);
CREATE INDEX idx_numeric_entry ON numeric_observations(entry_id);
CREATE INDEX idx_numeric_metric_value ON numeric_observations(metric_key, boundary, value);
CREATE INDEX idx_feature_entry ON feature_observations(entry_id);
CREATE INDEX idx_text_entry ON text_observations(entry_id);
CREATE INDEX idx_warranty_entry ON warranty_terms(entry_id);
CREATE INDEX idx_compatibility_entry ON compatibility_claims(entry_id);
CREATE INDEX idx_compatibility_product ON compatibility_claims(counterpart_product_id);
CREATE INDEX idx_conformity_entry ON conformity_claims(entry_id);
CREATE INDEX idx_offers_entry ON offers(entry_id);

-- Onderzoeksview behoudt alle bronnen, ook ongereviewde en tegenstrijdige claims.
CREATE VIEW numeric_research AS
SELECT n.*, m.unit, e.configuration_id, e.source_id, e.locator,
    e.observed_at_unix_s, e.market, e.firmware_revision, e.review_status,
    e.reviewed_by, e.reviewed_at_unix_s,
    e.conditions AS entry_conditions, e.notes,
    s.title AS source_title, s.url AS source_url, s.kind AS source_kind,
    s.document_revision, s.published_on, s.retrieved_at_unix_s,
    s.sha256, s.archived_path,
    c.name AS configuration_name, c.variant_code, c.hardware_revision,
    p.id AS product_id, p.name AS product_name, p.model_code, p.kind AS product_kind,
    f.name AS manufacturer_name
FROM numeric_observations n
JOIN numeric_metrics m ON m.key = n.metric_key
JOIN research_entries e ON e.id = n.entry_id
JOIN sources s ON s.id = e.source_id
JOIN configurations c ON c.id = e.configuration_id
JOIN products p ON p.id = c.product_id
JOIN manufacturers f ON f.id = p.manufacturer_id;
