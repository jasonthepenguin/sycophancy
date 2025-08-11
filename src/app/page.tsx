"use client";

import Image from "next/image";
import { useCallback, useMemo, useState } from "react";

type Profile = {
  id: string;
  name: string;
  username: string;
  profile_image_url?: string;
};

function seededRandom(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return ((h >>> 0) % 1000) / 1000; // [0,1)
}

function randomIqFor(seed: string): number {
  // Deterministic pseudo-random IQ ~ N(100, 15)
  const u1 = Math.max(1e-9, seededRandom(seed));
  const u2 = Math.max(1e-9, seededRandom(seed + "x"));
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  const iq = 100 + 15 * z0;
  return Math.round(Math.max(55, Math.min(145, iq)));
}

export default function Home() {
  const [username, setUsername] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const iq = useMemo(() => {
    if (!profile) return null;
    return randomIqFor(profile.username.toLowerCase());
  }, [profile]);

  const onFetch = useCallback(async () => {
    const handle = username.replace(/^@/, "").trim();
    if (!handle) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/x/profile?username=${encodeURIComponent(handle)}`);
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error || "Failed to fetch profile");
      }
      setProfile(json.user);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, [username]);

  return (
    <div className="min-h-screen p-6 sm:p-10 flex flex-col items-center justify-center gap-6 -mt-8 sm:-mt-12">
      <h1 className="text-2xl sm:text-3xl font-semibold">Voids Thought Test - IQ Checker</h1>

      {/* Result preview (no chart) */}
      {profile && iq !== null && (
        <div className="w-full max-w-md rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4 flex items-center gap-3">
          {profile.profile_image_url && (
            <div className="relative h-12 w-12 rounded-full ring-2 ring-indigo-500 overflow-hidden">
              <Image
                src={profile.profile_image_url.replace("_normal", "_400x400")}
                alt={profile.username}
                fill
                sizes="48px"
                className="object-cover"
              />
            </div>
          )}
          <div className="flex-1">
            <div className="text-sm font-medium">@{profile.username}</div>
            <div className="text-sm text-gray-600 dark:text-gray-300">Random IQ: {iq}</div>
          </div>
        </div>
      )}

      {/* Input */}
      <div className="w-full max-w-md flex items-center gap-2">
        <input
          className="flex-1 rounded-md border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder="Enter X username (e.g. @jack)"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onFetch();
          }}
        />
        <button
          onClick={onFetch}
          disabled={loading || !username.trim()}
          className="rounded-md bg-indigo-600 text-white px-4 py-2 disabled:opacity-50"
        >
          {loading ? "Loading..." : "Plot"}
        </button>
      </div>

      {error && (
        <div className="text-sm text-red-600 dark:text-red-400">{error}</div>
      )}
    </div>
  );
}
