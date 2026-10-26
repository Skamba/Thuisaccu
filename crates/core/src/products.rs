//! Productonderzoek met afzonderlijke configuraties, bronnen en waarnemingen.
//!
//! Een waarneming is een bronclaim, geen automatisch geverifieerde waarheid.
//! Ontbrekende waarden blijven `None`; zie `docs/data-model.md`.

use std::{fmt, str::FromStr};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnknownCode(pub String);

impl fmt::Display for UnknownCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Onbekende code in de catalogus: {}", self.0)
    }
}

impl std::error::Error for UnknownCode {}

macro_rules! codes {
    ($name:ident { $($variant:ident => $code:literal),+ $(,)? }) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq)]
        pub enum $name { $($variant),+ }

        impl $name {
            pub const ALL: &'static [Self] = &[$(Self::$variant),+];

            pub const fn as_str(self) -> &'static str {
                match self { $(Self::$variant => $code),+ }
            }
        }

        impl FromStr for $name {
            type Err = UnknownCode;

            fn from_str(value: &str) -> Result<Self, Self::Err> {
                match value {
                    $($code => Ok(Self::$variant),)+
                    _ => Err(UnknownCode(value.to_owned())),
                }
            }
        }
    };
}

codes!(ProductKind {
    BatteryModule => "battery_module", BatterySystem => "battery_system",
    Inverter => "inverter", Controller => "controller", Gateway => "gateway",
    Accessory => "accessory",
});
codes!(SourceKind {
    Datasheet => "datasheet", Manual => "manual", Warranty => "warranty",
    CompatibilityList => "compatibility_list", Certification => "certification",
    IndependentTest => "independent_test", Offer => "offer",
    ProductPage => "product_page", Other => "other",
});
codes!(ReviewStatus {
    Unreviewed => "unreviewed", Reviewed => "reviewed", Disputed => "disputed",
    Superseded => "superseded",
});
codes!(NumberQualifier {
    Exact => "exact", Approximate => "approximate", AtLeast => "at_least",
    AtMost => "at_most", Range => "range",
    LessThan => "less_than", GreaterThan => "greater_than",
});
codes!(MeasurementBoundary {
    Unspecified => "unspecified", BatteryDc => "battery_dc", SystemAc => "system_ac",
    DcDc => "dc_dc", AcAc => "ac_ac", PvAc => "pv_ac",
});
codes!(NumericMetric {
    NominalEnergy => "nominal_energy_wh", UsableEnergy => "usable_energy_wh",
    ContinuousChargePower => "continuous_charge_power_w",
    ContinuousDischargePower => "continuous_discharge_power_w",
    PeakDischargePower => "peak_discharge_power_w", PeakDuration => "peak_duration_s",
    ApparentPower => "apparent_power_va", BackupPower => "backup_power_w",
    RoundTripEfficiency => "round_trip_efficiency_pct",
    ChargeEfficiency => "charge_efficiency_pct", DischargeEfficiency => "discharge_efficiency_pct",
    DepthOfDischarge => "depth_of_discharge_pct", StandbyPower => "standby_power_w",
    SelfDischarge => "self_discharge_pct_per_month", CycleLife => "cycle_life_cycles",
    EndOfLifeCapacity => "end_of_life_capacity_pct", DesignLife => "design_life_years",
    NominalVoltage => "nominal_voltage_v", OperatingVoltage => "operating_voltage_v",
    ContinuousChargeCurrent => "continuous_charge_current_a",
    ContinuousDischargeCurrent => "continuous_discharge_current_a",
    PeakCurrent => "peak_current_a", GridFrequency => "grid_frequency_hz",
    PhaseCount => "phase_count", ModuleCount => "module_count",
    MaxParallelUnits => "max_parallel_units", MaxSystemEnergy => "max_system_energy_wh",
    Height => "height_mm", Width => "width_mm", Depth => "depth_mm", Weight => "weight_kg",
    ChargeTemperature => "charge_temperature_c", DischargeTemperature => "discharge_temperature_c",
    StorageTemperature => "storage_temperature_c", Noise => "noise_db_a",
    MaxAltitude => "max_altitude_m", RelativeHumidity => "relative_humidity_pct",
    TransferTime => "transfer_time_ms", PvInputPower => "pv_input_power_w",
    MpptCount => "mppt_count",
    SystemPerformanceIndex5Kw => "system_performance_index_5kw_pct",
    SystemPerformanceIndex10Kw => "system_performance_index_10kw_pct",
    SettlingTime => "settling_time_s",
});
codes!(FeatureMetric {
    Backup => "backup", OffGrid => "off_grid", BlackStart => "black_start",
    ThreePhaseBackup => "three_phase_backup", AsymmetricOutput => "asymmetric_output",
    GridCharging => "grid_charging", GridExport => "grid_export",
    DynamicTariffs => "dynamic_tariffs", LocalApi => "local_api",
    RemoteControl => "remote_control", OfflineOperation => "offline_operation",
    CloudRequired => "cloud_required", SubscriptionRequired => "subscription_required",
    Indoor => "indoor", Outdoor => "outdoor", Expandable => "expandable",
    InverterIncluded => "inverter_included", EmsIncluded => "ems_included",
});
codes!(FeatureStatus {
    Supported => "supported", Unsupported => "unsupported", Conditional => "conditional",
    Unknown => "unknown",
});
codes!(TextMetric {
    Chemistry => "chemistry", Coupling => "coupling", PhaseTopology => "phase_topology",
    IpRating => "ip_rating", Cooling => "cooling", Mounting => "mounting",
    Communication => "communication", ControlProtocol => "control_protocol",
    EmsProvider => "ems_provider", RequiredAccessories => "required_accessories",
    InstallationRequirements => "installation_requirements",
    Recycling => "recycling", Repairability => "repairability", ServiceRegion => "service_region",
});
codes!(CompatibilityStatus {
    Compatible => "compatible", Incompatible => "incompatible", Conditional => "conditional",
    Required => "required",
});
codes!(ConformityStatus {
    Claimed => "claimed", Certified => "certified", Tested => "tested", Pending => "pending",
});
codes!(WarrantyLimitRule {
    FirstReached => "first_reached", Other => "other", NotStated => "not_stated",
});
codes!(TaxBasis { Included => "included", Excluded => "excluded", Unknown => "unknown" });
codes!(BillingPeriod { Month => "month", Year => "year" });
codes!(Availability {
    InStock => "in_stock", Preorder => "preorder", OutOfStock => "out_of_stock",
    OnRequest => "on_request", Unknown => "unknown",
});

#[derive(Debug, Clone, PartialEq)]
pub struct Record<T> {
    pub id: i64,
    pub data: T,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Manufacturer {
    pub name: String,
    pub website: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Product {
    pub manufacturer_id: i64,
    pub name: String,
    pub model_code: String,
    pub kind: ProductKind,
}

/// Eén te onderzoeken uitvoering; de onderdelen staan in `Component`.
#[derive(Debug, Clone, PartialEq)]
pub struct Configuration {
    pub product_id: i64,
    pub name: String,
    pub variant_code: String,
    pub hardware_revision: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Component {
    pub entry_id: i64,
    pub product_id: i64,
    pub quantity: i64,
    pub role: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Source {
    pub kind: SourceKind,
    pub title: String,
    pub url: String,
    pub document_revision: Option<String>,
    /// Datum zoals gepubliceerd, YYYY-MM-DD; tijdstip wordt niet verzonnen.
    pub published_on: Option<String>,
    pub retrieved_at_unix_s: i64,
    pub sha256: Option<String>,
    pub archived_path: Option<String>,
}

/// Gedeelde herkomst van claims; gebruik aparte entries bij andere context.
#[derive(Debug, Clone, PartialEq)]
pub struct ResearchEntry {
    pub configuration_id: i64,
    pub source_id: i64,
    pub locator: String,
    pub observed_at_unix_s: i64,
    pub market: String,
    pub firmware_revision: Option<String>,
    pub review_status: ReviewStatus,
    pub reviewed_by: Option<String>,
    pub reviewed_at_unix_s: Option<i64>,
    pub conditions: String,
    pub notes: String,
}

/// Waarde in de eenheid uit de metriccatalogus; onbekend krijgt geen numerieke rij.
#[derive(Debug, Clone, PartialEq)]
pub struct NumericObservation {
    pub entry_id: i64,
    pub metric: NumericMetric,
    pub qualifier: NumberQualifier,
    pub value: f64,
    pub upper_value: Option<f64>,
    pub boundary: MeasurementBoundary,
    pub reported_value: String,
    pub test_temperature_c: Option<f64>,
    pub test_power_w: Option<f64>,
    pub test_soc_pct: Option<f64>,
    pub test_depth_of_discharge_pct: Option<f64>,
    pub test_c_rate: Option<f64>,
    pub conditions: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FeatureObservation {
    pub entry_id: i64,
    pub metric: FeatureMetric,
    pub status: FeatureStatus,
    pub conditions: String,
}

/// Eén vermelding per rij, bijvoorbeeld twee aparte communicatieprotocollen.
#[derive(Debug, Clone, PartialEq)]
pub struct TextObservation {
    pub entry_id: i64,
    pub metric: TextMetric,
    pub value: String,
    pub conditions: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct WarrantyTerms {
    pub entry_id: i64,
    pub product_months: Option<i64>,
    pub performance_months: Option<i64>,
    pub retained_capacity_pct: Option<f64>,
    pub cycle_limit: Option<i64>,
    pub throughput_wh: Option<i64>,
    pub limit_rule: WarrantyLimitRule,
    pub application: String,
    pub activation_required: Option<bool>,
    pub internet_required: Option<bool>,
    pub labour_included: Option<bool>,
    pub transferable: Option<bool>,
    pub exclusions: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CompatibilityClaim {
    pub entry_id: i64,
    pub counterpart_product_id: i64,
    pub status: CompatibilityStatus,
    pub counterpart_firmware: Option<String>,
    pub battery_firmware: Option<String>,
    pub min_modules: Option<i64>,
    pub max_modules: Option<i64>,
    pub min_parallel_units: Option<i64>,
    pub max_parallel_units: Option<i64>,
    pub conditions: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ConformityClaim {
    pub entry_id: i64,
    pub standard: String,
    pub edition: Option<String>,
    pub status: ConformityStatus,
    pub certificate_reference: Option<String>,
    pub conditions: String,
}

/// Geld in minor units: 12345 met exponent 2 = 123,45 in de expliciete valuta.
#[derive(Debug, Clone, PartialEq)]
pub struct Offer {
    pub entry_id: i64,
    pub seller: String,
    pub currency: String,
    pub minor_unit_exponent: i64,
    pub upfront_amount_minor: i64,
    pub recurring_amount_minor: Option<i64>,
    pub recurring_period: Option<BillingPeriod>,
    pub tax_basis: TaxBasis,
    pub tax_rate_bps: Option<i64>,
    pub includes_battery: Option<bool>,
    pub includes_inverter: Option<bool>,
    pub includes_gateway: Option<bool>,
    pub includes_installation: Option<bool>,
    pub includes_delivery: Option<bool>,
    pub valid_until_unix_s: Option<i64>,
    pub availability: Availability,
    pub additional_costs_notes: String,
}
