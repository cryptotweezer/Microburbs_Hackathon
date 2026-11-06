// Builds the comparison target (what the user is looking at) from the resolved facts.
import type { AddressMatch, Mode, Sal } from "@mb/contracts";
import type { Target } from "./alternatives";
import type { PropertyFacts } from "./facts";

export function targetFromFacts(match: AddressMatch, mode: Mode, facts: PropertyFacts): Target | null {
  if (!match.suburb) return null;
  const l = facts.listing.value;
  const b = facts.basics.value;
  // Hidden price: fall back to the agency-adjusted likely price from Microburbs.
  const price = l?.price ?? (mode === "sale" ? (facts.agentQuoting.value?.likely_sale_price ?? null) : null);
  return {
    gnafId: match.gnafId,
    suburb: match.suburb as Sal,
    mode,
    price,
    bedrooms: l?.bedrooms ?? b?.bed_count ?? null,
    bathrooms: l?.bathrooms ?? b?.bath_count ?? null,
    parking: l?.parking ?? b?.parking_count ?? null,
    buildingSize: l?.buildingSize ?? null,
    propertyType: l?.propertyType ?? b?.dwelling_type ?? null,
    lat: l?.lat ?? (facts.cma.value?.same_building ? (facts.cma.value.latitude ?? null) : null),
    lng: l?.lng ?? (facts.cma.value?.same_building ? (facts.cma.value.longitude ?? null) : null),
  };
}
