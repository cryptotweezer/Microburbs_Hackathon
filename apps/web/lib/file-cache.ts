// JSON file cache for local scripts, so repeated runs do not pay for the same API calls twice.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Cache } from "./cache";

export function fileCache(path: string): Cache {
  const store: Record<string, unknown> = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
  const flush = () => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(store));
  };
  return {
    async get<T>(key: string) {
      return (store[key] as T) ?? null;
    },
    async set(key, value) {
      store[key] = value;
      flush();
    },
    async incr(key) {
      return this.incrBy(key, 1, 0);
    },
    async incrBy(key, by) {
      const n = ((store[key] as number) ?? 0) + by;
      store[key] = n;
      flush();
      return n;
    },
  };
}
