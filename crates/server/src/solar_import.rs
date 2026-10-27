//! Bestandsadapters: geen aannames over een specifiek omvormermerk.

use std::{collections::BTreeMap, io::Cursor};

use calamine::{Cell, Data, DataRef, Range, Reader, Sheets, Xlsx, open_workbook_auto_from_rs};
use chrono::{DateTime, Duration, LocalResult, Months, NaiveDate, NaiveDateTime, TimeZone, Utc};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};
use thuisaccu_storage::solar::{SolarInterval, SolarPeriod, SolarSummary};

pub const MAX_ROWS: usize = 250_000;

/// Slot van elke melding over een tijdstip dat door de klokwisseling niet of dubbelzinnig bestaat.
/// De API herkent er de melding aan en geeft de code `clock_change`, zodat de interface de oplossing
/// bij de tijdzone kan tonen.
const CLOCK_CHANGE_HINT: &str =
    "Kies een tijdzone die bij het bestand past, of gebruik tijdstippen met UTC-offset.";

/// Of een importfout over de klokwisseling gaat: zulke meldingen eindigen met dezelfde tip over de tijdzone.
pub fn is_clock_change(message: &str) -> bool {
    message.ends_with(CLOCK_CHANGE_HINT)
}
/// Versie van het inlezen, bewaard bij de instellingen van een import. Verhoog hem bij elke
/// wijziging die uit hetzelfde bestand met dezelfde instellingen andere meetperioden maakt:
/// een import telt als dubbel bij dezelfde bytes én dezelfde instellingen, en zou anders de
/// oude, verkeerd ingelezen meetperioden teruggeven. Versie 2 (26 oktober 2026): het dubbele
/// uur bij wintertijd in bestanden die teruglopen in de tijd, en datum- en tijdcellen in
/// aparte spreadsheetkolommen.
pub const NORMALIZER_VERSION: u32 = 2;

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

/// Instellingen voor een apart meterbestand (bijvoorbeeld een P1-export) met netafname
/// en teruglevering. Wordt gecombineerd met de opwek uit het omvormerbestand.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct MeterOptions {
    pub sheet: Option<String>,
    pub header_row: usize,
    pub delimiter: String,
    pub decimal: String,
    pub time_column: usize,
    pub time_part_column: Option<usize>,
    pub import_column: usize,
    pub export_column: usize,
    pub unit: String,
    pub mode: String,
    pub period: String,
    pub timezone: String,
    pub timestamp_position: String,
    pub date_order: String,
    pub missing_rows: String,
}

impl Default for MeterOptions {
    fn default() -> Self {
        let base = ImportOptions::default();
        Self {
            sheet: None,
            header_row: 0,
            delimiter: base.delimiter,
            decimal: base.decimal,
            time_column: 0,
            time_part_column: None,
            import_column: 1,
            export_column: 2,
            unit: base.unit,
            mode: base.mode,
            period: "15min".into(),
            timezone: "Europe/Amsterdam".into(),
            timestamp_position: base.timestamp_position,
            date_order: base.date_order,
            missing_rows: base.missing_rows,
        }
    }
}

impl MeterOptions {
    /// Leest het meterbestand met dezelfde parser: netafname staat tijdelijk in het
    /// opwekveld en teruglevering in het verbruiksveld van [`SolarInterval`].
    pub fn as_import_options(&self) -> ImportOptions {
        ImportOptions {
            profile: "generic".into(),
            sheet: self.sheet.clone(),
            header_row: self.header_row,
            delimiter: self.delimiter.clone(),
            decimal: self.decimal.clone(),
            time_column: self.time_column,
            time_part_column: self.time_part_column,
            production_column: self.import_column,
            consumption_column: Some(self.export_column),
            consumption_source: "gross".into(),
            export_column: None,
            unit: self.unit.clone(),
            mode: self.mode.clone(),
            period: self.period.clone(),
            timezone: self.timezone.clone(),
            timestamp_position: self.timestamp_position.clone(),
            data_kind: "measured".into(),
            date_order: self.date_order.clone(),
            missing_rows: self.missing_rows.clone(),
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
            // Lege regels tellen niet mee; stoppen zodra er meer dan de kopregel plus MAX_ROWS gegevensrijen zijn,
            // zodat de controle hieronder een te groot bestand weigert in plaats van het stilzwijgend af te kappen.
            for record in reader.records() {
                let row: Vec<String> = record.map_err(|e| format!("CSV: {e}"))?.iter().map(|v| v.trim().to_owned()).collect();
                if row.iter().all(|cell| cell.is_empty()) { continue; }
                result.push(row);
                if result.len() > MAX_ROWS + 1 { break; }
            }
            result
        },
        "xlsx" | "xls" | "ods" => {
            ods_size_check(bytes, options.header_row)?;
            let mut workbook = open_workbook_auto_from_rs(Cursor::new(bytes.to_vec())).map_err(|e| format!("Spreadsheet: {e}"))?;
            sheets = workbook.sheet_names();
            let name = options.sheet.as_ref().or(sheets.first()).ok_or("Geen werkblad gevonden.")?;
            let range = match &mut workbook {
                Sheets::Xlsx(xlsx) => xlsx_range(xlsx, name, options.header_row)?,
                other => other.worksheet_range(name).map_err(|e| format!("Werkblad: {e}"))?,
            };
            if range.height() > MAX_ROWS + options.header_row + 1 || range.width() > 200 || range.height() * range.width() > MAX_CELLS {
                return Err(TOO_LARGE.into());
            }
            range.rows().skip(options.header_row).map(|row| row.iter().map(|cell| spreadsheet_cell(cell, &options.decimal)).collect()).collect()
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

const TOO_LARGE: &str =
    "Werkblad is te groot: maximaal 250.000 gegevensrijen, 200 kolommen en 5 miljoen cellen.";
/// Bovengrens voor het rechthoekige gebied van een werkblad (lege cellen tellen mee): 250.000 rijen
/// met 20 kolommen past, 250.000 bij 200 (ruim 1,5 GB) niet.
const MAX_CELLS: usize = 5_000_000;

/// Leest een xlsx-werkblad cel voor cel en controleert de omvang vóór er een rechthoekig blok wordt
/// aangemaakt. `worksheet_range` reserveert geheugen voor het hele gebruikte gebied, ook voor lege
/// cellen: één verdwaalde cel in XFD1048576 vraagt dan tientallen gigabytes en breekt het proces af.
fn xlsx_range<RS: std::io::Read + std::io::Seek>(
    xlsx: &mut Xlsx<RS>,
    name: &str,
    header_row: usize,
) -> Result<Range<Data>, String> {
    let max_height = MAX_ROWS + header_row + 1;
    let mut reader = xlsx
        .worksheet_cells_reader(name)
        .map_err(|e| format!("Werkblad: {e}"))?;
    let (mut cells, mut rows, mut cols) = (Vec::new(), (u32::MAX, 0), (u32::MAX, 0));
    while let Some(cell) = reader.next_cell().map_err(|e| format!("Werkblad: {e}"))? {
        if matches!(cell.get_value(), DataRef::Empty) {
            continue;
        }
        let (row, col) = cell.get_position();
        rows = (rows.0.min(row), rows.1.max(row));
        cols = (cols.0.min(col), cols.1.max(col));
        // Het gebied kan alleen groeien; zodra het te groot is, stoppen met lezen.
        let (height, width) = (
            (rows.1 - rows.0) as usize + 1,
            (cols.1 - cols.0) as usize + 1,
        );
        if height > max_height || width > 200 || height * width > MAX_CELLS {
            return Err(TOO_LARGE.into());
        }
        cells.push(Cell::new((row, col), Data::from(cell.get_value().clone())));
    }
    Ok(Range::from_sparse(cells))
}

/// Controleert de omvang van elk werkblad in een OpenDocument-bestand vóór calamine het opent.
/// Calamine leest bij het openen alle werkbladen in als rechthoekig blok en herhaalt daarbij
/// `number-rows-repeated` en `number-columns-repeated`: een bestand van een paar honderd bytes met
/// één herhaalde rij vraagt zo meer dan een gigabyte. Hier tellen alleen cellen met inhoud; lege
/// herhaalde rijen en kolommen (die LibreOffice achter elk blad zet) maken een blad niet groter.
/// Geen OpenDocument (geen zip met `content.xml`): niets te controleren.
fn ods_size_check(bytes: &[u8], header_row: usize) -> Result<(), String> {
    use quick_xml::events::{BytesStart, Event};

    let Ok(mut zip) = zip::ZipArchive::new(Cursor::new(bytes)) else {
        return Ok(());
    };
    let Ok(content) = zip.by_name("content.xml") else {
        return Ok(());
    };
    let mut reader = quick_xml::Reader::from_reader(std::io::BufReader::new(content));
    let repeats = |e: &BytesStart, key: &str| -> usize {
        e.try_get_attribute(key)
            .ok()
            .flatten()
            .and_then(|a| a.value.parse().ok())
            .unwrap_or(1)
    };
    let has = |e: &BytesStart, key: &str| e.try_get_attribute(key).ok().flatten().is_some();
    // Per werkblad: de volgende rij, de eerste en laatste rij met inhoud en de breedste rij.
    // Per rij: de volgende kolom, het einde van de laatste cel met inhoud en het aantal herhalingen.
    let (mut row, mut first, mut last, mut width) = (0usize, None, 0usize, 0usize);
    let (mut col, mut filled, mut row_repeats) = (0usize, 0usize, 1usize);
    let mut buf = Vec::new();
    loop {
        let event = reader
            .read_event_into(&mut buf)
            .map_err(|e| format!("Spreadsheet: {e}"))?;
        let (start, empty) = match &event {
            Event::Start(e) => (Some(e), false),
            Event::Empty(e) => (Some(e), true),
            _ => (None, false),
        };
        if let Some(e) = start {
            match e.name().as_ref() {
                "table:table" => (row, first, last, width) = (0, None, 0, 0),
                "table:table-row" if empty => {
                    row = row.saturating_add(repeats(e, "table:number-rows-repeated"))
                }
                "table:table-row" => {
                    (col, filled, row_repeats) = (0, 0, repeats(e, "table:number-rows-repeated"))
                }
                "table:table-cell" | "table:covered-table-cell" => {
                    let span = repeats(e, "table:number-columns-repeated");
                    // Een cel met waarde, formule of tekst telt; een lege, eventueel opgemaakte cel niet.
                    if !empty || has(e, "office:value-type") || has(e, "table:formula") {
                        filled = col.saturating_add(span);
                    }
                    col = col.saturating_add(span);
                }
                _ => {}
            }
        }
        match &event {
            Event::End(e) if e.name().as_ref() == "table:table-row" => {
                if filled > 0 {
                    first.get_or_insert(row);
                    last = row.saturating_add(row_repeats.saturating_sub(1));
                    width = width.max(filled);
                }
                row = row.saturating_add(row_repeats);
            }
            Event::End(e) if e.name().as_ref() == "table:table" => {
                let height = first.map_or(0, |first| last - first + 1);
                // Dezelfde grenzen als na het inlezen, maar voor elk werkblad: calamine leest ze allemaal.
                if height > MAX_ROWS + header_row + 1
                    || width > 200
                    || height.saturating_mul(width) > MAX_CELLS
                {
                    return Err(TOO_LARGE.into());
                }
            }
            Event::Eof => return Ok(()),
            _ => {}
        }
        buf.clear();
    }
}

/// Zet een spreadsheetcel om naar tekst zoals in een CSV. Een cel met alleen een tijd (een
/// Excel-getal onder 1, of een duur) wordt `10:00:00`, niet `1899-12-31 10:00:00`, zodat een
/// aparte tijdkolom achter de datum past; een ODS-duur (`PT10H00M00S`) idem.
fn spreadsheet_cell(cell: &Data, decimal: &str) -> String {
    let clock = |seconds: i64| {
        format!(
            "{:02}:{:02}:{:02}",
            seconds / 3600,
            seconds / 60 % 60,
            seconds % 60
        )
    };
    match cell {
        Data::DateTime(date) if date.is_duration() || (0.0..1.0).contains(&date.as_f64()) => {
            clock((date.as_f64() * 86_400.0).round() as i64)
        }
        Data::DateTime(date) => date
            .as_datetime()
            .map(|d| d.format("%Y-%m-%d %H:%M:%S").to_string())
            .unwrap_or_else(|| cell.to_string()),
        Data::DurationIso(text) => iso_duration_seconds(text)
            .map(clock)
            .unwrap_or_else(|| text.clone()),
        Data::Float(value) if decimal == "comma" => value.to_string().replace('.', ","),
        _ => cell.to_string(),
    }
}

/// Seconden in een ISO-duur van uren, minuten en seconden (`PT10H00M00S`), zoals ODS die voor
/// een tijdcel geeft; `None` voor iets anders.
fn iso_duration_seconds(text: &str) -> Option<i64> {
    let mut rest = text.strip_prefix("PT")?;
    let mut seconds = 0.0;
    for (unit, factor) in [('H', 3600.0), ('M', 60.0), ('S', 1.0)] {
        if let Some((value, tail)) = rest.split_once(unit) {
            seconds += value.parse::<f64>().ok()? * factor;
            rest = tail;
        }
    }
    (rest.is_empty() && seconds < 86_400.0).then(|| seconds.round() as i64)
}

fn cell(row: &[String], index: usize) -> Result<&str, String> {
    row.get(index)
        .map(String::as_str)
        .ok_or_else(|| "Kolom ontbreekt.".to_owned())
}

/// Leest een tijdstip. `repeated` telt lokale tijdstippen in het dubbele uur bij de overgang
/// naar wintertijd: een export in lokale tijd noemt dat uur twee keer, het eerste is zomertijd
/// en het tweede wintertijd. Een derde keer is een fout; één keer controleert de aanroeper, net
/// als een bestand dat terugloopt in de tijd (daar is het eerste wintertijd).
fn parse_time(
    value: &str,
    timezone: Tz,
    date_order: &str,
    repeated: &mut BTreeMap<NaiveDateTime, usize>,
) -> Result<DateTime<Tz>, String> {
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
    match timezone.from_local_datetime(&naive) {
        LocalResult::Single(time) => Ok(time),
        LocalResult::Ambiguous(summer, winter) => {
            let seen = repeated.entry(naive).or_default();
            *seen += 1;
            match seen {
                1 => Ok(summer),
                2 => Ok(winter),
                _ => Err(format!(
                    "Tijdstip {raw} komt vaker dan twee keer voor in het dubbele uur bij de overgang naar wintertijd. {CLOCK_CHANGE_HINT}"
                )),
            }
        }
        LocalResult::None => Err(format!(
            "Tijdstip {raw} bestaat niet in tijdzone {timezone}: de klok springt daar dan een uur vooruit naar zomertijd. {CLOCK_CHANGE_HINT}"
        )),
    }
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
    let mut repeated = BTreeMap::new();
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
        let mut read = || -> Result<_, String> {
            let timestamp = if let Some(column) = options.time_part_column {
                // Een datumcel uit een spreadsheet komt als datum met middernacht; de tijd staat ernaast.
                let date = cell(row, options.time_column)?;
                format!(
                    "{} {}",
                    date.strip_suffix(" 00:00:00").unwrap_or(date),
                    cell(row, column)?
                )
            } else {
                cell(row, options.time_column)?.to_owned()
            };
            Ok((
                parse_time(&timestamp, timezone, &options.date_order, &mut repeated)?,
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
    // Zonder tweede vermelding is niet te zeggen of het tijdstip zomer- of wintertijd is.
    if let Some((time, _)) = repeated.iter().find(|(_, count)| **count == 1) {
        return Err(format!(
            "Tijdstip {} bestaat in tijdzone {timezone} twee keer door de overgang naar wintertijd, maar staat maar één keer in het bestand. {CLOCK_CHANGE_HINT}",
            time.format("%Y-%m-%d %H:%M")
        ));
    }
    // Een export met de nieuwste meting bovenaan noemt het dubbele uur eerst in wintertijd.
    let descending = readings
        .first()
        .zip(readings.last())
        .is_some_and(|(first, last)| first.0 > last.0);
    if descending && !repeated.is_empty() {
        for reading in &mut readings {
            let local = reading.0.naive_local();
            if repeated.contains_key(&local)
                && let LocalResult::Ambiguous(summer, winter) = timezone.from_local_datetime(&local)
            {
                reading.0 = if reading.0 == summer { winter } else { summer };
            }
        }
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
    let mut balance = GrossBalance::default();
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
        // Energiebalans zonder bestaande accu: wat het huis gebruikte is wat erin kwam
        // (opwek + netafname) minus wat eruit ging (teruglevering).
        let (consumption_wh, measured) = match (net_meter, consumption, export) {
            (true, Some(import), Some(export)) => (
                Some(balance.derive(
                    production * factor,
                    import * factor,
                    export * factor,
                    duration,
                )),
                Some((import * factor, export * factor)),
            ),
            _ => (consumption.map(|v| v * factor), None),
        };
        intervals.push(SolarInterval {
            start_unix_s: start.timestamp(),
            end_unix_s: end.timestamp(),
            production_wh: production * factor,
            consumption_wh,
            steady_consumption_wh: None,
            measured_import_wh: measured.map(|m| m.0),
            measured_export_wh: measured.map(|m| m.1),
        });
    }
    balance.check(intervals.len(), "Opwek en meterdata")?;
    if intervals.is_empty() {
        return Err(
            "Geen meetperioden; voor cumulatieve standen zijn minstens twee metingen nodig.".into(),
        );
    }
    let mut warnings = vec!["Opwek alleen bepaalt geen geschikte accucapaciteit of terugverdientijd. Combineer met gelijktijdig verbruik, tarieven en systeemgrenzen.".into()];
    if !repeated.is_empty() {
        warnings.push(format!(
            "{} lokale tijdstip(pen) staan twee keer in het bestand door de overgang naar wintertijd; {}",
            repeated.len(),
            if descending {
                "het bestand loopt terug in de tijd, dus het eerste is als wintertijd en het tweede als zomertijd gelezen."
            } else {
                "het eerste is als zomertijd en het tweede als wintertijd gelezen."
            }
        ));
    }
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
        warnings.extend(balance.warning());
    }
    if options.data_kind == "modelled" {
        warnings.push("Dit bestand is gemodelleerde opwek, geen gemeten productie.".into());
    }
    warnings.push("Maandtotalen zijn ingedeeld op de lokale start van elk interval; intervallen die maandgrenzen overschrijden worden niet opgesplitst.".into());
    let mut summary = summarize(
        &intervals,
        timezone,
        options.consumption_column.is_some(),
        gaps,
        warnings,
    )?;
    if net_meter {
        summary.clipped_consumption_kwh = Some(balance.clipped_wh / 1000.0);
    }
    Ok((intervals, summary))
}

fn summarize(
    intervals: &[SolarInterval],
    timezone: Tz,
    has_consumption: bool,
    gaps: usize,
    warnings: Vec<String>,
) -> Result<SolarSummary, String> {
    let mut months: BTreeMap<String, (f64, Option<f64>)> = BTreeMap::new();
    for item in intervals {
        let date = Utc
            .timestamp_opt(item.start_unix_s, 0)
            .single()
            .ok_or("Datum buiten bereik.")?
            .with_timezone(&timezone);
        let month = months
            .entry(date.format("%Y-%m").to_string())
            .or_insert((0.0, has_consumption.then_some(0.0)));
        month.0 += item.production_wh / 1000.0;
        if let (Some(total), Some(value)) = (&mut month.1, item.consumption_wh) {
            *total += value / 1000.0;
        }
    }
    Ok(SolarSummary {
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
        clipped_consumption_kwh: None,
    })
}

/// Combineert opwek uit het omvormerbestand met netafname en teruglevering uit een
/// meterbestand. Beide reeksen worden opgeteld tot de grofste resolutie; alleen perioden die
/// in beide bestanden volledig gemeten zijn, worden gebruikt. Ontbrekende perioden blijven
/// gaten en worden nooit met nullen aangevuld. Bruto verbruik = opwek + netafname −
/// teruglevering.
pub fn combine_with_meter(
    production: &[SolarInterval],
    production_summary: &SolarSummary,
    meter: &[SolarInterval],
    timezone: &str,
) -> Result<(Vec<SolarInterval>, SolarSummary), String> {
    let timezone: Tz = timezone
        .parse()
        .map_err(|_| "Onbekende IANA-tijdzone in het omvormerbestand.")?;
    if production.iter().any(|i| i.consumption_wh.is_some()) {
        return Err("Kies in het omvormerbestand geen verbruikskolom als je een meterbestand toevoegt; het verbruik volgt dan uit de meter.".into());
    }
    let longest = production
        .iter()
        .chain(meter)
        .map(|i| i.end_unix_s - i.start_unix_s)
        .max()
        .unwrap_or(0);
    let (bucket, period) = [
        (300, "5min"),
        (600, "10min"),
        (900, "15min"),
        (1800, "30min"),
        (3600, "hour"),
    ]
    .into_iter()
    .find(|(seconds, _)| *seconds >= longest)
    .ok_or("Combineren kan alleen met meetperioden van een uur of korter.")?;
    // Per periode: opgetelde energie en gemeten seconden, zodat onvolledige perioden opvallen.
    let collect = |series: &[SolarInterval]| -> Result<BTreeMap<i64, (f64, f64, i64)>, String> {
        let mut buckets = BTreeMap::new();
        for i in series {
            let key = i.start_unix_s.div_euclid(bucket);
            if (i.end_unix_s - 1).div_euclid(bucket) != key {
                return Err("De meetperioden van omvormer en meter passen niet op elkaar (bijvoorbeeld 10 en 15 minuten). Exporteer beide per kwartier of per uur.".into());
            }
            let entry = buckets.entry(key).or_insert((0.0, 0.0, 0));
            entry.0 += i.production_wh;
            entry.1 += i.consumption_wh.unwrap_or(0.0);
            entry.2 += i.end_unix_s - i.start_unix_s;
        }
        Ok(buckets)
    };
    let solar = collect(production)?;
    let grid = collect(meter)?;
    let complete =
        |b: &BTreeMap<i64, (f64, f64, i64)>, key: &i64| b.get(key).is_some_and(|v| v.2 == bucket);
    let keys: Vec<i64> = solar
        .keys()
        .filter(|key| complete(&solar, key) && complete(&grid, key))
        .copied()
        .collect();
    if keys.is_empty() {
        return Err("Omvormer- en meterbestand hebben geen gemeenschappelijke, volledige meetperioden. Controleer of ze dezelfde periode en tijdzone beschrijven.".into());
    }
    let first = keys[0];
    let last = keys[keys.len() - 1];
    // Elke gemeenschappelijke periode staat in beide reeksen; de rest binnen het bereik valt af.
    let outside = |b: &BTreeMap<i64, (f64, f64, i64)>| b.range(first..=last).count() - keys.len();
    let unmatched = outside(&solar).max(outside(&grid));
    let mut intervals = Vec::with_capacity(keys.len());
    let mut balance = GrossBalance::default();
    let mut gaps = 0;
    for (index, key) in keys.iter().enumerate() {
        if index > 0 && keys[index - 1] + 1 != *key {
            gaps += 1;
        }
        let produced = solar[key].0;
        let (imported, exported, _) = grid[key];
        intervals.push(SolarInterval {
            start_unix_s: key * bucket,
            end_unix_s: (key + 1) * bucket,
            production_wh: produced,
            consumption_wh: Some(balance.derive(produced, imported, exported, bucket)),
            steady_consumption_wh: None,
            measured_import_wh: Some(imported),
            measured_export_wh: Some(exported),
        });
    }
    balance.check(intervals.len(), "Omvormer en meter")?;
    let mut warnings: Vec<String> = production_summary
        .warnings
        .iter()
        .filter(|w| !w.starts_with("Maandtotalen") && !w.contains("gat(en)"))
        .cloned()
        .collect();
    warnings.push(format!(
        "Omvormer- en meterbestand zijn gecombineerd per {}. Bruto verbruik is afgeleid als opwek + netafname − teruglevering; dat klopt alleen zonder bestaande accu en als beide bestanden dezelfde tijdsperioden beschrijven.",
        match period {
            "hour" => "uur".to_owned(),
            other => other.replace("min", " minuten"),
        }
    ));
    if unmatched > 0 {
        warnings.push(format!("{unmatched} meetperiode(n) binnen de reeks stonden niet volledig in beide bestanden en zijn weggelaten; dit is geen nulverbruik of nulopwek."));
    }
    if gaps > 0 {
        warnings.push(format!(
            "{gaps} gat(en) in de gecombineerde meetreeks; deze worden niet met nullen aangevuld."
        ));
    }
    warnings.extend(balance.warning());
    warnings.push("Maandtotalen zijn ingedeeld op de lokale start van elk interval; intervallen die maandgrenzen overschrijden worden niet opgesplitst.".into());
    let mut summary = summarize(&intervals, timezone, true, gaps, warnings)?;
    summary.clipped_consumption_kwh = Some(balance.clipped_wh / 1000.0);
    Ok((intervals, summary))
}

/// Toegestane meetafwijking per periode bij het afleiden van bruto verbruik: gemiddeld 100 W
/// (afgeronde tellerstanden, enkele seconden verschil tussen omvormer- en meterklok) plus 5% van
/// de energie die het huis in kwam (opwek + netafname). Daarbuiten stopt de import.
const BALANCE_TOLERANCE_W: f64 = 100.0;
const BALANCE_TOLERANCE_SHARE: f64 = 0.05;
/// Hoogstens 1% van de perioden en 1% van het afgeleide verbruik mag op nul worden gezet.
const BALANCE_MAX_SHARE: f64 = 0.01;

/// Bruto verbruik = opwek + netafname − teruglevering, met boekhouding van wat negatief uitkwam.
/// Een klein negatief saldo is een meetafwijking en wordt op nul gezet; de omvang blijft bewaard.
#[derive(Default)]
struct GrossBalance {
    clipped: usize,
    clipped_wh: f64,
    worst_wh: f64,
    too_large: usize,
    gross_wh: f64,
}

impl GrossBalance {
    fn derive(&mut self, production_wh: f64, import_wh: f64, export_wh: f64, seconds: i64) -> f64 {
        let gross = production_wh + import_wh - export_wh;
        if gross < -1e-6 {
            let tolerance = BALANCE_TOLERANCE_W * seconds as f64 / 3600.0
                + BALANCE_TOLERANCE_SHARE * (production_wh + import_wh);
            if -gross > tolerance {
                self.too_large += 1;
            }
            self.clipped += 1;
            self.clipped_wh -= gross;
            self.worst_wh = self.worst_wh.max(-gross);
        }
        let gross = gross.max(0.0);
        self.gross_wh += gross;
        gross
    }

    fn check(&self, intervals: usize, sources: &str) -> Result<(), String> {
        if self.too_large > 0
            || self.clipped > intervals / 100
            || self.clipped_wh > self.gross_wh * BALANCE_MAX_SHARE
        {
            return Err(format!(
                "In {} meetperiode(n) is de teruglevering groter dan opwek plus netafname: samen {} kWh, in één periode tot {} kWh. Dat is meer dan een meetafwijking. {sources} lopen waarschijnlijk niet gelijk in tijd, gebruiken verschillende eenheden, of er is al een accu. Controleer tijdzone, tijdstempelpositie en eenheid.",
                self.clipped,
                kwh(self.clipped_wh),
                kwh(self.worst_wh)
            ));
        }
        Ok(())
    }

    fn warning(&self) -> Option<String> {
        (self.clipped > 0).then(|| {
            format!(
                "{} meetperiode(n) gaven een licht negatief afgeleid verbruik door meetafwijkingen (samen {} kWh, in één periode tot {} kWh); die zijn op 0 gezet.",
                self.clipped,
                kwh(self.clipped_wh),
                kwh(self.worst_wh)
            )
        })
    }
}

fn kwh(wh: f64) -> String {
    format!("{:.3}", wh / 1000.0).replace('.', ",")
}
