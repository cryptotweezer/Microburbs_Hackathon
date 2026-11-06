// Zod schemas for the Microburbs API responses we use.
// Shapes were taken from real responses; fields are lenient where the API is inconsistent.
import { z } from "zod";

const num = z.number().nullable().optional();
const str = z.string().nullable().optional();

/** Envelope returned when an endpoint has no data for the requested entity. */
export const NoDataEnvelope = z.object({
  data: z.null(),
  available: z.literal(false).optional(),
  reason: z.string().optional(),
  message: z.string().optional(),
});

export const GeocodeCandidate = z.object({
  id: z.string(),
  name: z.string(),
  typ: str,
  display_name: str,
  abbr: str,
  property_type: str,
});
export type GeocodeCandidate = z.infer<typeof GeocodeCandidate>;

export const ListingRow = z.object({
  gnaf_pid: z.string(),
  area_name: z.string(),
  address: z.object({ street: z.string(), sal: z.string(), sa1: str, state: str }),
  attributes: z.object({
    bedrooms: num,
    bathrooms: num,
    garage_spaces: num,
    building_size: num,
    land_size: num,
    description: str,
  }),
  coordinates: z.object({ latitude: z.number(), longitude: z.number() }).nullable().optional(),
  listing_date: str,
  price: num,
  property_type: str,
  property_type_raw: str,
  off_market: z.boolean().nullable().optional(),
});
export type ListingRow = z.infer<typeof ListingRow>;

export const ListingsPage = z.object({ results: z.array(ListingRow), total: z.number() });

export const AgentQuoting = z.object({
  agency_name: str,
  cohort: str,
  median_deviation_pct: num,
  underquote_rate_pct: num,
  total_sales: num,
  asking_price: num,
  likely_sale_price: num,
  recent_sales: z
    .array(
      z.object({
        address: str,
        guide_price: num,
        sold_price: num,
        diff_pct: num,
        sold_date: str,
      }),
    )
    .default([]),
});
export type AgentQuoting = z.infer<typeof AgentQuoting>;

export const Avm = z.object({
  predicted_price: z.number(),
  predicted_price_low: num,
  predicted_price_high: num,
  prediction_date: str,
  confidence_score: num,
});
export type Avm = z.infer<typeof Avm>;

export const HistoryEntry = z.object({
  date: z.string(),
  price: num,
  type: z.string(),
  address: str,
});
export type HistoryEntry = z.infer<typeof HistoryEntry>;

/** Raw comparable sale; duplicated null fields (sale_date, sale_price, ...) are dropped by Zod. */
export const RecentSale = z.object({
  address: str,
  property_type: str,
  gnaf_pid: str,
  price: num,
  date_sold: str,
  dist_km: num,
  bedrooms: num,
  bathrooms: num,
  garage_spaces: num,
  land_size: num,
  latitude: num,
  longitude: num,
});
export type RecentSale = z.infer<typeof RecentSale>;

const NearestStop = z
  .object({ name: str, label: str, lat: num, lng: num, distance_m: num })
  .nullable()
  .optional();
export const TransportNearby = z.object({
  radius_m: num,
  counts: z.record(z.string(), z.number()).optional(),
  nearest: z.object({ train: NearestStop, tram: NearestStop, bus: NearestStop, ferry: NearestStop }),
});
export type TransportNearby = z.infer<typeof TransportNearby>;

export const RiskLayer = z.object({
  name: str,
  value: str,
  on_property: z.boolean().nullable().optional(),
  nearest_distance_m: num,
  search_radius_m: num,
  features_within_radius: num,
  value_unit: str,
});
export const RisksAll = z.record(z.string(), z.array(RiskLayer).nullable());
export type RisksAll = z.infer<typeof RisksAll>;

export const Profile = z.object({
  mesh_block: str,
  sa1: str,
  sa2: str,
  lga: str,
  suburb: str,
  postcode: str,
  state: str,
});
export type Profile = z.infer<typeof Profile>;

export const Basics = z.object({
  bed_count: num,
  bath_count: num,
  parking_count: num,
  dwelling_type: str,
  land_area_sqm: num,
});
export type Basics = z.infer<typeof Basics>;

/** Microburbs CMA: the single best comparable sale for a property. */
export const CmaComp = z.object({
  gnaf_pid: str,
  street: str,
  sal: str,
  bedrooms: num,
  bathrooms: num,
  garage_spaces: num,
  price: num,
  date_sold: str,
  latitude: num,
  longitude: num,
  same_building: z.boolean().nullable().optional(),
  distance_m: num,
  property_type: str,
  source: str,
});
export type CmaComp = z.infer<typeof CmaComp>;

export const SchoolNearby = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  name: z.string(),
  sector: str,
  school_level_type: str,
  distance_m: num,
});
export type SchoolNearby = z.infer<typeof SchoolNearby>;

/** Suburb indicator endpoints share a loose shape: a flat object of numbers and labels. */
export const SuburbIndicator = z.record(z.string(), z.unknown());
