// Key-value cache: Upstash Redis when configured, in-memory otherwise (local dev and tests).
import { Redis } from "@upstash/redis";

export interface Cache {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  /** Atomic counter; the TTL is set when the key is created. */
  incr(key: string, ttlSeconds: number): Promise<number>;
}

export function memoryCache(): Cache {
  const store = new Map<string, { v: unknown; exp: number }>();
  return {
    async get<T>(key: string) {
      const hit = store.get(key);
      if (!hit || (hit.exp && hit.exp < Date.now())) return null;
      return hit.v as T;
    },
    async set(key, value, ttl) {
      store.set(key, { v: value, exp: ttl ? Date.now() + ttl * 1000 : 0 });
    },
    async incr(key, ttl) {
      const hit = store.get(key);
      const live = hit && (!hit.exp || hit.exp >= Date.now());
      const n = (live ? (hit!.v as number) : 0) + 1;
      store.set(key, { v: n, exp: live ? hit!.exp : Date.now() + ttl * 1000 });
      return n;
    },
  };
}

function redisCache(redis: Redis): Cache {
  return {
    get: (key) => redis.get(key),
    async set(key, value, ttl) {
      if (ttl) await redis.set(key, value, { ex: ttl });
      else await redis.set(key, value);
    },
    async incr(key, ttl) {
      const n = await redis.incr(key);
      if (n === 1) await redis.expire(key, ttl);
      return n;
    },
  };
}

let shared: Cache | null = null;
export function getCache(): Cache {
  if (!shared) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    shared = url && token ? redisCache(new Redis({ url, token })) : memoryCache();
  }
  return shared;
}

/** Read-through helper: returns the cached value or computes and stores it. */
export async function cached<T>(cache: Cache, key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
  const hit = await cache.get<T>(key);
  if (hit !== null && hit !== undefined) return hit;
  const value = await fn();
  await cache.set(key, value, ttlSeconds);
  return value;
}
