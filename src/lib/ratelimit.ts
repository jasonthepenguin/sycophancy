import { Ratelimit } from "@upstash/ratelimit";
import { getRedis } from "@/lib/redis";

type LimitResult = { success: boolean } & Record<string, unknown>;
type Limiter = { limit: (key: string) => Promise<LimitResult> };

function createNoopLimiter(): Limiter {
  return {
    async limit() {
      return { success: true };
    },
  };
}

export function getIpLimiter(): Limiter {
  const hasRedis =
    Boolean(process.env.UPSTASH_REDIS_REST_URL) &&
    Boolean(process.env.UPSTASH_REDIS_REST_TOKEN);
  if (!hasRedis) return createNoopLimiter();

  return new Ratelimit({
    redis: getRedis(),
    limiter: Ratelimit.slidingWindow(60, "10 m"),
    analytics: true,
    prefix: "rl:ip",
  });
}

export function getUsernameLimiter(): Limiter {
  const hasRedis =
    Boolean(process.env.UPSTASH_REDIS_REST_URL) &&
    Boolean(process.env.UPSTASH_REDIS_REST_TOKEN);
  if (!hasRedis) return createNoopLimiter();

  return new Ratelimit({
    redis: getRedis(),
    limiter: Ratelimit.slidingWindow(10, "10 m"),
    analytics: true,
    prefix: "rl:user",
  });
}


