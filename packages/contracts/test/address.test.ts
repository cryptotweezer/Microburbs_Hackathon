// Address parsing and key tests, including portal formats, ranges and lettered units (B401 vs 401B).
import { describe, expect, it } from "vitest";
import { addressKey, buildingKey, parseAddress, toGnafQuery, toSal } from "../src/address";

const K = "15|2-26|wattle crescent|pyrmont";
// [input, expected unit key or null when it must not resolve]
const cases: [string, string | null][] = [
  ["15/2-26 Wattle Cres, Pyrmont NSW 2009", K],
  ["Unit 15, 2-26 Wattle Crescent, Pyrmont", K],
  ["Unit 15, 2-26 Wattle Crescent, Pyrmont, NSW", K],
  ["UNIT 15, 2-26 WATTLE CRES PYRMONT NSW 2009", K],
  ["Apartment 15, 2-26 Wattle Cres, Pyrmont", K],
  ["Apt 15/2-26 Wattle Cres, Pyrmont NSW", K],
  ["15 / 2 - 26 Wattle Cres, Pyrmont", K],
  ["Level 3, 15/2-26 Wattle Cres, Pyrmont NSW 2009", K],
  ["Unit 15, 2-26 Wattle Cres, Pyrmont NSW 2009, Australia", K],
  ["15/2-26 Wattle Cres Pyrmont NSW 2009", K],
  ["Unit 015, 2-26 Wattle Crescent, Pyrmont", K],
  ["A10/14 Quarry Master Dr, Pyrmont NSW 2009", "10a|14|quarry master drive|pyrmont"],
  ["Unit A10, 14 Quarry Master Drive, Pyrmont", "10a|14|quarry master drive|pyrmont"],
  ["18B/2 Distillery Dr, Pyrmont", "18b|2|distillery drive|pyrmont"],
  ["Suite 105, 38-52 Waterloo Street, Surry Hills, NSW", "105|38-52|waterloo street|surry hills"],
  ["62 Mary Street, Surry Hills, NSW", "|62|mary street|surry hills"],
  ["62 Mary St, Surry Hills NSW 2010", "|62|mary street|surry hills"],
  ["4/655 South Dowling St, Surry Hills NSW 2010", "4|655|south dowling street|surry hills"],
  ["57 High Holborn St, Surry Hills", "|57|high holborn street|surry hills"],
  ["902/417 Bourke St, Surry Hills NSW 2010", "902|417|bourke street|surry hills"],
  ["12/5 Elizabeth Bay Rd, Elizabeth Bay NSW 2011", "12|5|elizabeth bay road|elizabeth bay"],
  ["3/10 Cowper St, Glebe NSW 2037", "3|10|cowper street|glebe (nsw)"],
  ["3/10 Cowper Street, Glebe (NSW)", "3|10|cowper street|glebe (nsw)"],
  ["101/2 Archibald Ave, Waterloo NSW 2017", "101|2|archibald avenue|waterloo (nsw)"],
  ["7 Lower Fort St, Dawes Point NSW 2000", "|7|lower fort street|dawes point"],
  ["5/1 Upper Pitt St, The Rocks NSW 2000", "5|1|upper pitt street|the rocks (sydney - nsw)"],
  ["2001/101 Bathurst St, Sydney NSW 2000", "2001|101|bathurst street|sydney"],
  ["8/30 Victoria St, Potts Point NSW 2011", "8|30|victoria street|potts point"],
  ["Penthouse 2, 9 Harris St, Pyrmont", "2|9|harris street|pyrmont"],
  ["12 Phillip St, Redfern NSW 2016", "|12|phillip street|redfern"],
  ["Shop 1, 20 Crown Street, Woolloomooloo", "1|20|crown street|woolloomooloo"],
  ["11/1-3 Mcdonald St, Erskineville NSW 2043", "11|1-3|mcdonald street|erskineville"],
  ["6/45 Rosebery Ave, Rosebery NSW 2018", "6|45|rosebery avenue|rosebery (nsw)"],
  ["1203/1 Sterling Cct, Camperdown NSW 2050", "1203|1|sterling circuit|camperdown (nsw)"],
  // Must not resolve to a unit key
  ["Address available on request, Pyrmont NSW 2009", null],
  ["Contact agent, Surry Hills", null],
  ["15/2-26 Wattle Cres, Milsons Point NSW 2061", null],
  ["Pyrmont NSW 2009", null],
  ["15/2-26 Wattle Cres", null],
  ["Burleigh Heads QLD 4220", null],
];

describe("parseAddress", () => {
  it.each(cases)("%s", (input, expected) => {
    expect(addressKey(parseAddress(input))).toBe(expected);
  });

  it("flags withheld addresses", () => {
    expect(parseAddress("Address available on request, Pyrmont NSW 2009")).toMatchObject({ withheld: true, suburb: "Pyrmont" });
  });

  it("uses the suburb hint when the address has none", () => {
    expect(addressKey(parseAddress("Unit 15, 2-26 Wattle Cres", "Pyrmont"))).toBe(K);
  });

  it("building key ignores the unit", () => {
    expect(buildingKey(parseAddress("15/2-26 Wattle Cres, Pyrmont"))).toBe("2-26|wattle crescent|pyrmont");
  });

  it("builds a G-NAF geocode query", () => {
    expect(toGnafQuery(parseAddress("A10/14 Quarry Master Dr, Pyrmont NSW 2009"))).toBe("Unit A10, 14 Quarry Master Drive, Pyrmont NSW");
  });

  it("maps plain names to SAL names", () => {
    expect(toSal("Waterloo")).toBe("Waterloo (NSW)");
    expect(toSal("Bondi")).toBeNull();
  });
});

describe("lettered units", () => {
  it("treats B401 and 401B as the same unit", async () => {
    const { addressKey, parseAddress, swappedUnit } = await import("../src/address");
    expect(addressKey(parseAddress("B401/24 Point Street, Pyrmont NSW 2009"))).toBe(addressKey(parseAddress("Unit 401B, 24 Point Street, Pyrmont")));
    expect(addressKey(parseAddress("B401/24 Point Street, Pyrmont NSW 2009"))).not.toBe(addressKey(parseAddress("Unit 401, 24 Point Street, Pyrmont")));
    expect(swappedUnit("B401")).toBe("401B");
    expect(swappedUnit("401B")).toBe("B401");
    expect(swappedUnit("15")).toBeNull();
  });
});
