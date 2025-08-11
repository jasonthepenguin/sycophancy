"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import type uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

function normalPdf(x: number, mean: number, stdDev: number): number {
  const a = 1 / (stdDev * Math.sqrt(2 * Math.PI));
  const z = (x - mean) / stdDev;
  return a * Math.exp(-0.5 * z * z);
}

export default function BellCurveChart() {
  const minIq = 55;
  const maxIq = 145;
  const mean = 100;
  const stdDev = 15;

  const data = useMemo(() => {
    const xs: number[] = [];
    const ys: number[] = [];
    const steps = 500;
    const peak = normalPdf(mean, mean, stdDev);
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const x = minIq + t * (maxIq - minIq);
      const y = normalPdf(x, mean, stdDev) / peak; // normalized 0..1
      xs.push(x);
      ys.push(y);
    }
    return [xs, ys] as [number[], number[]];
  }, []);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<uPlot | null>(null);
  const [width, setWidth] = useState<number>(900);
  const height = 260;

  useEffect(() => {
    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        const w = containerRef.current.clientWidth;
        if (w > 0) setWidth(w);
      }
    });
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let mounted = true;
    async function mount() {
      const UPlot = (await import("uplot")).default;
      if (!mounted || !containerRef.current) return;
      const opts: uPlot.Options = {
        width,
        height,
        padding: [16, 24, 28, 28],
        cursor: { y: false, drag: { x: false, y: false, setScale: false } },
        legend: { show: false },
        scales: { x: { time: false }, y: { range: [0, 1] } },
        axes: [
          { scale: "x", grid: { show: false }, ticks: { show: true } },
          { scale: "y", show: false },
        ],
        series: [
          {},
          { stroke: "#6366F1", width: 2, fill: "rgba(99,102,241,0.08)", points: { show: false } },
        ],
      };

      if (plotRef.current) {
        plotRef.current.setSize({ width, height });
        plotRef.current.setData(data);
      } else {
        plotRef.current = new UPlot(opts, data, containerRef.current);
      }
    }
    mount();
    return () => {
      mounted = false;
    };
  }, [data, width]);

  useEffect(() => {
    return () => {
      if (plotRef.current) {
        plotRef.current.destroy();
        plotRef.current = null;
      }
    };
  }, []);

  return <div ref={containerRef} className="w-full" />;
}


