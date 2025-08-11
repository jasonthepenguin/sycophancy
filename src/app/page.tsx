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
  const [forcedIq, setForcedIq] = useState<number | null>(null);
  const [serverIq, setServerIq] = useState<number | null>(null);
  const [isVoidMode, setIsVoidMode] = useState(false);

  // Chart constants and helpers
  const WIDTH = 800;
  const HEIGHT = 320;
  const MARGIN = { top: 24, right: 24, bottom: 36, left: 24 } as const;
  const baselineY = HEIGHT - MARGIN.bottom;
  const chartTopY = MARGIN.top;
  const chartHeight = baselineY - chartTopY;
  const plotWidth = WIDTH - MARGIN.left - MARGIN.right;
  const IQ_MIN = 55;
  const IQ_MAX = isVoidMode ? 200 : 145;
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
  }, [IQ_MIN, IQ_RANGE, plotWidth, baselineY, chartHeight, MAX_PDF, isVoidMode, xyForIQ]);

  const ticks = useMemo(() => (isVoidMode ? [55, 70, 85, 100, 115, 130, 145, 200] : [55, 70, 85, 100, 115, 130, 145]), [isVoidMode]);

  const iq = useMemo(() => {
    if (forcedIq !== null) return forcedIq;
    if (serverIq !== null) return serverIq;
    return null;
  }, [forcedIq, serverIq]);

  const marker = useMemo(() => {
    if (iq === null || !profile) return null;
    const { x, y } = xyForIQ(iq);
    return { xPct: (x / WIDTH) * 100, yPct: (y / HEIGHT) * 100 };
  }, [iq, profile, xyForIQ]);

  const onFetch = useCallback(async () => {
    const handle = username.replace(/^@/, "").trim();
    if (!handle) return;
    setLoading(true);
    setError(null);
    try {
      // Special-case: @voids_thoughts → skip API, use local image and IQ 200
      if (handle.toLowerCase() === "voids_thoughts") {
        setIsVoidMode(true);
        setForcedIq(200);
        setServerIq(null);
        setProfile({
          id: "void",
          name: "Void",
          username: "voids_thoughts",
          profile_image_url: "/void.jpg",
        });
        return;
      } else {
        setIsVoidMode(false);
        setForcedIq(null);
        setServerIq(null);
      }

      // Single call: IQ returns the user info too and hydrates profile cache
      try {
        const iqRes = await fetch(`/api/x/iq?username=${encodeURIComponent(handle)}`);
        const iqJson = await iqRes.json();
        if (iqRes.ok) {
          if (iqJson?.user) setProfile(iqJson.user);
          if (typeof iqJson?.iq === "number") setServerIq(iqJson.iq);
        } else {
          if (iqJson?.error) setError(iqJson.error);
        }
      } catch {
        // Ignore, UI will wait for valid IQ
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setProfile(null);
      setServerIq(null);
    } finally {
      setLoading(false);
    }
  }, [username]);

  return (
    <div className={`relative z-10 min-h-screen p-6 sm:p-10 flex flex-col items-center justify-center gap-6 -mt-8 sm:-mt-12 ${isVoidMode ? "void-holy" : ""}` }>
      <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-indigo-300 via-fuchsia-300 to-cyan-300 drop-shadow-[0_0_12px_rgba(99,102,241,0.35)]">
        Voids Thought Test
      </h1>
      <div className="mt-1 text-white">
        <span className="text-sm sm:text-base">Check the IQ score of any X user.</span>
      </div>

      {isVoidMode && (
        <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
          {Array.from({ length: 24 }).map((_, i) => {
            const t = i / 24;
            const left = Math.round(((Math.sin(12.9898 * (i + 1)) * 43758.5453) % 1 + 1) % 1 * 100);
            const top = Math.round(((Math.sin(78.233 * (i + 5)) * 12345.678) % 1 + 1) % 1 * 100);
            const delay = (i % 12) * 0.2;
            const size = 18 + ((i * 13) % 18);
            return (
              <span
                key={i}
                className="absolute select-none text-indigo-200/70 swirl-item"
                style={{ left: `${left}%`, top: `${top}%`, animationDelay: `${delay}s`, fontSize: `${size}px` }}
              >
                🌀
              </span>
            );
          })}
        </div>
      )}

      {/* Bell Curve Chart */}
      <div className="w-full max-w-3xl">
        <div className="relative w-full rounded-xl border border-indigo-500/20 bg-white/5 backdrop-blur-md shadow-[0_0_0_1px_rgba(99,102,241,0.08),0_20px_60px_-15px_rgba(0,0,0,0.6)]">
          <div className="relative w-full" style={{ aspectRatio: `${WIDTH} / ${HEIGHT}` }}>
            <svg
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              preserveAspectRatio="none"
              className="absolute inset-0 h-full w-full text-indigo-200/60"
            >
              <defs>
                <linearGradient id="curveGradient" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.05" />
                </linearGradient>
                <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="2.5" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {/* Baseline */}
              <line
                x1={MARGIN.left}
                y1={baselineY}
                x2={WIDTH - MARGIN.right}
                y2={baselineY}
                stroke="currentColor"
                strokeOpacity={0.2}
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
                      strokeOpacity={0.3}
                    />
                    <text
                      x={tx}
                      y={baselineY + 20}
                      textAnchor="middle"
                       className="fill-indigo-200/80 text-[24px] sm:text-[18px]"
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
                stroke="#818cf8"
                strokeOpacity={0.6}
                strokeDasharray="4 4"
              />

              {/* Curve area (approx) */}
              <path
                d={`${curvePath} L ${WIDTH - MARGIN.right} ${baselineY} L ${MARGIN.left} ${baselineY} Z`}
                fill="url(#curveGradient)"
                stroke="none"
              />

              {/* Curve stroke */}
              <path d={curvePath} fill="none" stroke="#a78bfa" strokeWidth={2} filter="url(#glow)" />
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
                  <div className={`relative h-10 w-10 sm:h-12 sm:w-12 rounded-full ring-2 ring-fuchsia-400/70 overflow-hidden shadow-[0_0_20px_rgba(232,121,249,0.35)] ${isVoidMode ? "void-fire" : ""}`}>
                    <Image
                      src={profile.profile_image_url.replace("_normal", "_400x400")}
                      alt={profile.username}
                      fill
                      sizes="48px"
                      className="object-cover"
                    />
                  </div>
                  <div className="mt-1 text-[10px] sm:text-xs font-medium text-cyan-100 bg-black/50 backdrop-blur px-1.5 py-0.5 rounded border border-cyan-300/20 shadow-[0_0_16px_rgba(34,211,238,0.25)]">
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
          <p className="text-base sm:text-lg text-indigo-100/90">
            <a
              href={`https://x.com/${profile.username}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-fuchsia-300 hover:text-fuchsia-200 underline underline-offset-2"
            >
              @{profile.username}
            </a>
            , Your IQ: <span className="font-semibold text-cyan-300">{iq}</span>
          </p>
        </div>
      )}

      {/* Input */}
      <div className="w-full max-w-md flex flex-col gap-2">
        <div className="flex items-center gap-2">
        <input
          className="flex-1 rounded-md border border-indigo-500/20 bg-white/5 text-indigo-50 placeholder:text-indigo-200/40 px-3 py-2 outline-none backdrop-blur focus:ring-2 focus:ring-fuchsia-400/50 focus:border-fuchsia-400/40"
          placeholder="Enter X username (e.g. @sama)"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onFetch();
          }}
        />
          <button
            onClick={onFetch}
            disabled={loading || !username.trim()}
            className={`rounded-md bg-gradient-to-r from-fuchsia-500 via-indigo-600 to-cyan-500 text-white px-4 py-2 shadow-[0_10px_30px_-10px_rgba(99,102,241,0.8)] hover:brightness-110 transition ${!username.trim() ? "opacity-50 grayscale cursor-not-allowed" : ""}`}
          >
            {loading ? (
              <span className="emoji-spin align-middle glow-cyan text-cyan-300">🌀</span>
            ) : (
              "Plot"
            )}
          </button>
        </div>
        {loading && (
          <div className="text-sm text-cyan-200 glow-cyan pl-1">Loading...</div>
        )}
      </div>

      {error && (
        <div className="text-sm text-rose-300">{error}</div>
      )}
    </div>
  );
}
