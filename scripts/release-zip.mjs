// Copies the WXT zip to a stable name (dist/listing-lens.zip) for GitHub Releases and the installers.
// Build it against production first: WXT_BACKEND_URL=https://<backend> pnpm release:extension
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";

const out = "apps/extension/.output";
const zip = readdirSync(out).find((f) => f.endsWith("-chrome.zip"));
if (!zip) throw new Error(`No chrome zip in ${out}`);
mkdirSync("dist", { recursive: true });
copyFileSync(`${out}/${zip}`, "dist/listing-lens.zip");
console.log(`dist/listing-lens.zip <- ${zip} (backend: ${process.env.WXT_BACKEND_URL || "http://localhost:3000"})`);
