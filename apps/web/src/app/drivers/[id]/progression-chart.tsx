"use client";

import {
  Brush,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";

export type ProgressionPoint = {
  date: string;
  label: string;
  eventName: string;
  position: number | null;
  percentile: number | null;
  diffFromLeaderPct: number | null;
  diffFromMedianPct: number | null;
};

const POSITION_COLOR = "var(--chart-1)";
const PERCENTILE_COLOR = "var(--chart-4)";

function formatTooltipValue(value: unknown, name: unknown): [string, string] {
  const n = typeof name === "string" ? name : "";
  if (typeof value !== "number") return ["—", n];
  if (n === "Percentile") return [`${(value * 100).toFixed(1)}%`, n];
  return [String(value), n];
}

// Pad the position domain by ~10% of range (min 1), clamped to >= 1.
function positionDomain(domain: readonly [number, number]): [number, number] {
  const [min, max] = domain;
  const range = Math.max(1, max - min);
  const pad = Math.max(1, Math.round(range * 0.1));
  return [Math.max(1, min - pad), max + pad];
}

// Percentile is bounded [0, 1]; pad by 10% of range, clamp to bounds.
function percentileDomain(
  domain: readonly [number, number],
): [number, number] {
  const [min, max] = domain;
  const range = Math.max(0.01, max - min);
  const pad = range * 0.1;
  return [Math.max(0, min - pad), Math.min(1, max + pad)];
}

export function ProgressionChart({ data }: { data: ProgressionPoint[] }) {
  // Brush is only useful with enough points; show it when there are 4+.
  const showBrush = data.length >= 4;

  return (
    <div className="h-96 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 10, right: 20, left: 10, bottom: showBrush ? 10 : 30 }}
        >
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11 }}
            angle={-30}
            textAnchor="end"
            height={50}
            interval="preserveStartEnd"
            minTickGap={24}
            padding={{ left: 8, right: 8 }}
            className="fill-muted-foreground"
          />
          <YAxis
            yAxisId="position"
            orientation="left"
            reversed
            domain={positionDomain}
            allowDecimals={false}
            tick={{ fontSize: 12, fill: POSITION_COLOR }}
            label={{
              value: "PAX position",
              angle: -90,
              position: "insideLeft",
              style: { textAnchor: "middle", fontSize: 12, fill: POSITION_COLOR },
            }}
          />
          <YAxis
            yAxisId="percentile"
            orientation="right"
            reversed
            domain={percentileDomain}
            tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
            tick={{ fontSize: 12, fill: PERCENTILE_COLOR }}
            label={{
              value: "Percentile",
              angle: 90,
              position: "insideRight",
              style: { textAnchor: "middle", fontSize: 12, fill: PERCENTILE_COLOR },
            }}
          />
          <Tooltip
            labelFormatter={(label, payload) => {
              const p = payload?.[0]?.payload as ProgressionPoint | undefined;
              return p ? `${label} · ${p.eventName}` : label;
            }}
            formatter={formatTooltipValue}
            contentStyle={{
              background: "var(--popover)",
              color: "var(--popover-foreground)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 12,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line
            yAxisId="position"
            type="monotone"
            dataKey="position"
            name="PAX position"
            stroke={POSITION_COLOR}
            strokeWidth={2}
            dot={data.length > 10 ? false : { r: 3 }}
            activeDot={{ r: 5 }}
            connectNulls
            isAnimationActive={false}
          />
          <Line
            yAxisId="percentile"
            type="monotone"
            dataKey="percentile"
            name="Percentile"
            stroke={PERCENTILE_COLOR}
            strokeWidth={2}
            dot={data.length > 10 ? false : { r: 3 }}
            activeDot={{ r: 5 }}
            connectNulls
            isAnimationActive={false}
          />
          {showBrush && (
            <Brush
              dataKey="label"
              height={24}
              travellerWidth={8}
              stroke="var(--muted-foreground)"
              className="fill-muted"
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
