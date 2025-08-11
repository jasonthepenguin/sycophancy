import { NextRequest } from "next/server";
import { getXReadOnlyClient } from "@/lib/xClient";
import { getRedis } from "@/lib/redis";
import { getIpLimiter, getUsernameLimiter } from "@/lib/ratelimit";
import { ApiResponseError } from "twitter-api-v2";

// GET /api/x/posts?username=:handle&max_results=25
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const username = searchParams.get("username");
  const maxResultsParam = searchParams.get("max_results");

  if (!username) {
    return new Response(JSON.stringify({ error: "username is required" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const maxResults = Math.min(
    Math.max(Number(maxResultsParam ?? 25), 5),
    100
  );

  try {
    // 1) Check cache first (serve immediately if present)
    const hasRedis =
      Boolean(process.env.UPSTASH_REDIS_REST_URL) &&
      Boolean(process.env.UPSTASH_REDIS_REST_TOKEN);
    const cacheKey = `cache:xposts:${username}:${maxResults}`;
    let cached: string | null = null;
    let redis: ReturnType<typeof getRedis> | null = null;
    if (hasRedis) {
      redis = getRedis();
      cached = await redis.get<string>(cacheKey);
      if (cached) {
        return new Response(cached, {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-cache": "HIT",
          },
        });
      }
    }

    // 2) Basic per-IP rate limit (only applies to cache misses)
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "ip:unknown";
    const ipLimit = await getIpLimiter().limit(ip);
    if (!ipLimit.success) {
      return new Response(JSON.stringify({ error: "Too many requests (IP rate limit)" }), {
        status: 429,
        headers: { "content-type": "application/json" },
      });
    }

    // 3) Check upstream cooldown only on cache miss
    if (hasRedis && redis) {
      const cooldownKey = `cooldown:x:v2UserTimeline`;
      const cooldownSeconds = await redis.get<number>(cooldownKey);
      if (cooldownSeconds && cooldownSeconds > 0) {
        return new Response(
          JSON.stringify({
            error: "Upstream X API temporarily rate limited. Please retry later.",
          }),
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

    // Per-username rate limit (tighter) to avoid hammering a single handle
    const userLimit = await getUsernameLimiter().limit(username);
    if (!userLimit.success) {
      return new Response(JSON.stringify({ error: "Too many requests for this username" }), {
        status: 429,
        headers: { "content-type": "application/json" },
      });
    }
    const client = getXReadOnlyClient();

    // Lookup user by username to get user id
    const user = await client.v2.userByUsername(username, {
      "user.fields": [
        "id",
        "name",
        "username",
        "verified",
        "public_metrics",
        "profile_image_url",
      ],
    });

    if (!user || !user.data?.id) {
      return new Response(JSON.stringify({ error: "user not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }

    // Store profile image URL in Redis for 24h for reuse across the app
    if (hasRedis && redis && user.data.profile_image_url) {
      const profileUrl = user.data.profile_image_url;
      await Promise.all([
        redis.set(`user:profileImageUrl:${username}`, profileUrl, { ex: 60 * 60 * 24 }),
        redis.set(`user:profileImageUrlById:${user.data.id}`, profileUrl, { ex: 60 * 60 * 24 }),
      ]);
    }

    // Fetch recent tweets from the user timeline
    const timeline = await client.v2.userTimeline(user.data.id, {
      max_results: maxResults,
      exclude: ["replies"],
      expansions: ["attachments.media_keys", "referenced_tweets.id"],
      "tweet.fields": [
        "id",
        "text",
        "created_at",
        "public_metrics",
        "lang",
        "possibly_sensitive",
        "referenced_tweets",
      ],
      "media.fields": ["media_key", "type", "url", "preview_image_url"],
    });

    const data = {
      user: user.data,
      tweets: timeline.tweets,
      meta: timeline.meta,
      includes: timeline.includes,
    };

    const body = JSON.stringify(data);

    // Cache for 1 hour
    if (hasRedis && redis) {
      await redis.set(cacheKey, body, { ex: 60 * 60 });
    }

    return new Response(body, {
      status: 200,
      headers: { "content-type": "application/json" },
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
          await redis.set("cooldown:x:v2UserTimeline", retryAfterSeconds, {
            ex: retryAfterSeconds,
          });
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
          },
        }
      );
    }

    const message =
      error instanceof Error ? error.message : "Unexpected error fetching posts";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}


