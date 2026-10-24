//! Bestandsadapters: geen aannames over een specifiek omvormermerk.

use std::{collections::BTreeMap, io::Cursor};

use calamine::{Data, Reader, open_workbook_auto_from_rs};
use chrono::{DateTime, Duration, Months, NaiveDate, NaiveDateTime, TimeZone, Utc};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};
use thuisaccu_storage::solar::{SolarInterval, SolarPeriod, SolarSummary};

pub const MAX_ROWS: usize = 250_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ImportOptions {
    pub profile: String,
    pub sheet: Option<String>,
    pub header_row: usize,
    pub delimiter: String,
    pub decimal: String,
    pub time_column: usize,
    pub time_part_column: Option<usize>,
    pub production_column: usize,
    pub consumption_column: Option<usize>,
    /// `gross`: de verbruikskolom is bruto huishoudelijk verbruik. `net_meter`: de
    /// verbruikskolom is netafname en `export_column` netteruglevering (bijvoorbeeld P1);
    /// bruto verbruik = opwek + netafname − teruglevering.
    pub consumption_source: String,
    pub export_column: Option<usize>,
    pub unit: String,
    pub mode: String,
    pub period: String,
    pub timezone: String,
    pub timestamp_position: String,
    pub data_kind: String,
    pub date_order: String,
    pub missing_rows: String,
}

impl Default for ImportOptions {
    fn default() -> Self {
        Self {
            profile: "generic".into(),
            sheet: None,
            header_row: 0,
            delimiter: "auto".into(),
            decimal: "dot".into(),
            time_column: 0,
            time_part_column: None,
            production_column: 1,
            consumption_column: None,
            consumption_source: "gross".into(),
            export_column: None,
            unit: "kwh".into(),
            mode: "interval".into(),
            period: "hour".into(),
            timezone: "UTC".into(),
            timestamp_position: "start".into(),
            data_kind: "measured".into(),
            date_order: "day_first".into(),
            missing_rows: "reject".into(),
        }
    }
}

#[derive(Debug)]
pub struct Table {
    pub detected_unit: Option<String>,
    pub detected_period: Option<String>,
    pub headers: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub sheets: Vec<String>,
}

#[derive(Serialize)]
pub struct Inspection {
    pub detected_unit: Option<String>,
    pub detected_period: Option<String>,
    pub headers: Vec<String>,
    pub preview: Vec<Vec<String>>,
    pub sheets: Vec<String>,
    pub row_count: usize,
}

impl Table {
    pub fn inspection(&self) -> Inspection {
        Inspection {
            detected_unit: self.detected_unit.clone(),
            detected_period: self.detected_period.clone(),
            headers: self.headers.clone(),
            preview: self.rows.iter().take(8).cloned().collect(),
            sheets: self.sheets.clone(),
            row_count: self.rows.len(),
        }
    }
}

pub fn read_table(filename: &str, bytes: &[u8], options: &ImportOptions) -> Result<Table, String> {
    let ext = filename
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    let mut sheets = Vec::new();
    let mut detected_unit = None;
    let mut detected_period = None;
    let mut rows: Vec<Vec<String>> = match ext.as_str() {
        "csv" | "tsv" | "txt" => {
            let text = std::str::from_utf8(bytes).map_err(|_| "CSV moet UTF-8 zijn; exporteer opnieuw als UTF-8 of Excel.")?.trim_start_matches('\u{feff}');
            let first = text.lines().nth(options.header_row).ok_or("Kopregel ligt buiten het bestand.")?;
            let delimiter = match options.delimiter.as_str() {
                "semicolon" => b';', "comma" => b',', "tab" => b'\t',
                "auto" => if first.contains(';') { b';' } else if first.contains('\t') { b'\t' } else { b',' },
                _ => return Err("Onbekend scheidingsteken.".into()),
            };
            let text = text.lines().skip(options.header_row).collect::<Vec<_>>().join("\n");
            let mut reader = csv::ReaderBuilder::new().delimiter(delimiter).has_headers(false).flexible(false).from_reader(text.as_bytes());
            let mut result = Vec::new();
            for record in reader.records().take(MAX_ROWS + 2) {
                result.push(record.map_err(|e| format!("CSV: {e}"))?.iter().map(|v| v.trim().to_owned()).collect());
            }
            result
        },
        "xlsx" | "xls" | "ods" => {
            let mut workbook = open_workbook_auto_from_rs(Cursor::new(bytes.to_vec())).map_err(|e| format!("Spreadsheet: {e}"))?;
            sheets = workbook.sheet_names();
            let name = options.sheet.as_ref().or(sheets.first()).ok_or("Geen werkblad gevonden.")?;
            let range = workbook.worksheet_range(name).map_err(|e| format!("Werkblad: {e}"))?;
            if range.height() > MAX_ROWS + options.header_row + 1 || range.width() > 200 {
                return Err("Werkblad is te groot: maximaal 250.000 gegevensrijen en 200 kolommen.".into());
            }
            range.rows().skip(options.header_row).map(|row| row.iter().map(|cell| match cell {
                Data::DateTime(date) => date.as_datetime().map(|d| d.format("%Y-%m-%d %H:%M:%S").to_string()).unwrap_or_else(|| cell.to_string()),
                Data::Float(value) if options.decimal == "comma" => value.to_string().replace('.', ","),
                _ => cell.to_string(),
            }).collect()).collect()
        },
        "json" => {
            if options.header_row != 0 { return Err("Kopregels overslaan geldt niet voor JSON.".into()); }
            let value: serde_json::Value = serde_json::from_slice(bytes).map_err(|e| format!("JSON: {e}"))?;
            if let Some(energy) = value.get("energy") {
                detected_unit = energy.get("unit").and_then(|v| v.as_str()).map(str::to_ascii_lowercase);
                detected_period = energy.get("timeUnit").and_then(|v| v.as_str()).map(|v| match v {
                    "QUARTER_OF_AN_HOUR" => "15min", "HOUR" => "hour", "DAY" => "day",
                    "WEEK" => "week", "MONTH" => "month", "YEAR" => "year", _ => "unsupported",
                }.to_owned());
            }
            let array = value.as_array().or_else(|| value.get("data").and_then(|v| v.as_array()))
                .or_else(|| value.get("outputs").and_then(|v| v.get("hourly")).and_then(|v| v.as_array()))
                .or_else(|| value.get("energy").and_then(|v| v.get("values")).and_then(|v| v.as_array()))
                .ok_or("JSON moet een array van objecten bevatten, een data-array of PVGIS 5 outputs.hourly.")?;
            if array.len() > MAX_ROWS { return Err("Maximaal 250.000 gegevensrijen.".into()); }
            let mut keys = std::collections::BTreeSet::new();
            for item in array {
                let object = item.as_object().ok_or("JSON-gegevens moeten objecten zijn.")?;
                keys.extend(object.keys().cloned());
                if keys.len() > 200 { return Err("Maximaal 200 kolommen.".into()); }
            }
            let headers: Vec<_> = keys.into_iter().collect();
            let mut result = vec![headers.clone()];
            for (index, item) in array.iter().enumerate() {
                let object = item.as_object().ok_or_else(|| format!("JSON-rij {} is geen object.", index + 1))?;
                result.push(headers.iter().map(|key| match object.get(key).unwrap_or(&serde_json::Value::Null) {
                    serde_json::Value::String(v) => v.clone(),
                    serde_json::Value::Number(v) if options.decimal == "comma" => v.to_string().replace('.', ","),
                    serde_json::Value::Number(v) => v.to_string(),
                    serde_json::Value::Null => String::new(), _ => "[niet-tabulaire waarde]".into(),
                }).collect());
            }
            result
        },
        _ => return Err("Gebruik CSV, TSV, Excel (.xlsx/.xls), OpenDocument (.ods) of JSON. PDF en afbeeldingen worden niet uitgelezen.".into()),
    };
    rows.retain(|row| row.iter().any(|cell| !cell.trim().is_empty()));
    if rows.len() < 2 {
        return Err("Er is een kopregel en minstens één gegevensrij nodig.".into());
    }
    if rows.len() > MAX_ROWS + 1 {
        return Err("Maximaal 250.000 gegevensrijen.".into());
    }
    let headers = rows.remove(0);
    if headers.len() > 200 {
        return Err("Maximaal 200 kolommen.".into());
    }
    Ok(Table {
        detected_unit,
        detected_period,
        headers,
        rows,
        sheets,
    })
}

fn cell(row: &[String], index: usize) -> Result<&str, String> {
    row.get(index)
        .map(String::as_str)
        .ok_or_else(|| "Kolom ontbreekt.".to_owned())
}

fn parse_time(value: &str, timezone: Tz, date_order: &str) -> Result<DateTime<Tz>, String> {
    if let Ok(value) = DateTime::parse_from_rfc3339(value.trim()) {
        return Ok(value.with_timezone(&timezone));
    }
    let raw = value.trim();
    let mut naive = None;
    for format in [
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%d-%m-%Y %H:%M:%S",
        "%d-%m-%Y %H:%M",
        "%Y%m%d:%H%M",
    ] {
        if let Ok(value) = NaiveDateTime::parse_from_str(raw, format) {
            naive = Some(value);
            break;
        }
    }
    if naive.is_none() {
        let formats = if date_order == "month_first" {
            [
                "%m/%d/%Y %H:%M:%S",
                "%m/%d/%Y %H:%M",
                "%m/%d/%Y %I:%M:%S %p",
                "%m/%d/%Y %I:%M %p",
            ]
        } else {
            [
                "%d/%m/%Y %H:%M:%S",
                "%d/%m/%Y %H:%M",
                "%d/%m/%Y %I:%M:%S %p",
                "%d/%m/%Y %I:%M %p",
            ]
        };
        for format in formats {
            if let Ok(value) = NaiveDateTime::parse_from_str(raw, format) {
                naive = Some(value);
                break;
            }
        }
    }
    if naive.is_none() {
        for format in [
            "%Y-%m-%d",
            "%d-%m-%Y",
            if date_order == "month_first" {
                "%m/%d/%Y"
            } else {
                "%d/%m/%Y"
            },
        ] {
            if let Ok(value) = NaiveDate::parse_from_str(raw, format) {
                naive = value.and_hms_opt(0, 0, 0);
                break;
            }
        }
    }
    if naive.is_none()
        && raw.len() == 7
        && let Ok(value) = NaiveDate::parse_from_str(&format!("{raw}-01"), "%Y-%m-%d")
    {
        naive = value.and_hms_opt(0, 0, 0);
    }
    let naive = naive.ok_or_else(|| {
        format!("Onbekend datumformaat: {raw}. Gebruik bijvoorbeeld 2026-06-01T12:00:00+02:00.")
    })?;
    timezone.from_local_datetime(&naive).single().ok_or_else(|| format!("Tijdstip {raw} bestaat niet of is dubbelzinnig door zomer-/wintertijd; geef een ISO-tijdstip met UTC-offset."))
}

fn period_end(start: DateTime<Tz>, period: &str, direction: i64) -> Result<DateTime<Tz>, String> {
    let seconds = match period {
        "5min" => Some(300),
        "10min" => Some(600),
        "15min" => Some(900),
        "30min" => Some(1800),
        "hour" => Some(3600),
        _ => None,
    };
    if let Some(seconds) = seconds {
        return start
            .checked_add_signed(Duration::seconds(seconds * direction))
            .ok_or("Tijdstip buiten bereik.".into());
    }
    let local = start.naive_local();
    let next = match period {
        "day" => local.checked_add_signed(Duration::days(direction)),
        "week" => local.checked_add_signed(Duration::days(7 * direction)),
        "year" if direction > 0 => local.checked_add_months(Months::new(12)),
        "year" => local.checked_sub_months(Months::new(12)),
        "month" if direction > 0 => local.checked_add_months(Months::new(1)),
        "month" => local.checked_sub_months(Months::new(1)),
        _ => return Err("Onbekende tijdresolutie.".into()),
    }
    .ok_or("Periode buiten datumbereik.")?;
    start
        .timezone()
        .from_local_datetime(&next)
        .single()
        .ok_or("Periodegrens is dubbelzinnig; gebruik kwartier- of uurdata met offsets.".into())
}

fn parse_number(raw: &str, decimal: &str) -> Result<f64, String> {
    let raw = raw.trim();
    let normalized = match decimal {
        "dot" if !raw.contains(',') => raw.to_owned(),
        "comma" if !raw.contains('.') => raw.replace(',', "."),
        _ => {
            return Err(format!(
                "Getal {raw:?} past niet bij het gekozen decimaalteken. Gebruik geen duizendtalscheiding."
            ));
        }
    };
    let value: f64 = normalized
        .parse()
        .map_err(|_| format!("Ongeldig of ontbrekend getal: {raw:?}."))?;
    if !value.is_finite() || !(0.0..=1e12).contains(&value) {
        return Err("Waarden moeten eindig, niet-negatief en maximaal 10^12 zijn.".into());
    }
    Ok(value)
}

pub fn normalize(
    table: &Table,
    options: &ImportOptions,
) -> Result<(Vec<SolarInterval>, SolarSummary), String> {
    let timezone: Tz = options
        .timezone
        .parse()
        .map_err(|_| "Onbekende IANA-tijdzone; gebruik bijvoorbeeld Europe/Amsterdam of UTC.")?;
    if !["interval", "cumulative"].contains(&options.mode.as_str())
        || !["kwh", "wh", "kw", "w"].contains(&options.unit.as_str())
        || !["start", "end"].contains(&options.timestamp_position.as_str())
        || !["measured", "modelled"].contains(&options.data_kind.as_str())
        || !["generic", "solaredge", "enphase", "sma", "fronius", "pvgis"]
            .contains(&options.profile.as_str())
        || !["day_first", "month_first"].contains(&options.date_order.as_str())
        || !["reject", "skip"].contains(&options.missing_rows.as_str())
    {
        return Err("Onbekende importinstelling.".into());
    }
    if ![
        "5min", "10min", "15min", "30min", "hour", "day", "week", "month", "year",
    ]
    .contains(&options.period.as_str())
    {
        return Err("Onbekende tijdresolutie.".into());
    }
    let net_meter = options.consumption_source == "net_meter";
    if !["gross", "net_meter"].contains(&options.consumption_source.as_str())
        || net_meter != options.export_column.is_some()
        || (net_meter && options.consumption_column.is_none())
    {
        return Err(
            "Kies voor P1-/meterdata zowel een kolom voor netafname als voor teruglevering.".into(),
        );
    }
    if options.export_column.is_some_and(|c| {
        c == options.time_column
            || c == options.production_column
            || Some(c) == options.consumption_column
            || Some(c) == options.time_part_column
    }) {
        return Err("De terugleverkolom moet verschillen van de overige gekozen kolommen.".into());
    }
    if options.time_column == options.production_column
        || options
            .consumption_column
            .is_some_and(|c| c == options.time_column || c == options.production_column)
    {
        return Err("Kies verschillende kolommen voor tijd, opwek en verbruik.".into());
    }
    if options.mode == "cumulative" && ["kw", "w"].contains(&options.unit.as_str()) {
        return Err("Cumulatieve meterstanden moeten Wh of kWh bevatten.".into());
    }
    if table
        .detected_unit
        .as_ref()
        .is_some_and(|unit| unit != &options.unit)
        || table
            .detected_period
            .as_ref()
            .is_some_and(|period| period != &options.period)
    {
        return Err(
            "De gekozen eenheid of meetperiode wijkt af van de SolarEdge JSON-metadata.".into(),
        );
    }
    if table.detected_unit.is_some() && options.mode != "interval" {
        return Err(
            "SolarEdge energy.values bevat periode-energie, geen cumulatieve standen.".into(),
        );
    }
    if options.time_part_column.is_some_and(|col| {
        col == options.time_column
            || col == options.production_column
            || Some(col) == options.consumption_column
    }) {
        return Err("De aparte tijdkolom moet verschillen van de overige gekozen kolommen.".into());
    }
    let mut readings = Vec::new();
    let mut skipped_rows = 0;
    for (index, row) in table.rows.iter().enumerate() {
        if options.missing_rows == "skip"
            && (cell(row, options.production_column).is_ok_and(|v| v.trim().is_empty())
                || options
                    .consumption_column
                    .into_iter()
                    .chain(options.export_column)
                    .any(|col| cell(row, col).is_ok_and(|v| v.trim().is_empty())))
        {
            skipped_rows += 1;
            continue;
        }
        let read = || -> Result<_, String> {
            let timestamp = if let Some(column) = options.time_part_column {
                format!("{} {}", cell(row, options.time_column)?, cell(row, column)?)
            } else {
                cell(row, options.time_column)?.to_owned()
            };
            Ok((
                parse_time(&timestamp, timezone, &options.date_order)?,
                parse_number(cell(row, options.production_column)?, &options.decimal)?,
                options
                    .consumption_column
                    .map(|col| cell(row, col).and_then(|raw| parse_number(raw, &options.decimal)))
                    .transpose()?,
                options
                    .export_column
                    .map(|col| cell(row, col).and_then(|raw| parse_number(raw, &options.decimal)))
                    .transpose()?,
            ))
        };
        readings.push(read().map_err(|e| format!("Gegevensrij {}: {e}", index + 1))?);
    }
    readings.sort_by_key(|r| r.0.timestamp());
    if readings.windows(2).any(|w| w[0].0 == w[1].0) {
        return Err(
            "Dubbele tijdstippen gevonden; verwijder duplicaten of vermeld de juiste UTC-offset."
                .into(),
        );
    }
    let mut intervals: Vec<SolarInterval> = Vec::new();
    let mut gaps = 0;
    let mut derived_negative = 0;
    for (index, (timestamp, production, consumption, export)) in readings.iter().enumerate() {
        let (start, end, production, consumption, export) = if options.mode == "cumulative" {
            if index == 0 {
                continue;
            }
            let previous = &readings[index - 1];
            if production < &previous.1
                || consumption.zip(previous.2).is_some_and(|(a, b)| a < b)
                || export.zip(previous.3).is_some_and(|(a, b)| a < b)
            {
                return Err(format!(
                    "Meterreset of dalende cumulatieve stand bij {}. Splits het bestand rondom de reset.",
                    timestamp
                ));
            }
            (
                previous.0,
                *timestamp,
                production - previous.1,
                consumption.zip(previous.2).map(|(a, b)| a - b),
                export.zip(previous.3).map(|(a, b)| a - b),
            )
        } else {
            let (start, end) = if options.timestamp_position == "start" {
                (*timestamp, period_end(*timestamp, &options.period, 1)?)
            } else {
                (period_end(*timestamp, &options.period, -1)?, *timestamp)
            };
            (start, end, *production, *consumption, *export)
        };
        // Energiebalans zonder bestaande accu: wat het huis gebruikte is wat erin kwam
        // (opwek + netafname) minus wat eruit ging (teruglevering).
        let consumption = match (net_meter, consumption, export) {
            (true, Some(import), Some(export)) => {
                let gross = production + import - export;
                if gross < -1e-9 {
                    derived_negative += 1;
                }
                Some(gross.max(0.0))
            }
            _ => consumption,
        };
        let duration = (end - start).num_seconds();
        if duration <= 0 {
            return Err("Niet-positieve meetperiode.".into());
        }
        if let Some(previous) = intervals.last() {
            if previous.end_unix_s > start.timestamp() {
                return Err(
                    "Meetperioden overlappen; controleer tijdresolutie en tijdstempelpositie."
                        .into(),
                );
            }
            if previous.end_unix_s < start.timestamp() {
                gaps += 1;
            }
        }
        let factor = match options.unit.as_str() {
            "kwh" => 1000.0,
            "wh" => 1.0,
            "kw" => duration as f64 / 3.6,
            "w" => duration as f64 / 3600.0,
            _ => unreachable!(),
        };
        intervals.push(SolarInterval {
            start_unix_s: start.timestamp(),
            end_unix_s: end.timestamp(),
            production_wh: production * factor,
            consumption_wh: consumption.map(|v| v * factor),
        });
    }
    if derived_negative > intervals.len() / 100 {
        return Err(format!(
            "In {derived_negative} meetperioden is teruglevering groter dan opwek plus netafname. Opwek en meterdata lopen waarschijnlijk niet gelijk in tijd, gebruiken verschillende eenheden, of er is al een accu. Controleer tijdzone, tijdstempelpositie en eenheid."
        ));
    }
    if intervals.is_empty() {
        return Err(
            "Geen meetperioden; voor cumulatieve standen zijn minstens twee metingen nodig.".into(),
        );
    }
    let mut months: BTreeMap<String, (f64, Option<f64>)> = BTreeMap::new();
    for item in &intervals {
        let date = Utc
            .timestamp_opt(item.start_unix_s, 0)
            .single()
            .ok_or("Datum buiten bereik.")?
            .with_timezone(&timezone);
        let month = months
            .entry(date.format("%Y-%m").to_string())
            .or_insert((0.0, options.consumption_column.map(|_| 0.0)));
        month.0 += item.production_wh / 1000.0;
        if let (Some(total), Some(value)) = (&mut month.1, item.consumption_wh) {
            *total += value / 1000.0;
        }
    }
    let mut warnings = vec!["Opwek alleen bepaalt geen geschikte accucapaciteit of terugverdientijd. Combineer met gelijktijdig verbruik, tarieven en systeemgrenzen.".into()];
    if skipped_rows > 0 {
        warnings.push(format!("{skipped_rows} rij(en) met ontbrekende meetwaarden expliciet overgeslagen; dit is geen nulproductie."));
    }
    if gaps > 0 {
        warnings.push(format!(
            "{gaps} gat(en) in de meetreeks; deze worden niet met nullen aangevuld."
        ));
    }
    if options.mode == "cumulative" {
        warnings.push("De eerste meterstand is alleen de beginstand. Intervallen gebruiken de werkelijke tijd tussen opeenvolgende standen; uitval binnen een interval is daarmee niet aantoonbaar.".into());
    }
    if ["day", "month"].contains(&options.period.as_str())
        || intervals
            .iter()
            .any(|i| i.end_unix_s - i.start_unix_s > 3600)
    {
        warnings.push("Dag-/maandtotalen laten geen dagprofiel of gelijktijdigheid zien; ze zijn onvoldoende voor accudimensionering.".into());
    }
    if ["kw", "w"].contains(&options.unit.as_str()) {
        warnings.push("Vermogen is geïntegreerd als gemiddelde over de gekozen periode. Piek- of momentwaarden zijn hiervoor ongeschikt.".into());
    }
    if net_meter {
        warnings.push("Bruto verbruik is afgeleid als opwek + netafname − teruglevering. Dit klopt alleen zonder bestaande accu en als omvormer- en meterdata dezelfde tijdsperioden beschrijven.".into());
        if derived_negative > 0 {
            warnings.push(format!("{derived_negative} meetperiode(n) gaven een licht negatief afgeleid verbruik door meetafwijkingen; die zijn op 0 gezet."));
        }
    }
    if options.data_kind == "modelled" {
        warnings.push("Dit bestand is gemodelleerde opwek, geen gemeten productie.".into());
    }
    warnings.push("Maandtotalen zijn ingedeeld op de lokale start van elk interval; intervallen die maandgrenzen overschrijden worden niet opgesplitst.".into());
    let has_consumption = options.consumption_column.is_some();
    let summary = SolarSummary {
        rows: intervals.len(),
        from_unix_s: intervals[0].start_unix_s,
        to_unix_s: intervals.last().unwrap().end_unix_s,
        coverage_hours: intervals
            .iter()
            .map(|i| (i.end_unix_s - i.start_unix_s) as f64 / 3600.0)
            .sum(),
        gaps,
        production_kwh: intervals.iter().map(|i| i.production_wh / 1000.0).sum(),
        consumption_kwh: has_consumption.then(|| {
            intervals
                .iter()
                .map(|i| i.consumption_wh.unwrap_or(0.0) / 1000.0)
                .sum()
        }),
        interval_surplus_kwh: has_consumption.then(|| {
            intervals
                .iter()
                .map(|i| (i.production_wh - i.consumption_wh.unwrap_or(0.0)).max(0.0) / 1000.0)
                .sum()
        }),
        interval_deficit_kwh: has_consumption.then(|| {
            intervals
                .iter()
                .map(|i| (i.consumption_wh.unwrap_or(0.0) - i.production_wh).max(0.0) / 1000.0)
                .sum()
        }),
        months: months
            .into_iter()
            .map(|(label, (production_kwh, consumption_kwh))| SolarPeriod {
                label,
                production_kwh,
                consumption_kwh,
            })
            .collect(),
        warnings,
    };
    Ok((intervals, summary))
}
