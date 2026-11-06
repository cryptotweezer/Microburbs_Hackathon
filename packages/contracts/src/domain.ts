// Our own domain types, shared by the backend and the extension.
import { z } from "zod";

export const Mode = z.enum(["sale", "rent"]);
export type Mode = z.infer<typeof Mode>;

export const MatchStatus = z.enum(["exact-unit", "exact-building", "ambiguous", "withheld", "unsupported"]);
export type MatchStatus = z.infer<typeof MatchStatus>;

export const AddressMatch = z.object({
  input: z.string(),
  normalized: z.string(),
  status: MatchStatus,
  gnafId: z.string().nullable(),
  suburb: z.string().nullable(),
  matchedAddress: z.string().nullable(),
  candidates: z.array(z.object({ id: z.string(), name: z.string() })).default([]),
  note: z.string().optional(),
});
export type AddressMatch = z.infer<typeof AddressMatch>;

/** A single fact block: every number shown in the panel carries its source and date. */
export const fact = <T extends z.ZodTypeAny>(value: T) =>
  z.object({
    available: z.boolean(),
    value: value.nullable(),
    source: z.string(),
    asOf: z.string().nullable(),
    reason: z.string().optional(),
  });
export type Fact<T> = { available: boolean; value: T | null; source: string; asOf: string | null; reason?: string };

export const EvidenceItem = z.object({
  id: z.string(),
  text: z.string(),
  source: z.string(),
  asOf: z.string().nullable(),
});
export type EvidenceItem = z.infer<typeof EvidenceItem>;

export const RentEstimate = z.object({
  gnafId: z.string(),
  rentWithCarSpace: z.number(),
  rentWithoutCarSpace: z.number(),
  support: z.enum(["unit", "building", "suburb", "city"]),
  modelVersion: z.string(),
});
export type RentEstimate = z.infer<typeof RentEstimate>;
