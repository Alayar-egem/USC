import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchAnalyticsSummary,
  type AnalyticsAssistantResponse,
  type AnalyticsSummary,
} from "../api/analytics";
import TopHeader from "../ui/TopHeader";

type SeriesPoint = { label: string; value: number };
type MonthPoint = { month: string; label: string; value: number };
type LineChartPoint = { month: string; x: number; y: number; label: string; value: number };
type LineChartTick = { y: number; value: number };
type LineChartModel = {
  path: string;
  areaPath: string;
  points: LineChartPoint[];
  yTicks: LineChartTick[];
  width: number;
  height: number;
};
type ForecastScenarioPoint = { label: string; base: number; best: number; worst: number };
type AssistantMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: number;
  data?: AnalyticsAssistantResponse;
};
type AssistantDragState = {
  mode: "move" | "resize";
  startY: number;
  startBottom: number;
  startHeight: number;
};
function linearRegression(points: SeriesPoint[]) {
  const n = points.length;
  const xs = points.map((_, i) => i + 1);
  const ys = points.map((p) => p.value);
  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = ys.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((a, b, i) => a + b * ys[i], 0);
  const sumX2 = xs.reduce((a, b) => a + b * b, 0);
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX || 1);
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

function forecast(points: SeriesPoint[], months: number) {
  const { slope, intercept } = linearRegression(points);
  const out: SeriesPoint[] = [];
  for (let i = 1; i <= months; i += 1) {
    const x = points.length + i;
    const value = Math.max(0, Math.round(intercept + slope * x));
    out.push({ label: `M+${i}`, value });
  }
  return out;
}

function formatK(num: number) {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
  return String(Math.round(num));
}

function parseMonthLabel(raw: string): string {
  if (!raw) return "";
  const parts = raw.split("-");
  if (parts.length < 2) return raw;
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return raw;
  const fmt = new Intl.DateTimeFormat("ru-RU", { month: "short" });
  const label = fmt.format(new Date(y, m - 1, 1));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function statusLabel(status: string): string {
  const up = (status || "").toUpperCase();
  switch (up) {
    case "PENDING":
    case "CREATED":
      return "Новые";
    case "CONFIRMED":
      return "Подтверждены";
    case "DELIVERING":
      return "В пути";
    case "DELIVERED":
      return "Доставлены";
    case "CANCELLED":
    case "CANCELED":
      return "Отменены";
    default:
      return status;
  }
}

function calcDeltaPct(points: MonthPoint[], index: number): number | null {
  if (index <= 0 || index >= points.length) return null;
  const prev = points[index - 1].value;
  const cur = points[index].value;
  if (prev <= 0) return null;
  return ((cur - prev) / prev) * 100;
}

function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / power;
  if (fraction <= 1) return 1 * power;
  if (fraction <= 2) return 2 * power;
  if (fraction <= 2.5) return 2.5 * power;
  if (fraction <= 7) return 5 * power;
  return 10 * power;
}

function buildTemplateYAxis(maxValue: number) {
  const clampedMax = Math.max(1, maxValue);
  const targetIntervals = 5;
  const step = niceStep(clampedMax / targetIntervals);
  const top = Math.ceil(clampedMax / step) * step;
  const intervals = Math.max(2, Math.round(top / step));
  const values = Array.from({ length: intervals + 1 }, (_, i) => i * step);
  return { top, values };
}

function buildLineChart(points: MonthPoint[]): LineChartModel | null {
  if (points.length < 2) return null;
  const width = 320;
  const height = 132;
  const padLeft = 8;
  const padRight = 10;
  const padYTop = 14;
  const padYBottom = 18;
  const chartW = width - padLeft - padRight;
  const chartH = height - padYTop - padYBottom;
  const dataMax = Math.max(...points.map((p) => p.value), 1);
  const { top: yMax, values: yValues } = buildTemplateYAxis(dataMax);
  const min = 0;
  const range = Math.max(1, yMax - min);

  const mapped: LineChartPoint[] = points.map((p, i) => {
    const x = padLeft + (i / (points.length - 1)) * chartW;
    const y = padYTop + (1 - (p.value - min) / range) * chartH;
    return { month: p.month, x, y, label: p.label, value: p.value };
  });

  const path = mapped.map((pt, idx) => `${idx === 0 ? "M" : "L"} ${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`).join(" ");
  const first = mapped[0];
  const last = mapped[mapped.length - 1];
  const areaPath = `${path} L ${last.x.toFixed(2)} ${(height - padYBottom).toFixed(2)} L ${first.x.toFixed(2)} ${(height - padYBottom).toFixed(2)} Z`;
  const yTicks: LineChartTick[] = yValues.map((value) => {
    const ratio = value / range;
    const y = padYTop + (1 - ratio) * chartH;
    return { y, value };
  });
  return { path, areaPath, points: mapped, yTicks, width, height };
}

function getPointDelta(points: MonthPoint[], month: string): number | null {
  const idx = points.findIndex((p) => p.month === month);
  return calcDeltaPct(points, idx);
}

function avg(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = avg(values);
  const variance = avg(values.map((v) => (v - m) ** 2));
  return Math.sqrt(variance);
}

function buildScenarioForecast(points: SeriesPoint[], months: number): ForecastScenarioPoint[] {
  if (points.length < 3) return [];
  const base = forecast(points, months);
  const changes = points.slice(1).map((p, i) => {
    const prev = points[i].value;
    if (prev <= 0) return 0;
    return (p.value - prev) / prev;
  });
  const volatility = stddev(changes);
  const drift = avg(changes);
  const hasZeroHistory = points.some((p) => p.value <= 0);
  const severeCrashHistory = changes.some((c) => c <= -0.95);
  const allowZeroWorst = hasZeroHistory || severeCrashHistory;

  const rawUpFactor = Math.max(0.04, volatility * 1.1 + Math.max(0, drift * 0.35));
  const rawDownFactor = Math.max(0.05, volatility * 1.25 + Math.max(0, -drift * 0.35));

  // Keep scenarios realistic for UI/readability unless history shows near-zero behavior.
  const upFactor = clamp(rawUpFactor, 0.04, 0.65);
  const downFactor = clamp(rawDownFactor, 0.05, allowZeroWorst ? 0.98 : 0.85);

  return base.map((p) => ({
    label: p.label,
    base: p.value,
    best: Math.round(p.value * (1 + upFactor)),
    worst: allowZeroWorst
      ? Math.max(0, Math.round(p.value * (1 - downFactor)))
      : Math.max(Math.round(p.value * 0.15), Math.round(p.value * (1 - downFactor))),
  }));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function elasticBound(value: number, min: number, max: number, resistance = 0.34): number {
  if (value < min) return min - (min - value) * resistance;
  if (value > max) return max + (value - max) * resistance;
  return value;
}

export default function AnalyticsScreen({
  active,
  cartCount,
  onBurger,
  role,
  companyId,
  showCompanyBanner = false,
  onPickCompany,
}: {
  active: boolean;
  cartCount: number;
  onBurger: () => void;
  role?: string | null;
  companyId?: number | null;
  showCompanyBanner?: boolean;
  onPickCompany?: () => void;
}) {
  const isSupplier = role?.toLowerCase() === "supplier";
  const analyticsRole = isSupplier ? "supplier" : "buyer";

  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [marketLineMonth, setMarketLineMonth] = useState<string | null>(null);
  const [salesLineMonth, setSalesLineMonth] = useState<string | null>(null);
  const [assistantOpen] = useState(false);
  const [assistantLoading] = useState(false);
  const [assistantMessages, setAssistantMessages] = useState<AssistantMessage[]>([]);
  const assistantHistoryRef = useRef<HTMLDivElement | null>(null);
  const [assistantPanelBottom, setAssistantPanelBottom] = useState(156);
  const [assistantPanelHeight, setAssistantPanelHeight] = useState(340);
  const [assistantDragging, setAssistantDragging] = useState(false);
  const assistantDragRef = useRef<AssistantDragState | null>(null);
  const getBottomBounds = (viewportH: number, panelHeight: number) => {
    const minBottom = 8;
    // keep at least a visible top strip; don't allow panel to stick too high
    const maxBottom = Math.max(120, viewportH - panelHeight - 18);
    return { minBottom, maxBottom };
  };
  const getHeightBounds = (viewportH: number, bottom: number) => {
    const minHeight = 200;
    const maxHeight = Math.max(260, viewportH - bottom + 68);
    return { minHeight, maxHeight };
  };

  useEffect(() => {
    if (!active || !companyId) return;
    let alive = true;
    setData(null);

    fetchAnalyticsSummary({ companyId, role: analyticsRole, days: 365 })
      .then((res) => {
        if (!alive) return;
        setData(res);
      })
      .catch(() => {
        if (!alive) return;
        setData(null);
      });

    return () => {
      alive = false;
    };
  }, [active, companyId, analyticsRole]);

  const marketSeries = useMemo<MonthPoint[]>(() => {
    if (!data?.market_trends?.length) return [];
    return data.market_trends.map((x) => ({
      month: x.month,
      label: parseMonthLabel(x.month),
      value: Math.round(x.revenue ?? 0),
    }));
  }, [data]);

  const salesSeries = useMemo<MonthPoint[]>(() => {
    if (!data?.sales_trends?.length) return [];
    return data.sales_trends.map((x) => ({
      month: x.month,
      label: parseMonthLabel(x.month),
      value: Math.round(x.revenue ?? 0),
    }));
  }, [data]);

  const marketSeriesView = marketSeries.slice(-6);
  const salesSeriesView = salesSeries.slice(-6);
  const marketMax = Math.max(...marketSeriesView.map((x) => x.value), 1);
  const salesMax = Math.max(...salesSeriesView.map((x) => x.value), 1);

  useEffect(() => {
    if (!marketSeriesView.length) return;
    if (!marketLineMonth || !marketSeriesView.some((x) => x.month === marketLineMonth)) {
      setMarketLineMonth(marketSeriesView[marketSeriesView.length - 1].month);
    }
  }, [marketSeriesView, marketLineMonth]);

  useEffect(() => {
    if (!salesSeriesView.length) return;
    if (!salesLineMonth || !salesSeriesView.some((x) => x.month === salesLineMonth)) {
      setSalesLineMonth(salesSeriesView[salesSeriesView.length - 1].month);
    }
  }, [salesSeriesView, salesLineMonth]);

  const forecastSeries = useMemo(() => {
    const plain = salesSeries.map((x) => ({ label: x.label, value: x.value }));
    if (plain.length < 2) return [];
    return forecast(plain, 3);
  }, [salesSeries]);
  const forecastScenario = useMemo(() => {
    const plain = salesSeries.map((x) => ({ label: x.label, value: x.value }));
    return buildScenarioForecast(plain, 3);
  }, [salesSeries]);

  const marketLineChart = useMemo(() => buildLineChart(marketSeriesView), [marketSeriesView]);
  const salesLineChart = useMemo(() => buildLineChart(salesSeriesView), [salesSeriesView]);

  const marketLinePoint = marketLineChart?.points.find((p) => p.month === marketLineMonth) ?? null;
  const salesLinePoint = salesLineChart?.points.find((p) => p.month === salesLineMonth) ?? null;
  const marketYAxis = marketLineChart ? [...marketLineChart.yTicks].sort((a, b) => a.y - b.y) : [];
  const salesYAxis = salesLineChart ? [...salesLineChart.yTicks].sort((a, b) => a.y - b.y) : [];
  const marketLineIndex = marketLineMonth ? marketSeriesView.findIndex((p) => p.month === marketLineMonth) : -1;
  const salesLineIndex = salesLineMonth ? salesSeriesView.findIndex((p) => p.month === salesLineMonth) : -1;
  const marketLineDelta = marketLineMonth ? getPointDelta(marketSeriesView, marketLineMonth) : null;
  const salesLineDelta = salesLineMonth ? getPointDelta(salesSeriesView, salesLineMonth) : null;
  const marketLinePeak = marketLinePoint ? Math.round((marketLinePoint.value / marketMax) * 100) : 0;
  const salesLinePeak = salesLinePoint ? Math.round((salesLinePoint.value / salesMax) * 100) : 0;

  const avgCheck = data && data.total_orders > 0 ? Math.round(data.total_revenue / data.total_orders) : 0;
  const topCategories = (data?.category_breakdown ?? []).slice(0, 6);
  const funnelRows = (data?.status_funnel ?? []).filter((x) => x.count > 0);
  const insights = data?.insights ?? [];
  const buyerRecommendations = data?.buyer_recommendations;
  const cheaperAlternatives = buyerRecommendations?.cheaper_alternatives ?? [];
  const reliableSuppliers = buyerRecommendations?.reliable_suppliers ?? [];
  const salesValues = salesSeries.map((x) => x.value);
  const recent3 = salesSeries.slice(-3).map((x) => x.value);
  const volatilityPct = avg(salesValues) > 0 ? (stddev(salesValues) / avg(salesValues)) * 100 : 0;
  const runRate = Math.round(avg(recent3));
  const topMonth = salesSeries.reduce<MonthPoint | null>((max, cur) => (!max || cur.value > max.value ? cur : max), null);
  const lowMonth = salesSeries.reduce<MonthPoint | null>((min, cur) => (!min || cur.value < min.value ? cur : min), null);
  const seasonalityIndex = topMonth && lowMonth && lowMonth.value > 0 ? topMonth.value / lowMonth.value : 1;

  const funnelTotal = funnelRows.reduce((sum, row) => sum + row.count, 0);
  const deliveredCount = funnelRows
    .filter((x) => String(x.status).toUpperCase() === "DELIVERED")
    .reduce((sum, row) => sum + row.count, 0);
  const cancelledCount = funnelRows
    .filter((x) => {
      const s = String(x.status).toUpperCase();
      return s === "CANCELLED" || s === "CANCELED";
    })
    .reduce((sum, row) => sum + row.count, 0);
  const pipelineCount = funnelRows
    .filter((x) => {
      const s = String(x.status).toUpperCase();
      return s === "PENDING" || s === "CREATED" || s === "CONFIRMED" || s === "DELIVERING";
    })
    .reduce((sum, row) => sum + row.count, 0);

  const deliveryRate = funnelTotal > 0 ? (deliveredCount / funnelTotal) * 100 : 0;
  const cancellationRate = funnelTotal > 0 ? (cancelledCount / funnelTotal) * 100 : 0;
  const pipelineRate = funnelTotal > 0 ? (pipelineCount / funnelTotal) * 100 : 0;
  const modelSignals: string[] = [];
  if (volatilityPct >= 35) modelSignals.push(`Высокая волатильность спроса (${volatilityPct.toFixed(1)}%). Нужен запас на пики.`);
  if (cancellationRate >= 10) modelSignals.push(`Отмены ${cancellationRate.toFixed(1)}% — проверь SLA и подтверждение заказа.`);
  if (salesLineDelta != null && salesLineDelta <= -12) {
    modelSignals.push(`Сильный спад MoM (${salesLineDelta.toFixed(1)}%). Нужна промо-активация.`);
  }
  if (pipelineRate >= 30) modelSignals.push(`Большой объём в работе (${pipelineRate.toFixed(1)}%). Контролируй время подтверждения.`);
  if (seasonalityIndex >= 1.8 && topMonth && lowMonth) {
    modelSignals.push(`Сезонность заметна: ${topMonth.label} vs ${lowMonth.label}, индекс ${seasonalityIndex.toFixed(2)}.`);
  }
  if (!modelSignals.length) modelSignals.push("Сигналы риска низкие, динамика стабильная.");
  const showAnalyticsSkeleton = !showCompanyBanner && !data;

  const assistantStorageKey = useMemo(
    () => (companyId ? `usc.analytics.chat.${companyId}.${analyticsRole}` : null),
    [companyId, analyticsRole]
  );

  useEffect(() => {
    if (!assistantStorageKey) {
      setAssistantMessages([]);
      return;
    }
    try {
      const raw = localStorage.getItem(assistantStorageKey);
      if (!raw) {
        setAssistantMessages([]);
        return;
      }
      const parsed = JSON.parse(raw) as AssistantMessage[];
      if (Array.isArray(parsed)) setAssistantMessages(parsed.slice(-40));
      else setAssistantMessages([]);
    } catch {
      setAssistantMessages([]);
    }
  }, [assistantStorageKey]);

  useEffect(() => {
    if (!assistantStorageKey) return;
    try {
      localStorage.setItem(assistantStorageKey, JSON.stringify(assistantMessages.slice(-40)));
    } catch {
      // ignore localStorage quota/private mode issues
    }
  }, [assistantStorageKey, assistantMessages]);

  useEffect(() => {
    if (!assistantOpen) return;
    if (assistantDragging) return;
    const onResize = () => {
      const h = window.innerHeight || 800;
      const { minBottom, maxBottom } = getBottomBounds(h, assistantPanelHeight);
      const nextBottom = clamp(assistantPanelBottom, minBottom, maxBottom);
      const { minHeight, maxHeight } = getHeightBounds(h, nextBottom);
      const nextHeight = clamp(assistantPanelHeight, minHeight, maxHeight);
      setAssistantPanelBottom(nextBottom);
      setAssistantPanelHeight(nextHeight);
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [assistantOpen, assistantDragging]);

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      const st = assistantDragRef.current;
      if (!st) return;
      const dy = e.clientY - st.startY;
      const viewportH = window.innerHeight || 800;
      if (st.mode === "move") {
        const next = st.startBottom - dy;
        // While user drags, allow going out of bounds.
        // Bounds are enforced only on release for a smooth snap-back.
        setAssistantPanelBottom(next);
        return;
      }
      const { minHeight, maxHeight } = getHeightBounds(viewportH, st.startBottom);
      const next = st.startHeight - dy;
      setAssistantPanelHeight(elasticBound(next, minHeight, maxHeight));
    };
    const onPointerUp = () => {
      const st = assistantDragRef.current;
      if (!st) return;
      assistantDragRef.current = null;
      setAssistantDragging(false);
      const viewportH = window.innerHeight || 800;
      const { minBottom, maxBottom } = getBottomBounds(viewportH, st.startHeight);
      setAssistantPanelBottom((prevBottom) => {
        const boundedBottom = clamp(prevBottom, minBottom, maxBottom);
        const { minHeight, maxHeight } = getHeightBounds(viewportH, boundedBottom);
        if (st.mode === "resize") {
          const snaps = [240, 320, 420, maxHeight].filter((v, i, arr) => arr.indexOf(v) === i);
          setAssistantPanelHeight((prevHeight) => {
            const bounded = clamp(prevHeight, minHeight, maxHeight);
            return snaps.reduce((closest, cur) => (Math.abs(cur - bounded) < Math.abs(closest - bounded) ? cur : closest), snaps[0]);
          });
        } else {
          setAssistantPanelHeight((prevHeight) => clamp(prevHeight, minHeight, maxHeight));
        }
        return boundedBottom;
      });
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, []);
  useEffect(() => {
    if (!assistantOpen) return;
    const el = assistantHistoryRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [assistantMessages, assistantLoading, assistantOpen]);

  return (
    <section id="screen-analytics" className={`screen ${active ? "active" : ""}`}>
      <TopHeader onBurger={onBurger} badgeCount={cartCount} />
      <header className="simple-header">
        <div className="simple-title">Аналитика</div>
      </header>

      {showCompanyBanner ? (
        <div className="company-banner">
          <div>
            <div className="company-banner-title">Добавьте компанию</div>
            <div className="company-banner-text">Полная аналитика доступна после выбора компании.</div>
          </div>
          <button className="company-banner-btn" type="button" onClick={onPickCompany}>
            Выбрать
          </button>
        </div>
      ) : null}

      {showAnalyticsSkeleton ? (
        <div className="analytics-grid analytics-grid-skeleton">
          <div className="analytic-card">
            <div className="analytic-title">Рынок</div>
            <div className="analytic-row">
              <div className="analytic-metric skeleton analytics-skel-metric" />
              <div className="analytic-metric skeleton analytics-skel-metric" />
              <div className="analytic-metric skeleton analytics-skel-metric" />
            </div>
            <div className="skeleton analytics-skel-chart" />
            <div className="skeleton analytics-skel-axis" />
            <div className="skeleton analytics-skel-detail" />
          </div>

          <div className="analytic-card">
            <div className="analytic-title">{isSupplier ? "Продажи поставщика" : "Покупки компании"}</div>
            <div className="analytic-row">
              <div className="analytic-metric skeleton analytics-skel-metric" />
              <div className="analytic-metric skeleton analytics-skel-metric" />
              <div className="analytic-metric skeleton analytics-skel-metric" />
            </div>
            <div className="skeleton analytics-skel-chart" />
            <div className="skeleton analytics-skel-axis" />
            <div className="skeleton analytics-skel-detail" />
          </div>

          <div className="analytic-card">
            <div className="analytic-title">Прогноз продаж (регрессия)</div>
            <div className="forecast-row">
              <div className="forecast-pill skeleton analytics-skel-pill" />
              <div className="forecast-pill skeleton analytics-skel-pill" />
              <div className="forecast-pill skeleton analytics-skel-pill" />
            </div>
          </div>

          <div className="analytic-card">
            <div className="analytic-title">Сценарный прогноз</div>
            <div className="scenario-grid">
              <div className="scenario-item skeleton analytics-skel-scenario" />
              <div className="scenario-item skeleton analytics-skel-scenario" />
              <div className="scenario-item skeleton analytics-skel-scenario" />
            </div>
          </div>

          <div className="analytic-card">
            <div className="analytic-title">Операционное здоровье</div>
            <div className="kpi-grid">
              <div className="kpi-item skeleton analytics-skel-kpi" />
              <div className="kpi-item skeleton analytics-skel-kpi" />
              <div className="kpi-item skeleton analytics-skel-kpi" />
              <div className="kpi-item skeleton analytics-skel-kpi" />
              <div className="kpi-item skeleton analytics-skel-kpi" />
              <div className="kpi-item skeleton analytics-skel-kpi" />
            </div>
          </div>

          <div className="analytic-card">
            <div className="analytic-title">Категории</div>
            <div className="skeleton analytics-skel-list" />
          </div>

          <div className="analytic-card">
            <div className="analytic-title">Воронка статусов</div>
            <div className="skeleton analytics-skel-list" />
          </div>

          <div className="analytic-card">
            <div className="analytic-title">Выводы и рекомендации</div>
            <div className="skeleton analytics-skel-text" />
          </div>

          <div className="analytic-card">
            <div className="analytic-title">Сигналы модели</div>
            <div className="skeleton analytics-skel-text" />
          </div>
        </div>
      ) : (
      <div className="analytics-grid">
        <div className="analytic-card">
          <div className="analytic-title">Рынок</div>
          <div className="analytic-row">
            <div className="analytic-metric">
              <div className="metric-label">Выручка платформы</div>
              <div className="metric-value">{formatK(data?.market?.platform_revenue ?? 0)}</div>
            </div>
            <div className="analytic-metric">
              <div className="metric-label">Заказы платформы</div>
              <div className="metric-value">{data?.market?.platform_orders ?? 0}</div>
            </div>
            <div className="analytic-metric">
              <div className="metric-label">Доля компании</div>
              <div className="metric-value">{`${(data?.market?.company_share_pct ?? 0).toFixed(1)}%`}</div>
            </div>
          </div>

          {marketLineChart ? (
            <div className="analytics-line-block">
              <div className="analytics-line-head">
                <div className="analytics-line-caption">Динамика рынка по месяцам</div>
                <div className="analytics-line-value-chip">{`${formatK(marketSeriesView[marketSeriesView.length - 1]?.value ?? 0)} сейчас`}</div>
              </div>
              <div className="analytics-line-plot">
                <div className="analytics-line-y-axis">
                  {marketYAxis.map((tick, idx) => (
                    <span key={`market-y-${idx}`} className="analytics-line-y-axis-label" style={{ top: `${(tick.y / marketLineChart.height) * 100}%` }}>
                      {formatK(tick.value)}
                    </span>
                  ))}
                </div>
                <div className="analytics-line-chart market">
                  <svg viewBox={`0 0 ${marketLineChart.width} ${marketLineChart.height}`} preserveAspectRatio="none" aria-hidden="true">
                    {marketLineChart.yTicks.map((tick, idx) => (
                      <line
                        key={`market-grid-${idx}`}
                        x1={marketLineChart.points[0]?.x ?? 0}
                        y1={tick.y}
                        x2={marketLineChart.points[marketLineChart.points.length - 1]?.x ?? marketLineChart.width}
                        y2={tick.y}
                        className="analytics-line-grid"
                      />
                    ))}
                    <path d={marketLineChart.areaPath} className="analytics-line-area market" />
                    <path d={marketLineChart.path} className="analytics-line-stroke market" />
                    {marketLineChart.points.map((pt) => (
                      <g key={`${pt.label}-${pt.x}`} className={`analytics-line-point ${pt.month === marketLineMonth ? "active" : ""}`}>
                        {pt.month === marketLineMonth ? <circle cx={pt.x} cy={pt.y} r="9" className="analytics-line-dot-active-ring market" /> : null}
                        <circle cx={pt.x} cy={pt.y} r="5.5" className="analytics-line-dot market" />
                        <circle
                          cx={pt.x}
                          cy={pt.y}
                          r="15"
                          className={`analytics-line-hit market ${pt.month === marketLineMonth ? "active" : ""}`}
                          onClick={() => setMarketLineMonth(pt.month)}
                          onTouchStart={() => setMarketLineMonth(pt.month)}
                        />
                      </g>
                    ))}
                  </svg>
                </div>
              </div>
              <div
                className="analytics-line-axis"
                style={
                  {
                    "--axis-count": marketSeriesView.length,
                    "--axis-active": marketLineIndex < 0 ? 0 : marketLineIndex,
                  } as React.CSSProperties
                }
              >
                {marketSeriesView.map((p) => (
                  <button
                    key={`${p.month}-axis`}
                    type="button"
                    className={`analytics-line-axis-label ${p.month === marketLineMonth ? "active" : ""}`}
                    onClick={() => setMarketLineMonth(p.month)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              {marketLinePoint ? (
                <div className="analytics-line-detail">
                  <div className="analytics-line-detail-item">
                    <span className="analytics-line-detail-label">Месяц</span>
                    <span className="analytics-line-detail-value">{marketLinePoint.label}</span>
                  </div>
                  <div className="analytics-line-detail-item">
                    <span className="analytics-line-detail-label">Выручка</span>
                    <span className="analytics-line-detail-value">{formatK(marketLinePoint.value)}</span>
                  </div>
                  <div className="analytics-line-detail-item">
                    <span className="analytics-line-detail-label">К прошлому</span>
                    <span className={`analytics-line-detail-value ${marketLineDelta == null ? "neutral" : marketLineDelta >= 0 ? "up" : "down"}`}>
                      {marketLineDelta == null ? "Нет данных" : `${marketLineDelta >= 0 ? "+" : ""}${marketLineDelta.toFixed(1)}%`}
                    </span>
                  </div>
                  <div className="analytics-line-detail-item">
                    <span className="analytics-line-detail-label">От пика</span>
                    <span className="analytics-line-detail-value">{`${marketLinePeak}%`}</span>
                  </div>
                  <div className="analytics-line-detail-item">
                    <span className="analytics-line-detail-label">Позиция</span>
                    <span className="analytics-line-detail-value">{`${marketLineIndex + 1}/${marketSeriesView.length}`}</span>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="analytic-card">
          <div className="analytic-title">{isSupplier ? "Продажи поставщика" : "Покупки компании"}</div>
          <div className="analytic-row">
            <div className="analytic-metric">
              <div className="metric-label">{isSupplier ? "Выручка (за период)" : "Закупки (за период)"}</div>
              <div className="metric-value">{formatK(data?.total_revenue ?? 0)}</div>
            </div>
            <div className="analytic-metric">
              <div className="metric-label">Средний чек</div>
              <div className="metric-value">{avgCheck > 0 ? avgCheck : "-"}</div>
            </div>
            <div className="analytic-metric">
              <div className="metric-label">Рост MoM</div>
              <div className="metric-value">{salesLineDelta == null ? "-" : `${salesLineDelta >= 0 ? "+" : ""}${salesLineDelta.toFixed(1)}%`}</div>
            </div>
          </div>

          {salesLineChart ? (
            <div className="analytics-line-block">
              <div className="analytics-line-head">
                <div className="analytics-line-caption">{isSupplier ? "Динамика выручки по месяцам" : "Динамика закупок по месяцам"}</div>
                <div className="analytics-line-value-chip">{`${formatK(salesSeriesView[salesSeriesView.length - 1]?.value ?? 0)} сейчас`}</div>
              </div>
              <div className="analytics-line-plot">
                <div className="analytics-line-y-axis">
                  {salesYAxis.map((tick, idx) => (
                    <span key={`sales-y-${idx}`} className="analytics-line-y-axis-label" style={{ top: `${(tick.y / salesLineChart.height) * 100}%` }}>
                      {formatK(tick.value)}
                    </span>
                  ))}
                </div>
                <div className="analytics-line-chart sales">
                  <svg viewBox={`0 0 ${salesLineChart.width} ${salesLineChart.height}`} preserveAspectRatio="none" aria-hidden="true">
                    {salesLineChart.yTicks.map((tick, idx) => (
                      <line
                        key={`sales-grid-${idx}`}
                        x1={salesLineChart.points[0]?.x ?? 0}
                        y1={tick.y}
                        x2={salesLineChart.points[salesLineChart.points.length - 1]?.x ?? salesLineChart.width}
                        y2={tick.y}
                        className="analytics-line-grid"
                      />
                    ))}
                    <path d={salesLineChart.areaPath} className="analytics-line-area sales" />
                    <path d={salesLineChart.path} className="analytics-line-stroke sales" />
                    {salesLineChart.points.map((pt) => (
                      <g key={`${pt.label}-${pt.x}`} className={`analytics-line-point ${pt.month === salesLineMonth ? "active" : ""}`}>
                        {pt.month === salesLineMonth ? <circle cx={pt.x} cy={pt.y} r="9" className="analytics-line-dot-active-ring sales" /> : null}
                        <circle cx={pt.x} cy={pt.y} r="5.5" className="analytics-line-dot sales" />
                        <circle
                          cx={pt.x}
                          cy={pt.y}
                          r="15"
                          className={`analytics-line-hit sales ${pt.month === salesLineMonth ? "active" : ""}`}
                          onClick={() => setSalesLineMonth(pt.month)}
                          onTouchStart={() => setSalesLineMonth(pt.month)}
                        />
                      </g>
                    ))}
                  </svg>
                </div>
              </div>
              <div
                className="analytics-line-axis"
                style={
                  {
                    "--axis-count": salesSeriesView.length,
                    "--axis-active": salesLineIndex < 0 ? 0 : salesLineIndex,
                  } as React.CSSProperties
                }
              >
                {salesSeriesView.map((p) => (
                  <button
                    key={`${p.month}-axis`}
                    type="button"
                    className={`analytics-line-axis-label ${p.month === salesLineMonth ? "active" : ""}`}
                    onClick={() => setSalesLineMonth(p.month)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              {salesLinePoint ? (
                <div className="analytics-line-detail">
                  <div className="analytics-line-detail-item">
                    <span className="analytics-line-detail-label">Месяц</span>
                    <span className="analytics-line-detail-value">{salesLinePoint.label}</span>
                  </div>
                  <div className="analytics-line-detail-item">
                    <span className="analytics-line-detail-label">{isSupplier ? "Выручка" : "Закупки"}</span>
                    <span className="analytics-line-detail-value">{formatK(salesLinePoint.value)}</span>
                  </div>
                  <div className="analytics-line-detail-item">
                    <span className="analytics-line-detail-label">К прошлому</span>
                    <span className={`analytics-line-detail-value ${salesLineDelta == null ? "neutral" : salesLineDelta >= 0 ? "up" : "down"}`}>
                      {salesLineDelta == null ? "Нет данных" : `${salesLineDelta >= 0 ? "+" : ""}${salesLineDelta.toFixed(1)}%`}
                    </span>
                  </div>
                  <div className="analytics-line-detail-item">
                    <span className="analytics-line-detail-label">От пика</span>
                    <span className="analytics-line-detail-value">{`${salesLinePeak}%`}</span>
                  </div>
                  <div className="analytics-line-detail-item">
                    <span className="analytics-line-detail-label">Позиция</span>
                    <span className="analytics-line-detail-value">{`${salesLineIndex + 1}/${salesSeriesView.length}`}</span>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="analytic-card">
          <div className="analytic-title">{isSupplier ? "Прогноз продаж (регрессия)" : "Прогноз закупок (регрессия)"}</div>
          <div className="analytic-subtitle">Следующие 3 месяца</div>
          <div className="forecast-row">
            {forecastSeries.length ? (
              forecastSeries.map((p) => (
                <div className="forecast-pill" key={p.label}>
                  <div className="forecast-label">{p.label}</div>
                  <div className="forecast-value">{formatK(p.value)}</div>
                </div>
              ))
            ) : (
              <div className="order-item-muted">Недостаточно данных для прогноза</div>
            )}
          </div>
          <div className="analytic-note">
            {`Модель: линейная регрессия по последним ${salesSeries.length} месяцам ${isSupplier ? "продаж" : "закупок"}.`}
          </div>
        </div>

        <div className="analytic-card">
          <div className="analytic-title">Сценарный прогноз</div>
          <div className="analytic-subtitle">Best / Base / Worst на 3 месяца</div>
          <div className="scenario-grid">
            {forecastScenario.length ? (
              forecastScenario.map((p) => (
                <div className="scenario-item" key={`sc-${p.label}`}>
                  <div className="scenario-month">{p.label}</div>
                  <div className="scenario-row">
                    <span className="scenario-tag best">Best</span>
                    <span className="scenario-value">{formatK(p.best)}</span>
                  </div>
                  <div className="scenario-row">
                    <span className="scenario-tag base">Base</span>
                    <span className="scenario-value">{formatK(p.base)}</span>
                  </div>
                  <div className="scenario-row">
                    <span className="scenario-tag worst">Worst</span>
                    <span className="scenario-value">{formatK(p.worst)}</span>
                  </div>
                </div>
              ))
            ) : (
              <div className="order-item-muted">Недостаточно данных для сценарной модели</div>
            )}
          </div>
        </div>

        <div className="analytic-card">
          <div className="analytic-title">Операционное здоровье</div>
          <div className="kpi-grid">
            <div className="kpi-item">
              <div className="kpi-label">Delivery Rate</div>
              <div className="kpi-value">{`${deliveryRate.toFixed(1)}%`}</div>
            </div>
            <div className="kpi-item">
              <div className="kpi-label">Отмены</div>
              <div className="kpi-value">{`${cancellationRate.toFixed(1)}%`}</div>
            </div>
            <div className="kpi-item">
              <div className="kpi-label">В работе</div>
              <div className="kpi-value">{`${pipelineRate.toFixed(1)}%`}</div>
            </div>
            <div className="kpi-item">
              <div className="kpi-label">Волатильность</div>
              <div className="kpi-value">{`${volatilityPct.toFixed(1)}%`}</div>
            </div>
            <div className="kpi-item">
              <div className="kpi-label">Run-rate / мес</div>
              <div className="kpi-value">{formatK(runRate)}</div>
            </div>
            <div className="kpi-item">
              <div className="kpi-label">Сезонность</div>
              <div className="kpi-value">{seasonalityIndex.toFixed(2)}</div>
            </div>
          </div>
        </div>

        {!isSupplier ? (
          <div className="analytic-card">
            <div className="analytic-title">Выгодные альтернативы</div>
            {cheaperAlternatives.length ? (
              <div className="buyer-reco-list">
                {cheaperAlternatives.slice(0, 4).map((alt) => (
                  <div className="buyer-reco-item" key={`${alt.anchor_product_id}-${alt.candidate_product_id}`}>
                    <div className="buyer-reco-head">
                      <span className="buyer-reco-product">{alt.anchor_product_name}</span>
                      <span className="buyer-reco-save">{`-${alt.savings_pct.toFixed(1)}%`}</span>
                    </div>
                    <div className="buyer-reco-route">
                      <span>{`${alt.anchor_supplier_name} (${formatK(alt.anchor_price)})`}</span>
                      <span className="buyer-reco-arrow">→</span>
                      <span>{`${alt.candidate_supplier_name} (${formatK(alt.candidate_price)})`}</span>
                    </div>
                    <div className="buyer-reco-note">{alt.rationale}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="order-item-muted">Недостаточно данных для рекомендаций по цене</div>
            )}
          </div>
        ) : null}

        {!isSupplier ? (
          <div className="analytic-card">
            <div className="analytic-title">Надежные поставщики</div>
            {reliableSuppliers.length ? (
              <div className="supplier-health-list">
                {reliableSuppliers.slice(0, 5).map((supplier) => (
                  <div className="supplier-health-item" key={supplier.supplier_company_id}>
                    <div className="supplier-health-head">
                      <span className="supplier-health-name">{supplier.supplier_name}</span>
                      <span className="supplier-health-score">{`${supplier.score.toFixed(1)}/100`}</span>
                    </div>
                    <div className="supplier-health-metrics">
                      <span>{`Delivery ${supplier.delivery_rate_pct.toFixed(1)}%`}</span>
                      <span>{`Отмены ${supplier.cancel_rate_pct.toFixed(1)}%`}</span>
                      <span>{`Повторные ${supplier.repeat_share_pct.toFixed(1)}%`}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="order-item-muted">Недостаточно данных для оценки надежности поставщиков</div>
            )}
          </div>
        ) : null}

        <div className="analytic-card">
          <div className="analytic-title">Категории</div>
          <div className="stacked-list">
            {topCategories.length ? (
              topCategories.map((c) => (
                <div className="stacked-row" key={c.name}>
                  <div className="stacked-label">{c.name}</div>
                  <div className="stacked-bar">
                    <span style={{ width: `${Math.max(1, c.share_pct)}%` }} />
                  </div>
                  <div className="stacked-value">{`${c.share_pct.toFixed(0)}%`}</div>
                </div>
              ))
            ) : (
              <div className="order-item-muted">Нет данных по категориям</div>
            )}
          </div>
        </div>

        <div className="analytic-card">
          <div className="analytic-title">Воронка статусов</div>
          <div className="funnel">
            {funnelRows.length ? (
              funnelRows.map((f) => (
                <div className="funnel-row" key={f.status}>
                  <div className="funnel-label">{statusLabel(f.status)}</div>
                  <div className="funnel-value">{formatK(f.count)}</div>
                </div>
              ))
            ) : (
              <div className="order-item-muted">Нет заказов за период</div>
            )}
          </div>
        </div>

        <div className="analytic-card">
          <div className="analytic-title">Выводы и рекомендации</div>
          <ul className="analytic-list">
            {insights.length ? (
              insights.map((line, i) => <li key={`${line}-${i}`}>{line}</li>)
            ) : (
              <li>Пока нет достаточного объема данных для выводов</li>
            )}
          </ul>
        </div>

        <div className="analytic-card">
          <div className="analytic-title">Сигналы модели</div>
          <ul className="analytic-list">
            {modelSignals.map((line, i) => (
              <li key={`${line}-${i}`}>{line}</li>
            ))}
          </ul>
        </div>

      </div>
      )}

    </section>
  );
}
