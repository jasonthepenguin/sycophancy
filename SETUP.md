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
- Docs: `README.md` updated with usage

## Environment
Create `.env.local` at the project root and set one of:

```
X_BEARER_TOKEN=your_bearer_token_here
# or
TWITTER_BEARER_TOKEN=your_bearer_token_here
```

Notes:
- No `NEXT_PUBLIC_` prefix (server-only).
- Restart dev server after changing env vars.

## Run locally
1. Install deps: `npm i`
2. Dev server: `npm run dev`
3. Test API:
   - `http://localhost:3000/api/x/posts?username=jack&max_results=10`

You should see JSON with the user and recent tweets.

## Next steps
- Add a username input on `/` to call the API and preview posts.
- Implement scoring and include scores in the response.
- Plot scores (client chart) and add caching.

## Troubleshooting
- Missing token error -> Ensure `.env.local` has `X_BEARER_TOKEN` or `TWITTER_BEARER_TOKEN`, then restart.
- 404 user not found -> Check the handle spelling/existence.
- Rate limits/errors -> Reduce `max_results` or wait and retry.
