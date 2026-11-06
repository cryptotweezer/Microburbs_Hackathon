// Synthetic fixtures: same shape as real Microburbs responses, made-up values.
export const fx = {
  geocode: { data: [{ id: "GANSW000000001", name: "Unit 1, 10 Example Street", typ: "addr", display_name: "Unit 1, 10 Example Street", abbr: "UNIT 1, 10 EXAMPLE ST", property_type: "unit" }] },
  listings: { data: { total: 1, results: [{ gnaf_pid: "GANSW000000001", area_level: "address", area_name: "Unit 1, 10 Example Street", address: { street: "Unit 1, 10 Example Street", sal: "Pyrmont", sa1: "100", state: "NSW" }, attributes: { bedrooms: 2, bathrooms: 1, garage_spaces: 1, building_size: 80, land_size: 80, description: null }, coordinates: { latitude: -33.87, longitude: 151.19 }, listing_date: "2026-10-01", price: null, property_type: "Unit", property_type_raw: "unit", off_market: false }] } },
  agentQuoting: { data: { agency_name: "Example Agency", cohort: "Moderate Underquoter", median_deviation_pct: 4.1, underquote_rate_pct: 70, total_sales: 12, asking_price: 800000, likely_sale_price: 830000, recent_sales: [{ address: "Unit 2, 10 Example Street", guide_price: 700000, sold_price: 730000, diff_pct: 4.3, sold_date: "2026-05-01" }] } },
  avm: { data: { predicted_price: 900000, predicted_price_low: 800000, predicted_price_high: 1000000, prediction_date: "2026-07-27", confidence_score: 70 } },
  noData: { data: null, available: false, reason: "no_data", message: "No AVM for GANSW000000001" },
  history: { data: [{ date: "2026-10-01", price: null, type: "For Sale", address: "Unit 1, 10 Example Street" }, { date: "2019-01-01", price: 600000, type: "Sold", address: "Unit 1, 10 Example Street" }] },
  comparables: { data: [{ address: "UNIT 3, 10 EXAMPLE ST", property_type: "unit", gnaf_pid: "GANSW000000003", price: 850000, date_sold: "2026-09-01", dist_km: 0.1, bedrooms: 2, bathrooms: 1, garage_spaces: 1, land_size: 85, latitude: -33.87, longitude: 151.19, sale_date: null, sale_price: null }] },
  transport: { data: { gnaf_id: "GANSW000000001", radius_m: 1000, counts: { train: 2, bus: 10 }, nearest: { train: { label: "Train station", lat: -33.87, lng: 151.19, distance_m: 300 }, tram: null, bus: { label: "Bus stop", lat: -33.87, lng: 151.19, distance_m: 80 }, ferry: null } } },
  risks: { data: { flood: null, heritage: [{ area_level: "Layer", area_name: "Risk Layer", name: "Heritage", value: "Not on property; nearest 50 m", on_property: false, nearest_distance_m: 50, search_radius_m: 1000, features_within_radius: 10, value_unit: null }] } },
  profile: { data: { mesh_block: "1", sa1: "100", sa2: "Pyrmont", sa3: "Sydney Inner City", lga: "Sydney", suburb: "Pyrmont", postcode: "2009", state: "NSW" } },
  basics: { data: { bed_count: 2, bath_count: 1, parking_count: 1, dwelling_type: "apartment", land_area_sqm: 80 } },
};
