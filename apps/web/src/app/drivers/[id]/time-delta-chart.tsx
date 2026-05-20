"use client";

import {
  Brush,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";
import type { ProgressionPoint } from "./progression-chart";

const LEADER_COLOR = "#3b82f6";
const MEDIAN_COLOR = "#d4a017";
const ZERO_LINE_COLOR = "#dc2626";

function formatTooltipValue(value: unknown, name: unknown): [string, string] {
  const n = typeof name === "string" ? name : "";
  if (typeof value !== "number") return ["—", n];
  const sign = value >= 0 ? "+" : "";
  return [`${sign}${(value * 100).toFixed(2)}%`, n];
}

// Pad the y-axis by ~10% of range so points don't hug the chart edges.
function deltaDomain(domain: readonly [number, number]): [number, number] {
  const [min, max] = domain;
  const range = Math.max(0.005, max - min);
  const pad = range * 0.1;
  return [min - pad, max + pad];
}

// Pad the y-axis by ~10% of range so points don't hug the chart edges.
// Leader variant: clamp the lower bound to 0 because diffFromLeaderPct is
// always ≥ 0 (leader = min PAX).
function leaderDeltaDomain(domain: readonly [number, number]): [number, number] {
  const [, max] = domain;
  const padded = max * 0.1;
  return [0, max + Math.max(0.005, padded)];
}

const tickFmt = (v: number) =>
  `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;

export function TimeDeltaChart({ data }: { data: ProgressionPoint[] }) {
  const showBrush = data.length >= 4;

  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 10, right: 20, left: 10, bottom: showBrush ? 10 : 30 }}
        >
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 12 }}
            angle={-30}
            textAnchor="end"
            height={50}
            className="fill-muted-foreground"
          />
          <YAxis
            yAxisId="leader"
            orientation="left"
            reversed
            domain={leaderDeltaDomain}
            tickFormatter={tickFmt}
            tick={{ fontSize: 12, fill: LEADER_COLOR }}
            label={{
              value: "vs. leader",
              angle: -90,
              position: "insideLeft",
              style: { textAnchor: "middle", fontSize: 12, fill: LEADER_COLOR },
            }}
          />
          <YAxis
            yAxisId="median"
            orientation="right"
            reversed
            domain={deltaDomain}
            tickFormatter={tickFmt}
            tick={{ fontSize: 12, fill: MEDIAN_COLOR }}
            label={{
              value: "vs. median",
              angle: 90,
              position: "insideRight",
              style: { textAnchor: "middle", fontSize: 12, fill: MEDIAN_COLOR },
            }}
          />
          <Tooltip
            formatter={formatTooltipValue}
            contentStyle={{
              background: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 12,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <ReferenceLine
            yAxisId="median"
            y={0}
            stroke={ZERO_LINE_COLOR}
            strokeOpacity={0.4}
            strokeDasharray="4 4"
            label={{
              value: "median parity",
              position: "insideBottomRight",
              fontSize: 10,
              fill: ZERO_LINE_COLOR,
            }}
          />
          <Line
            yAxisId="leader"
            type="monotone"
            dataKey="diffFromLeaderPct"
            name="vs. event leader"
            stroke={LEADER_COLOR}
            strokeWidth={2}
            dot={{ r: 4 }}
            connectNulls
            isAnimationActive={false}
          />
          <Line
            yAxisId="median"
            type="monotone"
            dataKey="diffFromMedianPct"
            name="vs. event median"
            stroke={MEDIAN_COLOR}
            strokeWidth={2}
            dot={{ r: 4 }}
            connectNulls
            isAnimationActive={false}
          />
          {showBrush && (
            <Brush
              dataKey="label"
              height={24}
              travellerWidth={8}
              stroke={LEADER_COLOR}
              className="fill-muted"
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
