import { TwitterApi, type TwitterApiReadOnly } from "twitter-api-v2";

/**
 * Returns a read-only Twitter/X API client using an app-only bearer token.
 * Requires `X_BEARER_TOKEN` (preferred) or `TWITTER_BEARER_TOKEN` in the environment.
 */
export function getXReadOnlyClient(): TwitterApiReadOnly {
  const bearerToken =
    process.env.X_BEARER_TOKEN || process.env.TWITTER_BEARER_TOKEN;

  if (!bearerToken) {
    throw new Error(
      "Missing X API bearer token. Set X_BEARER_TOKEN (preferred) or TWITTER_BEARER_TOKEN in your environment."
    );
  }

  return new TwitterApi(bearerToken).readOnly;
}


