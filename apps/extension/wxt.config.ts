// WXT build config (MV3). Permissions stay minimal: side panel, tabs, storage and the two portal hosts.
import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  vite: () => ({ plugins: [tailwindcss()], build: { sourcemap: true, minify: false } }),
  manifest: {
    name: "Microburbs Listing Lens",
    description: "Exact-unit Microburbs data next to City of Sydney listings on realestate.com.au and Domain.",
    permissions: ["sidePanel", "tabs", "storage"],
    host_permissions: [
      "https://www.realestate.com.au/*",
      "https://www.domain.com.au/*",
      "http://localhost:3000/*",
    ],
    action: { default_title: "Open Microburbs panel" },
  },
});
