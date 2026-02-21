import { api } from "./client";

export type AnalyticsSummary = {
  company_id: number;
  role: "supplier" | "buyer";
  days: number;
  total_orders: number;
  total_revenue: number;
  daily_revenue: Array<{ day: string; revenue: number }>;
  top_products: Array<{ product_id: number; name: string; revenue: number; qty_total: number }>;
  market: {
    platform_revenue: number;
    platform_orders: number;
    company_share_pct: number;
  };
  market_trends: Array<{ month: string; revenue: number }>;
  sales_trends: Array<{ month: string; revenue: number }>;
  category_breakdown: Array<{ name: string; revenue: number; share_pct: number }>;
  status_funnel: Array<{ status: string; count: number }>;
  insights: string[];
  buyer_recommendations?: {
    cheaper_alternatives: Array<{
      anchor_product_id: number;
      anchor_product_name: string;
      anchor_supplier_company_id: number;
      anchor_supplier_name: string;
      anchor_price: number;
      candidate_product_id: number;
      candidate_product_name: string;
      candidate_supplier_company_id: number;
      candidate_supplier_name: string;
      candidate_price: number;
      unit: string;
      savings_abs: number;
      savings_pct: number;
      rationale: string;
    }>;
    reliable_suppliers: Array<{
      supplier_company_id: number;
      supplier_name: string;
      score: number;
      delivery_rate_pct: number;
      cancel_rate_pct: number;
      repeat_share_pct: number;
      delivered_orders: number;
    }>;
    generated_at: string;
  };
};

export type AnalyticsAssistantResponse = {
  summary: string;
  probable_causes: string[];
  actions: string[];
  confidence: number;
  focus_month: string | null;
  show_metrics?: boolean;
  metrics: {
    mom_pct: number | null;
    delivery_rate_pct: number;
    cancel_rate_pct: number;
    market_share_pct: number;
    top_category_name: string;
    top_category_share_pct: number;
  };
};

export async function fetchAnalyticsSummary(params: {
  companyId: number;
  role: "supplier" | "buyer";
  days?: number;
}) {
  const qs = new URLSearchParams();
  qs.set("company_id", String(params.companyId));
  qs.set("role", params.role);
  if (params.days) qs.set("days", String(params.days));
  return api<AnalyticsSummary>(`/analytics/summary/?${qs.toString()}`, { auth: true });
}

export async function queryAnalyticsAssistant(params: {
  companyId: number;
  role: "supplier" | "buyer";
  question: string;
  days?: number;
  selectedMonth?: string | null;
}) {
  return api<AnalyticsAssistantResponse>("/analytics/assistant/query", {
    method: "POST",
    auth: true,
    body: {
      company_id: params.companyId,
      role: params.role,
      question: params.question,
      days: params.days ?? 365,
      selected_month: params.selectedMonth ?? null,
    },
  });
}
