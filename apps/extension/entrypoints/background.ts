// Keeps the latest listing address seen in each tab and relays it to the side panel.
// When the panel opens an alternative in a new tab, it "pins" the exact unit address to that tab,
// because portal pages do not always show the unit number.
import { buildingKey, parseAddress } from "@mb/contracts";
import type { Extracted } from "@/lib/extract";

export type TabListing = Partial<Extracted> & { url: string; at: number; tabId: number; pinned?: boolean };
interface Pin {
  address: string;
  mode: "sale" | "rent";
  at: number;
}

const key = (tabId: number) => `tab:${tabId}`;
const pinKey = (tabId: number) => `pin:${tabId}`;
const PIN_TTL_MS = 30 * 60 * 1000;

/** Uses the pinned unit address while the tab stays on the same building. */
async function withPin(ctx: TabListing): Promise<TabListing> {
  const pin = (await browser.storage.session.get(pinKey(ctx.tabId)))[pinKey(ctx.tabId)] as Pin | undefined;
  if (!pin || Date.now() - pin.at > PIN_TTL_MS) return ctx;
  const seen = ctx.address ? parseAddress(ctx.address) : null;
  const pinned = parseAddress(pin.address);
  const sameBuilding = !seen || !buildingKey(seen) || buildingKey(seen) === buildingKey(pinned);
  if (!sameBuilding) {
    await browser.storage.session.remove(pinKey(ctx.tabId));
    return ctx;
  }
  if (seen?.unit && seen.unit !== pinned.unit) return ctx;
  return { ...ctx, address: pin.address, modeHint: pin.mode, isListing: true, pinned: true };
}

export default defineBackground(() => {
  browser.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

  browser.runtime.onMessage.addListener((msg: { type: string; payload?: unknown; tabId?: number; address?: string; mode?: "sale" | "rent"; url?: string }, sender) => {
    if (msg.type === "listing" && sender.tab?.id !== undefined) {
      const tabId = sender.tab.id;
      void withPin({ ...(msg.payload as object), tabId } as TabListing).then((ctx) => {
        void browser.storage.session.set({ [key(tabId)]: ctx });
        void browser.runtime.sendMessage({ type: "listing-update", payload: ctx }).catch(() => {});
      });
      return;
    }
    if (msg.type === "get-listing" && msg.tabId !== undefined) {
      return browser.storage.session.get(key(msg.tabId)).then((r) => r[key(msg.tabId!)] ?? null);
    }
    if (msg.type === "open-pinned" && msg.url && msg.address && msg.mode) {
      const pin: Pin = { address: msg.address, mode: msg.mode, at: Date.now() };
      return browser.tabs.create({ url: msg.url }).then(async (tab) => {
        if (tab.id !== undefined) await browser.storage.session.set({ [pinKey(tab.id)]: pin });
        return true;
      });
    }
  });

  browser.tabs.onRemoved.addListener((tabId) => void browser.storage.session.remove([key(tabId), pinKey(tabId)]));
});
