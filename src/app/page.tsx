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

  // Chart constants and helpers
  const WIDTH = 800;
  const HEIGHT = 320;
  const MARGIN = { top: 24, right: 24, bottom: 36, left: 24 } as const;
  const baselineY = HEIGHT - MARGIN.bottom;
  const chartTopY = MARGIN.top;
  const chartHeight = baselineY - chartTopY;
  const plotWidth = WIDTH - MARGIN.left - MARGIN.right;
  const IQ_MIN = 55;
  const IQ_MAX = 145;
  const IQ_RANGE = IQ_MAX - IQ_MIN;
  const MAX_PDF = 1 / Math.sqrt(2 * Math.PI);

  function pdfAtIQ(iqValue: number): number {
    const z = (iqValue - 100) / 15;
    return Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
  }

  function xyForIQ(iqValue: number): { x: number; y: number } {
    const clamped = Math.max(IQ_MIN, Math.min(IQ_MAX, iqValue));
    const t = (clamped - IQ_MIN) / IQ_RANGE;
    const x = MARGIN.left + t * plotWidth;
    const yNorm = pdfAtIQ(clamped) / MAX_PDF;
    const y = baselineY - yNorm * chartHeight;
    return { x, y };
  }

  const curvePath = useMemo(() => {
    const n = 240;
    let d = "";
    for (let i = 0; i <= n; i += 1) {
      const t = i / n;
      const iqVal = IQ_MIN + IQ_RANGE * t;
      const { x, y } = xyForIQ(iqVal);
      d += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
    }
    return d;
  }, []);

  const ticks = useMemo(() => [55, 70, 85, 100, 115, 130, 145], []);

  const iq = useMemo(() => {
    if (!profile) return null;
    return randomIqFor(profile.username.toLowerCase());
  }, [profile]);

  const marker = useMemo(() => {
    if (iq === null || !profile) return null;
    const { x, y } = xyForIQ(iq);
    return { xPct: (x / WIDTH) * 100, yPct: (y / HEIGHT) * 100 };
  }, [iq, profile]);

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

      {/* Bell Curve Chart */}
      <div className="w-full max-w-3xl">
        <div className="relative w-full rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900">
          <div className="relative w-full" style={{ aspectRatio: `${WIDTH} / ${HEIGHT}` }}>
            <svg
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              preserveAspectRatio="none"
              className="absolute inset-0 h-full w-full"
            >
              <defs>
                <linearGradient id="curveGradient" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#6366F1" stopOpacity="0.18" />
                  <stop offset="100%" stopColor="#6366F1" stopOpacity="0.02" />
                </linearGradient>
              </defs>

              {/* Baseline */}
              <line
                x1={MARGIN.left}
                y1={baselineY}
                x2={WIDTH - MARGIN.right}
                y2={baselineY}
                stroke="currentColor"
                strokeOpacity={0.15}
              />

              {/* Ticks */}
              {ticks.map((t) => {
                const tx = MARGIN.left + ((t - IQ_MIN) / IQ_RANGE) * plotWidth;
                return (
                  <g key={t}>
                    <line
                      x1={tx}
                      y1={baselineY}
                      x2={tx}
                      y2={baselineY + 6}
                      stroke="currentColor"
                      strokeOpacity={0.25}
                    />
                    <text
                      x={tx}
                      y={baselineY + 20}
                      textAnchor="middle"
                      className="fill-gray-500 text-[18px] sm:text-[12px]"
                    >
                      {t}
                    </text>
                  </g>
                );
              })}

              {/* Mean guide at 100 */}
              <line
                x1={MARGIN.left + ((100 - IQ_MIN) / IQ_RANGE) * plotWidth}
                y1={chartTopY}
                x2={MARGIN.left + ((100 - IQ_MIN) / IQ_RANGE) * plotWidth}
                y2={baselineY}
                stroke="#6366F1"
                strokeOpacity={0.4}
                strokeDasharray="4 4"
              />

              {/* Curve area (approx) */}
              <path
                d={`${curvePath} L ${WIDTH - MARGIN.right} ${baselineY} L ${MARGIN.left} ${baselineY} Z`}
                fill="url(#curveGradient)"
                stroke="none"
              />

              {/* Curve stroke */}
              <path d={curvePath} fill="none" stroke="#6366F1" strokeWidth={2} />
            </svg>

            {/* Avatar marker overlay */}
            {marker && profile && profile.profile_image_url && (
              <div className="absolute inset-0 pointer-events-none">
                <div
                  className="absolute flex flex-col items-center"
                  style={{
                    left: `${marker.xPct}%`,
                    top: `${marker.yPct}%`,
                    transform: "translate(-50%, -50%)",
                  }}
                >
                  <div className="relative h-10 w-10 sm:h-12 sm:w-12 rounded-full ring-2 ring-indigo-600 overflow-hidden shadow-md">
                    <Image
                      src={profile.profile_image_url.replace("_normal", "_400x400")}
                      alt={profile.username}
                      fill
                      sizes="48px"
                      className="object-cover"
                    />
                  </div>
                  <div className="mt-1 text-[10px] sm:text-xs font-medium text-gray-800 dark:text-gray-100 bg-white/80 dark:bg-black/40 px-1.5 py-0.5 rounded">
                    IQ {iq}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {profile && iq !== null && (
        <div className="w-full max-w-3xl text-center mt-2">
          <p className="text-base sm:text-lg">
            <a
              href={`https://x.com/${profile.username}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-indigo-600 hover:text-indigo-700 underline underline-offset-2"
            >
              @{profile.username}
            </a>
            , Your IQ: <span className="font-semibold text-indigo-600">{iq}</span>
          </p>
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
