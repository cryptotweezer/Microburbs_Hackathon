// Reads ONE thing from the portal page: the property address (plus a sale/rent hint from the URL or title).
// Never reads prices, descriptions or photos. Follows SPA navigation between listings.
// Uses the WXT context so timers and observers stop when the extension is reloaded or updated.
import { addressMatchesUrl, extractAddress } from "@/lib/extract";

export default defineContentScript({
  matches: ["https://www.domain.com.au/*", "https://www.realestate.com.au/*"],
  runAt: "document_idle",
  main(ctx) {
    let lastSent = "";
    let timers: number[] = [];

    const send = (payload: unknown) => {
      if (ctx.isInvalid) return;
      try {
        void browser.runtime.sendMessage({ type: "listing", payload }).catch(() => {});
      } catch {
        // "Extension context invalidated": the old script lingers after a reload. Stop quietly.
        ctx.abort();
      }
    };

    /** Sends the address once it is fresh: on SPA navigation the old page data can linger for a moment. */
    const report = (final: boolean) => {
      const found = extractAddress(document, location.href);
      const fresh = !found?.address || addressMatchesUrl(found.address, location.href);
      if (!fresh && !final) return;
      const key = `${location.href}|${found?.address ?? ""}`;
      if (key !== lastSent) {
        lastSent = key;
        send({ ...found, url: location.href, at: Date.now() });
      }
    };

    /** Retries a few times after a change, then reports whatever we have. */
    const schedule = () => {
      timers.forEach(clearTimeout);
      const delays = [300, 900, 1800, 3500];
      timers = delays.map((ms, i) => ctx.setTimeout(() => report(i === delays.length - 1), ms));
    };

    report(true);
    let href = location.href;
    const onUrlMaybeChanged = () => {
      if (location.href !== href) {
        href = location.href;
        lastSent = "";
        schedule();
      }
    };
    ctx.setInterval(onUrlMaybeChanged, 500);
    ctx.addEventListener(window, "popstate", onUrlMaybeChanged);
    // Late-rendered content (JSON-LD, title) on the same URL.
    let pending: number | undefined;
    const observer = new MutationObserver(() => {
      clearTimeout(pending);
      pending = ctx.setTimeout(() => report(false), 600);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    ctx.onInvalidated(() => observer.disconnect());
  },
});
