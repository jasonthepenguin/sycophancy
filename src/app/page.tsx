"use client";

import Image from "next/image";
import { useCallback, useMemo, useState } from "react";
import BellCurveChart from "@/components/BellCurveChart";

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

  const x = useMemo(() => (iq ? Math.max(55, Math.min(145, iq)) : 100), [iq]);
  const positionPercent = useMemo(() => ((x - 55) / (145 - 55)) * 100, [x]);

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
    <div className="min-h-screen p-6 sm:p-10 flex flex-col items-center justify-center gap-8 -mt-8 sm:-mt-12">
      <h1 className="text-2xl sm:text-3xl font-semibold">Voids Thought Test - IQ Checker</h1>

      {/* Bell curve */}
      <div className="relative w-full max-w-3xl bg-white dark:bg-zinc-900 rounded-lg border border-gray-200 dark:border-zinc-700 overflow-hidden min-h-[360px] sm:min-h-[400px] flex flex-col justify-end">
        {/* Visible curve (uPlot) */}
        <div className="w-full overflow-x-auto">
          <div className="min-w-[720px]">
            <BellCurveChart />
          </div>
        </div>

        {/* Avatar plotted */}
        {profile && iq !== null && profile.profile_image_url && (
          <div
            className="absolute bottom-7 -translate-x-1/2"
            style={{ left: `${positionPercent}%` }}
          >
            <div className="relative h-12 w-12 sm:h-14 sm:w-14 rounded-full ring-2 ring-indigo-500 overflow-hidden shadow-md">
              <Image
                src={profile.profile_image_url.replace("_normal", "_400x400")}
                alt={profile.username}
                fill
                sizes="56px"
                className="object-cover"
              />
            </div>
            <div className="mt-2 text-center text-xs text-gray-700 dark:text-gray-300">
              @{profile.username} • IQ {iq}
            </div>
          </div>
        )}
      </div>

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
