//! Het contract tussen Rust en de interface: `web/contract.js` bevat de feiten uit de rekenkern, de opslag en
//! de API die de interface nodig heeft (modelversie, offertevelden, grenzen van de invoer, doelen, meldingscodes),
//! gegenereerd uit de constanten zelf. Het bestand staat in Git, zodat de interface zonder build-stap werkt, ook
//! offline en als statische site. Deze test faalt als het bestand niet meer overeenkomt met de code.
//!
//! Bewust veranderd? Draai `UPDATE_CONTRACT=1 cargo test -p thuisaccu-server --test contract` en controleer het
//! verschil in Git. Bewerk `web/contract.js` nooit met de hand.

use serde_json::{Value, json};
use thuisaccu_core::analysis::{self, Connection, Limit, MessageKind, Objective};
use thuisaccu_core::finance;
use thuisaccu_server::{scenario_api, typical_profile};

const PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../web/contract.js");

/// Een waarde in het contract. Objecten houden de volgorde van de code, zodat het bestand leesbaar blijft.
enum Node {
    Object(Vec<(&'static str, Node)>),
    Array(Vec<Node>),
    Leaf(Value),
}

/// Een getal zoals JavaScript het schrijft: 2026 in plaats van 2026.0.
fn number(value: f64) -> Node {
    Node::Leaf(if value.fract() == 0.0 && value.abs() < 1e15 {
        json!(value as i64)
    } else {
        json!(value)
    })
}

fn limit(limit: Limit) -> Node {
    Node::Object(vec![("min", number(limit.min)), ("max", number(limit.max))])
}

fn leaf(value: impl serde::Serialize) -> Node {
    Node::Leaf(serde_json::to_value(value).unwrap())
}

fn strings(values: &[&str]) -> Node {
    Node::Array(values.iter().map(leaf).collect())
}

/// De naam van een waarde zoals in de JSON van de API.
fn name(value: impl serde::Serialize) -> Node {
    let value = serde_json::to_value(value).unwrap();
    assert!(value.is_string());
    Node::Leaf(value)
}

fn contract() -> Node {
    let limits = analysis::LIMITS
        .iter()
        .map(|&(group, fields)| {
            let fields = fields.iter().map(|&(field, l)| (field, limit(l))).collect();
            (group, Node::Object(fields))
        })
        .collect();
    let codes = analysis::MESSAGE_CODES
        .iter()
        .map(|&(code, kind)| Node::Object(vec![("code", leaf(code)), ("kind", name(kind))]))
        .collect();
    Node::Object(vec![
        ("modelVersion", leaf(analysis::MODEL_VERSION)),
        ("lastNettingYear", leaf(finance::LAST_NETTING_YEAR)),
        (
            "objectives",
            Node::Array(Objective::ALL.into_iter().map(name).collect()),
        ),
        (
            "connections",
            Node::Array(Connection::ALL.into_iter().map(name).collect()),
        ),
        ("costCategories", strings(finance::COST_CATEGORIES)),
        ("creditCategories", strings(&finance::CREDIT_CATEGORIES)),
        ("quoteFields", strings(&scenario_api::QUOTE_FIELDS)),
        (
            "quoteTotalSource",
            leaf(thuisaccu_storage::analysis::QUOTE_TOTAL_SOURCE),
        ),
        ("messageCodes", Node::Array(codes)),
        ("limits", Node::Object(limits)),
        (
            "typicalProfile",
            Node::Object(vec![
                ("heat_pump_kwh", limit(typical_profile::HEAT_PUMP_KWH)),
                ("ev_kwh", limit(typical_profile::EV_KWH)),
                ("peak_power_kwp", limit(typical_profile::PEAK_POWER_KWP)),
            ]),
        ),
        (
            "loadChanges",
            Node::Object(vec![
                (
                    "heat_pump",
                    limit(typical_profile::LOAD_CHANGE_HEAT_PUMP_KWH),
                ),
                ("ev", limit(typical_profile::LOAD_CHANGE_EV_KWH)),
            ]),
        ),
    ])
}

/// Op één regel: `{ min: 1, max: 30 }` of `["a", "b"]`. Sleutels zijn geldige JavaScript-namen en staan zonder
/// aanhalingstekens; tekst is JSON en daarmee ook geldig JavaScript.
fn inline(node: &Node) -> String {
    match node {
        Node::Leaf(value) => value.to_string(),
        Node::Array(items) => {
            let items: Vec<String> = items.iter().map(inline).collect();
            format!("[{}]", items.join(", "))
        }
        Node::Object(fields) => {
            let fields: Vec<String> = fields
                .iter()
                .map(|(key, value)| format!("{key}: {}", inline(value)))
                .collect();
            format!("{{ {} }}", fields.join(", "))
        }
    }
}

/// Past het op de regel (hoogstens 120 tekens, `used` staat er al), dan op één regel; anders één onderdeel per regel.
fn write(node: &Node, indent: usize, used: usize) -> String {
    let flat = inline(node);
    let (open, close, items): (&str, &str, Vec<String>) = match node {
        _ if indent + used + flat.len() <= 120 => return flat,
        Node::Leaf(_) => return flat,
        Node::Array(items) => (
            "[",
            "]",
            items
                .iter()
                .map(|item| write(item, indent + 2, 0))
                .collect(),
        ),
        Node::Object(fields) => (
            "{",
            "}",
            fields
                .iter()
                .map(|(key, value)| format!("{key}: {}", write(value, indent + 2, key.len() + 2)))
                .collect(),
        ),
    };
    let pad = " ".repeat(indent + 2);
    let items: Vec<String> = items.iter().map(|item| format!("{pad}{item}")).collect();
    format!(
        "{open}\n{}\n{}{close}",
        items.join(",\n"),
        " ".repeat(indent)
    )
}

fn render() -> String {
    let body = write(&contract(), 2, "return freeze(".len());
    format!(
        r#""use strict";

// GEGENEREERD door crates/server/tests/contract.rs uit de constanten in de Rust-code; niet met de hand bewerken.
// Vernieuwen: UPDATE_CONTRACT=1 cargo test -p thuisaccu-server --test contract
// Feiten uit de rekenkern, de opslag en de API die de interface overneemt: de modelversie, het laatste jaar met
// salderen, doelen, soorten aansluiting, kostencategorieën, offertevelden in de volgorde van de interface, de vaste
// meldingscodes en de grenzen van de invoer (per onderdeel van het verzoek, min en max inbegrepen). Alles is bevroren.
window.Contract = (() => {{
  const freeze = value => {{
    if (value && typeof value === "object") {{
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }}
    return value;
  }};
  return freeze({body});
}})();
"#
    )
}

#[test]
fn committed_contract_matches_the_code() {
    let actual = render();
    if std::env::var_os("UPDATE_CONTRACT").is_some() {
        std::fs::write(PATH, &actual).unwrap();
        return;
    }
    // Git kan op Windows CRLF uitchecken; de inhoud telt, niet het regeleinde.
    let committed = std::fs::read_to_string(PATH).unwrap().replace("\r\n", "\n");
    assert!(
        committed == actual,
        "web/contract.js wijkt af van de code. Draai `UPDATE_CONTRACT=1 cargo test -p thuisaccu-server --test contract` en controleer het verschil."
    );
}

/// De tabel met meldingscodes in `docs/api.md` noemt precies de codes uit de rekenkern, met dezelfde soort.
#[test]
fn documented_message_codes_match_the_core() {
    let docs = include_str!("../../../docs/api.md");
    let documented: Vec<(&str, MessageKind)> = docs
        .lines()
        .filter_map(|line| {
            let cells: Vec<&str> = line.split('|').map(str::trim).collect();
            let code = cells.get(1)?.strip_prefix('`')?.strip_suffix('`')?;
            let kind = match *cells.get(2)? {
                "waarschuwing" => MessageKind::Warning,
                "uitleg" => MessageKind::Note,
                _ => return None,
            };
            Some((code, kind))
        })
        .collect();
    assert_eq!(documented, analysis::MESSAGE_CODES);
}

/// De shell laadt het contract vóór de scripts die het gebruiken.
#[test]
fn shell_loads_the_contract_before_the_data_script() {
    let html = include_str!("../../../web/index.html");
    let contract = html
        .find(r#"src="contract.js""#)
        .expect("contract.js niet geladen");
    let ui = html.find(r#"src="ui.js""#).unwrap();
    let data = html.find(r#"src="data.js""#).unwrap();
    assert!(contract < ui && contract < data);
}
