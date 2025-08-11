import { NextRequest } from "next/server";
import { getXReadOnlyClient } from "@/lib/xClient";
import { getRedis } from "@/lib/redis";
import { getIpLimiter, getUsernameLimiter } from "@/lib/ratelimit";
import { ApiResponseError } from "twitter-api-v2";

// GET /api/x/profile?username=:handle
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const username = searchParams.get("username");

  if (!username) {
    return new Response(JSON.stringify({ error: "username is required" }), {
      status: 400,
      headers: {
        "content-type": "application/json",
        "cache-control": "private, no-store",
      },
    });
  }

  try {
    const handle = username.replace(/^@/, "").trim().toLowerCase();
    const hasRedis =
      Boolean(process.env.UPSTASH_REDIS_REST_URL) &&
      Boolean(process.env.UPSTASH_REDIS_REST_TOKEN);
    const cacheKey = `cache:xprofile:${handle}`;
    let redis: ReturnType<typeof getRedis> | null = null;

    if (hasRedis) {
      redis = getRedis();
      const cached = await redis.get(cacheKey);
      if (cached) {
        const body = typeof cached === "string" ? cached : JSON.stringify(cached);
        try {
          if (redis) {
            await redis.set(cacheKey, body, { ex: 60 * 60 });
          }
        } catch {}
        return new Response(body, {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-cache": "HIT",
            "cache-control": "public, s-maxage=3600, stale-while-revalidate=60",
          },
        });
      }
    }

    // Rate limits only on cache miss
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "ip:unknown";
    const ipLimit = await getIpLimiter().limit(ip);
    if (!ipLimit.success) {
      return new Response(JSON.stringify({ error: "Too many requests (IP rate limit)" }), {
        status: 429,
        headers: { "content-type": "application/json", "cache-control": "private, no-store" },
      });
    }
    const userLimit = await getUsernameLimiter().limit(handle);
    if (!userLimit.success) {
      return new Response(JSON.stringify({ error: "Too many requests for this username" }), {
        status: 429,
        headers: { "content-type": "application/json", "cache-control": "private, no-store" },
      });
    }

    if (hasRedis && redis) {
      const cooldownKey = `cooldown:x:v2UserLookup`;
      const cooldownSeconds = await redis.get<number>(cooldownKey);
      if (cooldownSeconds && cooldownSeconds > 0) {
        return new Response(
          JSON.stringify({ error: "Upstream X API temporarily rate limited. Please retry later." }),
          {
            status: 429,
            headers: {
              "content-type": "application/json",
              "retry-after": String(cooldownSeconds),
            },
          }
        );
      }
    }

    const client = getXReadOnlyClient();
    const resp = await client.v2.userByUsername(handle, {
      "user.fields": [
        "id",
        "name",
        "username",
        "verified",
        "profile_image_url",
        "public_metrics",
      ],
    });

    if (!resp || !resp.data) {
      return new Response(JSON.stringify({ error: "user not found" }), {
        status: 404,
        headers: { "content-type": "application/json", "cache-control": "private, no-store" },
      });
    }

    const body = JSON.stringify({ user: resp.data });

    if (hasRedis && redis) {
      await redis.set(cacheKey, body, { ex: 60 * 60 });
    }

    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-cache": "MISS",
        "cache-control": "public, s-maxage=3600, stale-while-revalidate=60",
      },
    });
  } catch (error: unknown) {
    if (error instanceof ApiResponseError && error.code === 429) {
      const hasRedis =
        Boolean(process.env.UPSTASH_REDIS_REST_URL) &&
        Boolean(process.env.UPSTASH_REDIS_REST_TOKEN);
      let retryAfterSeconds = 60;
      let resetIso: string | undefined;
      const reset = error.rateLimit?.reset;
      if (reset) {
        const nowSec = Math.floor(Date.now() / 1000);
        retryAfterSeconds = Math.max(1, reset - nowSec);
        resetIso = new Date(reset * 1000).toISOString();
      }
      if (hasRedis) {
        try {
          const redis = getRedis();
          await redis.set("cooldown:x:v2UserLookup", retryAfterSeconds, { ex: retryAfterSeconds });
        } catch {}
      }
      return new Response(
        JSON.stringify({ error: "X API rate limited", resetAt: resetIso }),
        {
          status: 429,
          headers: {
            "content-type": "application/json",
            "retry-after": String(retryAfterSeconds),
            "x-upstream-rate-limited": "true",
            "cache-control": "private, no-store",
          },
        }
      );
    }

    const message = error instanceof Error ? error.message : "Unexpected error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "content-type": "application/json", "cache-control": "private, no-store" },
    });
  }
}


