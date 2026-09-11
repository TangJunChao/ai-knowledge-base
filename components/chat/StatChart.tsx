'use client';

import { useMemo, useState } from 'react';

/** 统计问答返回的结构化分组数据（由后端 X-Stat-Data 头携带） */
export interface StatChartData {
  targetColumn: string;
  operation: 'sum' | 'avg' | 'count' | 'max' | 'min';
  total: number | null;
  groups: { key: string; value: number }[];
  filters: string[];
}

const OP_LABEL: Record<StatChartData['operation'], string> = {
  sum: '合计',
  avg: '平均',
  count: '数量',
  max: '最大值',
  min: '最小值',
};

/** 把 "2025年1月" 简化为 "25/1"，适合做坐标轴刻度 */
function shortKey(key: string): string {
  const m = key.match(/(20\d{2})年(\d{1,2})月/);
  if (m) return `${m[1].slice(2)}/${m[2]}`;
  return key.length > 8 ? key.slice(0, 8) : key;
}

/** 数字千分位格式化 */
function fmt(n: number): string {
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

const W = 720;
const H = 320;
const PAD_L = 64;
const PAD_R = 20;
const PAD_T = 28;
const PAD_B = 56;

/**
 * 统计图表：基于分组数据自绘 SVG 柱状图/折线图。
 * 零依赖，支持 hover tooltip、数值标签、图表类型切换、合计展示。
 */
export function StatChart({ data }: { data: StatChartData }) {
  const [active, setActive] = useState<number | null>(null);
  const [mode, setMode] = useState<'bar' | 'line'>('bar');

  const groups = data.groups || [];
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const n = groups.length;

  const { maxVal, gridLines } = useMemo(() => {
    const raw = Math.max(...groups.map((g) => g.value), 1);
    // 取整的刻度上限（1/2/2.5/5 × 10^k）
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    let nice = Math.ceil(raw / mag) * mag;
    if (nice / mag <= 2) nice = 2 * mag;
    else if (nice / mag <= 2.5) nice = 2.5 * mag;
    else if (nice / mag <= 5) nice = 5 * mag;
    else nice = 10 * mag;
    const lines = [0, 0.25, 0.5, 0.75, 1].map((r) => ({
      y: PAD_T + plotH - r * plotH,
      label: fmt(r * nice),
      value: r * nice,
    }));
    return { maxVal: nice, gridLines: lines };
  }, [groups, plotH]);

  const slot = plotW / Math.max(n, 1);
  const barW = Math.min(slot * 0.58, 46);
  const centerX = (i: number) => PAD_L + slot * i + slot / 2;
  const yOf = (v: number) => PAD_T + plotH - (v / maxVal) * plotH;

  const linePath = groups
    .map((g, i) => `${i === 0 ? 'M' : 'L'}${centerX(i).toFixed(1)},${yOf(g.value).toFixed(1)}`)
    .join(' ');

  const lineAreaPath = groups.length > 0
    ? `${linePath} L${centerX(n - 1).toFixed(1)},${(PAD_T + plotH).toFixed(1)} L${centerX(0).toFixed(1)},${(PAD_T + plotH).toFixed(1)} Z`
    : '';

  // 刻度标签是否足够宽（分组多时隐藏部分标签，避免重叠）
  const labelEvery = slot < 34 ? 2 : 1;

  if (n === 0) return null;

  const total = data.total;

  return (
    <div className="mt-2 rounded-xl border border-border bg-background/60 p-3">
      {/* 标题栏 */}
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <span className="text-sm font-medium">{data.targetColumn}</span>
        <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-xs font-medium">
          {OP_LABEL[data.operation]}
        </span>
        {total !== null && (
          <span className="text-xs text-muted">
            {OP_LABEL[data.operation]}总额：<span className="font-medium text-foreground">{fmt(total)}</span>
          </span>
        )}
        <div className="ml-auto flex items-center gap-0.5 rounded-lg bg-surface-hover p-0.5">
          {(['bar', 'line'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-2 py-0.5 rounded-md text-xs transition-colors ${
                mode === m ? 'bg-surface shadow-sm text-foreground' : 'text-muted hover:text-foreground'
              }`}
            >
              {m === 'bar' ? '柱状图' : '折线图'}
            </button>
          ))}
        </div>
      </div>
      {data.filters.length > 0 && (
        <div className="text-xs text-muted mb-1">{data.filters.join('，')}</div>
      )}

      {/* 图表区（相对定位，tooltip 绝对定位） */}
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-auto select-none"
          onMouseLeave={() => setActive(null)}
          role="img"
          aria-label={`${data.targetColumn}${OP_LABEL[data.operation]}图表`}
        >
          {/* 横向网格线 */}
          {gridLines.map((gl, i) => (
            <g key={i}>
              <line
                x1={PAD_L}
                x2={W - PAD_R}
                y1={gl.y}
                y2={gl.y}
                stroke="rgb(var(--border-rgb))"
                strokeWidth={1}
                strokeDasharray={i === 0 ? '0' : '4 4'}
              />
              <text
                x={PAD_L - 8}
                y={gl.y + 4}
                textAnchor="end"
                fontSize={11}
                fill="rgb(var(--muted-rgb))"
              >
                {gl.label}
              </text>
            </g>
          ))}

          {/* 数据列 */}
          {mode === 'bar' ? (
            groups.map((g, i) => {
              const h = Math.max((g.value / maxVal) * plotH, 1.5);
              const x = centerX(i) - barW / 2;
              const y = yOf(g.value);
              const isActive = active === i;
              return (
                <g key={i} onMouseEnter={() => setActive(i)}>
                  <rect
                    x={x}
                    y={y}
                    width={barW}
                    height={h}
                    rx={3}
                    fill={isActive ? 'rgb(var(--primary-hover-rgb))' : 'rgb(var(--primary-rgb))'}
                    opacity={active === null || isActive ? 0.92 : 0.45}
                    className="transition-opacity"
                  />
                  {/* 数值标签（分组多时隐藏） */}
                  {n <= 16 && (
                    <text
                      x={centerX(i)}
                      y={y - 5}
                      textAnchor="middle"
                      fontSize={10}
                      fill="rgb(var(--muted-rgb))"
                    >
                      {fmt(g.value)}
                    </text>
                  )}
                </g>
              );
            })
          ) : (
            <>
              <path d={lineAreaPath} fill="rgb(var(--primary-rgb))" opacity={0.08} />
              <path
                d={linePath}
                fill="none"
                stroke="rgb(var(--primary-rgb))"
                strokeWidth={2.5}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {groups.map((g, i) => {
                const isActive = active === i;
                return (
                  <g key={i} onMouseEnter={() => setActive(i)}>
                    <circle
                      cx={centerX(i)}
                      cy={yOf(g.value)}
                      r={isActive ? 5 : 3.5}
                      fill="rgb(var(--background-rgb))"
                      stroke="rgb(var(--primary-rgb))"
                      strokeWidth={2}
                    />
                  </g>
                );
              })}
            </>
          )}

          {/* X 轴刻度 */}
          {groups.map((g, i) =>
            i % labelEvery === 0 ? (
              <text
                key={`x-${i}`}
                x={centerX(i)}
                y={H - PAD_B + 20}
                textAnchor="middle"
                fontSize={11}
                fill="rgb(var(--muted-rgb))"
              >
                {shortKey(g.key)}
              </text>
            ) : null
          )}
        </svg>

        {/* Tooltip */}
        {active !== null && groups[active] && (
          <div
            className="pointer-events-none absolute z-10 rounded-lg border border-border bg-surface px-3 py-2 shadow-lg text-xs"
            style={{
              left: `calc(${((centerX(active) / W) * 100).toFixed(1)}% - 70px)`,
              top: 4,
              transform: active > n / 2 ? 'translateX(-90px)' : 'none',
            }}
          >
            <div className="font-medium mb-0.5">{groups[active].key}</div>
            <div>
              {data.targetColumn}：<span className="font-medium">{fmt(groups[active].value)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
