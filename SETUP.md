# Sycophancy - Setup Summary

## Overview
- Goal: Enter an X (Twitter) username and plot an IQ score based on posts.
- Current state: Server route wired to fetch recent posts by username via X API.

## Implemented
- X SDK: `twitter-api-v2`
- Helper: `src/lib/xClient.ts` with `getXReadOnlyClient()` (bearer token auth)
- API route: `src/app/api/x/posts/route.ts`
  - GET `/api/x/posts?username=:handle&max_results=25`
  - Resolves username -> user id, fetches recent tweets (excludes replies)
  - Returns `{ user, tweets, meta, includes }`
- Redis + Rate limiting:
  - `src/lib/redis.ts` (Upstash Redis client)
  - `src/lib/ratelimit.ts` (per-IP and per-username sliding window)
  - Cache-first behavior (1h TTL per username+max_results)
  - Upstream 429 cooldown with `retry-after` and `resetAt`
- Docs: `README.md` updated with usage

## Environment
Create `.env.local` at the project root and set:

```
X_BEARER_TOKEN=your_bearer_token_here
# or TWITTER_BEARER_TOKEN=your_bearer_token_here

# Upstash Redis (for rate limits + caching)
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

Notes:
- No `NEXT_PUBLIC_` prefix (server-only).
- Restart dev server after changing env vars.

## Run locally
1. Install deps: `npm i`
2. Dev server: `npm run dev`
3. Test API:
   - `http://localhost:3000/api/x/posts?username=jack&max_results=10`
   - On first success, subsequent calls within 1h return cache with header `x-cache: HIT`
   - If X is rate-limiting, response is 429 with headers `retry-after` and `x-upstream-rate-limited: true`, and JSON `{ error, resetAt }`

You should see JSON with the user and recent tweets.

## Next steps
- Add a username input on `/` to call the API and preview posts.
- Implement scoring and include scores in the response.
- Plot scores (client chart) and refine caching (e.g., cache key normalization, stale-while-revalidate).

## Troubleshooting
- Missing token error -> Ensure `.env.local` has `X_BEARER_TOKEN` or `TWITTER_BEARER_TOKEN`, then restart.
- Redis missing -> Ensure `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are set. Without them, app runs but rate limiting/caching are disabled.
- 404 user not found -> Check the handle spelling/existence.
- 429 from upstream -> Observe `retry-after` and `resetAt`, try another handle, or wait and retry.
