// WXT build config (MV3). Permissions stay minimal: side panel, tabs, storage, the two portal hosts and the backend.
import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

// Public key only (safe to publish): it pins the extension ID to edgmigmfohaclnlempjiailbeokgnhlm, so the backend can allow exactly
// this origin in CORS (EXTENSION_ORIGIN=chrome-extension://edgmigmfohaclnlempjiailbeokgnhlm). There is no matching secret in the repo.
const EXTENSION_KEY = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvHryUCM36W1qfb4J1NMttzsxWVfBTsXZpadxOyAWCD9JDkd2KIeKUb4PXvFPAYhWyt7IyHWqX2FrPqmU3+umtKOrMw0yLKHSyZyXjYmiLCPRDsBcuc4KYzY2FPrGF+lh7D9/X59jvob74LpMzpyUPqg5r4RjPUf3T9YPEyZBmsFQHCFh7yFsmQMJSkZhDtP9qiMGm0sKkJ8DrrRE4+RUAVGTQeubONmCotmz72iAEXMMaQY5xXxv+67gHMbm9NsGa43VusuNc1Gctbg0JNCRvJrS0gD9fRhcepmBGARawMWY2FWsjzHxnYvC/fu2asCN4LlqC/sUe3bqhyFpNlL5UQIDAQAB";
const backend = process.env.WXT_BACKEND_URL || "http://localhost:3000";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  vite: () => ({ plugins: [tailwindcss()], build: { sourcemap: true, minify: false } }),
  manifest: {
    name: "Microburbs Listing Lens",
    description: "Exact-unit Microburbs data next to City of Sydney listings on realestate.com.au and Domain.",
    key: EXTENSION_KEY,
    permissions: ["sidePanel", "tabs", "storage"],
    host_permissions: [
      "https://www.realestate.com.au/*",
      "https://www.domain.com.au/*",
      `${new URL(backend).origin}/*`,
    ],
    action: { default_title: "Open Microburbs panel" },
  },
});
