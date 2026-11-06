// Vitest config: the WXT plugin provides the extension globals (browser, defineContentScript) to tests.
import { defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing/vitest-plugin";

export default defineConfig({ plugins: [WxtVitest()] });
