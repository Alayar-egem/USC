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
        { key: "home" as const, label: "Главная", icon: "/media/home.svg" },
        { key: "cart" as const, label: "Корзина", icon: "/media/basket.svg" },
        { key: "analytics" as const, label: "Аналитика", icon: "/media/history_white.svg" },
        { key: "ai" as const, label: "ИИ", icon: "/media/ai.svg" },
        { key: "profile" as const, label: "Профиль", icon: "/media/ava.svg" },
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
          type="button"
          onClick={() => onChange(t.key)}
        >
          <img src={t.icon} alt="" className="tab-icon" />
          <span>{t.label}</span>

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
