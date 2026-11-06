// Abuse drill: fires a burst of requests at a backend and reports how many were rate limited.
// Uses an invalid section name so admitted requests fail validation and never reach the paid API.
// Usage: pnpm exec tsx scripts/abuse-test.mts [baseUrl] [count]
const base = process.argv[2] ?? "http://localhost:3000";
const count = Number(process.argv[3] ?? 50);
const headers = { "x-listing-lens": "1", "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 250)}` };

const statuses = await Promise.all(
  Array.from({ length: count }, () => fetch(`${base}/api/section?gnaf=GANSW000000000&name=nope`, { headers }).then((r) => r.status)),
);
const tally = statuses.reduce<Record<number, number>>((t, s) => ((t[s] = (t[s] ?? 0) + 1), t), {});
console.log(`burst of ${count}:`, tally);
const limited = tally[429] ?? 0;
if (limited === 0) {
  console.error("FAIL: no request was rate limited");
  process.exit(1);
}
console.log(`OK: ${limited} of ${count} rate limited`);
