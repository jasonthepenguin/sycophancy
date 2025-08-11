import { NextRequest } from "next/server";
import { getXReadOnlyClient } from "@/lib/xClient";

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
    const client = getXReadOnlyClient();

    // Lookup user by username to get user id
    const user = await client.v2.userByUsername(username, {
      "user.fields": ["id", "name", "username", "verified", "public_metrics"],
    });

    if (!user || !user.data?.id) {
      return new Response(JSON.stringify({ error: "user not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
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

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unexpected error fetching posts";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}


