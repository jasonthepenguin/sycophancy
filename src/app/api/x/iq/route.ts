import { NextRequest } from "next/server";
import { getXReadOnlyClient } from "@/lib/xClient";
import { getRedis } from "@/lib/redis";
import { getGlobalLimiter, getIpLimiter, getUsernameLimiter } from "@/lib/ratelimit";
import { ApiResponseError } from "twitter-api-v2";
import { getOpenAIClient } from "@/lib/openai";
import { USER_CACHE_TTL_SECONDS } from "@/lib/cache";

// GET /api/x/iq?username=:handle
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const username = searchParams.get("username");

  if (!username) {
    return new Response(JSON.stringify({ error: "username is required" }), {
      status: 400,
      headers: { "content-type": "application/json", "cache-control": "private, no-store" },
    });
  }

  const handle = username.replace(/^@/, "").trim().toLowerCase();

  try {
    const hasRedis = Boolean(process.env.UPSTASH_REDIS_REST_URL) && Boolean(process.env.UPSTASH_REDIS_REST_TOKEN);
    const redis = hasRedis ? getRedis() : null;

    // Fail closed if Redis not configured (avoid operating without rate limits/caching)
    if (!hasRedis && process.env.NODE_ENV === "production") {
      return new Response(
        JSON.stringify({ error: "Service unavailable: caching and rate limits disabled" }),
        { status: 503, headers: { "content-type": "application/json", "cache-control": "private, no-store" } }
      );
    }

    // 1) Fast path: serve cached IQ for handle without any upstream or LLM calls
    if (hasRedis && redis) {
      const directKey = `cache:iq:latest:${handle}`;
      const cachedDirect = await redis.get(directKey);
      if (cachedDirect) {
        const body = typeof cachedDirect === "string" ? cachedDirect : JSON.stringify(cachedDirect);
        return new Response(body, {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-cache": "HIT",
            "cache-control": `public, s-maxage=${USER_CACHE_TTL_SECONDS}, stale-while-revalidate=300`,
          },
        });
      }
    }

    // Rate limits
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "ip:unknown";
    const [ipLimit, userLimit, globalLimit] = await Promise.all([
      getIpLimiter().limit(ip),
      getUsernameLimiter().limit(handle),
      getGlobalLimiter().limit("global"),
    ]);

    if (!ipLimit.success) {
      return new Response(JSON.stringify({ error: "Too many requests (IP rate limit)" }), {
        status: 429,
        headers: { "content-type": "application/json", "cache-control": "private, no-store" },
      });
    }
    if (!userLimit.success) {
      return new Response(JSON.stringify({ error: "Too many requests for this username" }), {
        status: 429,
        headers: { "content-type": "application/json", "cache-control": "private, no-store" },
      });
    }
    if (!globalLimit.success) {
      return new Response(JSON.stringify({ error: "Too many requests (service busy)" }), {
        status: 429,
        headers: { "content-type": "application/json", "cache-control": "private, no-store" },
      });
    }

    // Check upstream cooldown (shared with timeline usage)
    if (hasRedis && redis) {
      const cooldownKey = `cooldown:x:v2UserTimeline`;
      const cooldownSeconds = await redis.get<number>(cooldownKey);
      if (cooldownSeconds && cooldownSeconds > 0) {
        return new Response(
          JSON.stringify({ error: "Upstream X API temporarily rate limited. Please retry later." }),
          {
            status: 429,
            headers: {
              "content-type": "application/json",
              "retry-after": String(cooldownSeconds),
              "cache-control": "private, no-store",
            },
          }
        );
      }
    }

    const client = getXReadOnlyClient();

    // Lookup user id
    const user = await client.v2.userByUsername(handle, {
      "user.fields": ["id", "name", "username", "profile_image_url", "public_metrics"],
    });
    if (!user || !user.data?.id) {
      return new Response(JSON.stringify({ error: "user not found" }), {
        status: 404,
        headers: { "content-type": "application/json", "cache-control": "private, no-store" },
      });
    }

    // Get latest original tweet (exclude replies/retweets)
    const timeline = await client.v2.userTimeline(user.data.id, {
      max_results: 5,
      exclude: ["replies", "retweets"],
      expansions: ["referenced_tweets.id"],
      "tweet.fields": ["id", "text", "created_at", "lang", "public_metrics"],
    });

    const latest = timeline.tweets?.[0];
    if (!latest) {
      return new Response(JSON.stringify({ error: "no recent posts" }), {
        status: 404,
        headers: { "content-type": "application/json", "cache-control": "private, no-store" },
      });
    }

    const cacheKey = `cache:iq:${handle}:${latest.id}`;
    if (hasRedis && redis) {
      const cached = await redis.get(cacheKey);
      if (cached) {
        const body = typeof cached === "string" ? cached : JSON.stringify(cached);
        return new Response(body, {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-cache": "HIT",
            "cache-control": "public, s-maxage=21600, stale-while-revalidate=300",
          },
        });
      }
    }

    // Call OpenAI to estimate IQ from latest tweet
    const openai = getOpenAIClient();
    const system = "You are an intentionally cheeky but harmless IQ estimator. Always reply with only compact JSON.";
    const userPrompt = `Given this user's latest post, return ONLY a JSON object with two fields:\n` +
      `{"iq": <integer 55-145>, "explanation": "a single short sentence of playful justification"}.\n` +
      `Constraints:\n` +
      `- "iq" must be an integer between 55 and 145 inclusive.\n` +
      `- Keep explanation under 120 characters.\n` +
      `Latest post text (may include emojis/URLs):\n` +
      `"""${latest.text || ""}"""`;

    const chat = await openai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: userPrompt },
      ],
    });

    const rawText = (chat.choices?.[0]?.message?.content ?? "").trim();
    console.log("[LLM gpt-5-mini output]", rawText);

    let iq: number | null = null;
    let explanation: string | undefined;
    try {
      const parsed = JSON.parse(rawText);
      const candidate = Number(parsed?.iq);
      if (Number.isFinite(candidate)) {
        iq = Math.max(55, Math.min(145, Math.round(candidate)));
      }
      if (typeof parsed?.explanation === "string") {
        explanation = parsed.explanation;
      }
    } catch {
      // If not valid JSON, attempt to extract number
      const match = rawText.match(/\b(\d{2,3})\b/);
      if (match) {
        const candidate = Number(match[1]);
        if (Number.isFinite(candidate)) {
          iq = Math.max(55, Math.min(145, Math.round(candidate)));
        }
      }
    }

    if (iq === null) {
      return new Response(JSON.stringify({ error: "Failed to extract IQ from model output" }), {
        status: 502,
        headers: { "content-type": "application/json", "cache-control": "private, no-store" },
      });
    }

    const bodyObj = {
      user: { id: user.data.id, username: user.data.username },
      tweet: { id: latest.id },
      iq,
      explanation,
      llm: { text: rawText, model: "gpt-5-mini" },
    };
    const body = JSON.stringify(bodyObj);

    if (hasRedis && redis) {
      // Cache per-tweet and also a direct per-handle entry to avoid any LLM/X calls during TTL
      await Promise.all([
        redis.set(cacheKey, body, { ex: USER_CACHE_TTL_SECONDS }),
        redis.set(`cache:iq:latest:${handle}`, body, { ex: USER_CACHE_TTL_SECONDS }),
      ]);
    }

    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-cache": "MISS",
        "cache-control": `public, s-maxage=${USER_CACHE_TTL_SECONDS}, stale-while-revalidate=300`,
      },
    });
  } catch (error: unknown) {
    if (error instanceof ApiResponseError && error.code === 429) {
      const hasRedis = Boolean(process.env.UPSTASH_REDIS_REST_URL) && Boolean(process.env.UPSTASH_REDIS_REST_TOKEN);
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
          await redis.set("cooldown:x:v2UserTimeline", retryAfterSeconds, { ex: retryAfterSeconds });
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


