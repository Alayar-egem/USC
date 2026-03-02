import { useMemo } from "react";

export type TabKey = "home" | "search" | "cart" | "analytics" | "ai" | "profile";

export default function TabBar({
  active,
  cartCount,
  onChange,
}: {
  active: TabKey;
  cartCount: number;
  onChange: (tab: TabKey) => void;
}) {
  const tabs = useMemo(
    () =>
      [
        { key: "home" as const, icon: "/media/tabbar/home.svg" },
        { key: "cart" as const, icon: "/media/tabbar/cart.svg" },
        { key: "analytics" as const, icon: "/media/tabbar/analytics.svg" },
        { key: "ai" as const, icon: "/media/tabbar/ai.svg" },
        { key: "profile" as const, icon: "/media/tabbar/profile.svg" },
      ] as const,
    []
  );

  const activeIndex = Math.max(
    0,
    tabs.findIndex((t) => t.key === active)
  );

  return (
    <nav
      className="tabbar"
      aria-label="Навигация"
      style={{ ["--tab-count" as string]: tabs.length } as React.CSSProperties}
    >
      <div
        className="tabbar-indicator"
        aria-hidden="true"
        style={{ transform: `translateX(${activeIndex * 100}%)` }}
      />

      {tabs.map((t) => (
        <button
          key={t.key}
          className={`tab ${active === t.key ? "active" : ""}`}
          data-testid={`tab-${t.key}`}
          type="button"
          onClick={() => onChange(t.key)}
        >
          <img src={t.icon} alt="" className="tab-icon" />

          {t.key === "cart" ? (
            <span className={`tab-badge ${cartCount > 0 ? "show" : ""}`}>
              {cartCount}
            </span>
          ) : null}
        </button>
      ))}
    </nav>
  );
}
