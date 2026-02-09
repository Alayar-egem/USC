import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Category, Product } from "../types";
import TopHeader from "../ui/TopHeader";
import { ProductCard, ProductCardSkeleton } from "../ui/ProductCard";
import { useProducts } from "../hooks/useProducts";

const CATEGORIES: Array<{
  key: Category;
  icon: string;
  alt: string;
  imgStyle?: React.CSSProperties;
  btnStyle?: React.CSSProperties;
  imgClassName?: string;
}> = [
  { key: "meat", icon: "/media/meat.svg", alt: "Мясо", imgStyle: { width: 58, height: 40 } },
  { key: "milk", icon: "/media/milk.svg", alt: "Молоко", imgStyle: { width: 35, height: 50 } },
  { key: "fish", icon: "/media/fish.svg", alt: "Рыба", imgStyle: { width: 55.2, height: 35 } },
  {
    key: "fruit",
    icon: "/media/apple_car.svg",
    alt: "Овощи и фрукты",
    btnStyle: { display: "flex", paddingBottom: 10, width: 40 },
    imgStyle: { width: 62.1, height: 45 },
  },
  { key: "bread", icon: "/media/bread.svg", alt: "Хлеб", imgStyle: { width: 62.1, height: 45 } },
  {
    key: "grain",
    icon: "/media/wh.svg",
    alt: "Крупы",
    btnStyle: { width: 40 },
    imgStyle: { width: 60.2, height: 45 },
    imgClassName: "grain",
  },
];

export default function HomeScreen({
  active,
  cartCount,
  onBurger,
  onAdd,
  showCompanyBanner = false,
  onPickCompany,
}: {
  active: boolean;
  cartCount: number;
  onBurger: () => void;
  onAdd: (product: Product) => void;
  showCompanyBanner?: boolean;
  onPickCompany?: () => void;
}) {
  const [category, setCategory] = useState<Category>("meat");
  const [query, setQuery] = useState("");
  // FastAPI ожидает category как ID (number). Пока маппим все food-категории на 1.
  const categoryId = 1;
  const { products, loading } = useProducts(categoryId, "");

  // === infinite categories strip (loop) ===
  const categoriesRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const loopItems = useMemo(() => {
    const base = [{ kind: "search" as const }, ...CATEGORIES.map((c) => ({ kind: "cat" as const, ...c }))];
    return [...base, ...base, ...base];
  }, []);

  useEffect(() => {
    const el = categoriesRef.current;
    if (!el) return;

    requestAnimationFrame(() => {
      const third = el.scrollWidth / 3;
      el.scrollLeft = third;
    });

    const onScroll = () => {
      const third = el.scrollWidth / 3;
      if (el.scrollLeft < third * 0.3) el.scrollLeft += third;
      else if (el.scrollLeft > third * 1.7) el.scrollLeft -= third;
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const displayProducts = useMemo(() => {
    if (products.length >= 20 || products.length === 0) return products;
    const out: Product[] = [];
    for (let i = 0; i < 20; i += 1) {
      out.push(products[i % products.length]);
    }
    return out;
  }, [products]);

  const filteredProducts = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return displayProducts;
    return displayProducts.filter((p) => {
      const name = String(p.name ?? "").toLowerCase();
      const seller = String(p.seller ?? "").toLowerCase();
      return name.includes(q) || seller.includes(q);
    });
  }, [displayProducts, query]);

  return (
    <section id="screen-home" className={`screen ${active ? "active" : ""}`}>
      <TopHeader onBurger={onBurger} badgeCount={cartCount} />

      {showCompanyBanner ? (
        <div className="company-banner">
          <div>
            <div className="company-banner-title">Добавь компанию</div>
            <div className="company-banner-text">Без компании заказы и аналитика будут ограничены.</div>
          </div>
          <button className="company-banner-btn" type="button" onClick={onPickCompany}>
            Выбрать
          </button>
        </div>
      ) : null}

      <div className="home-card">
        <div className="logo-row">
          <img src="/media/usc.svg" alt="USC" className="logo" />
        </div>

        <div className="search-box home-inline-search">
          <button className="icon-button" type="button" aria-label="Поиск">
            <img src="/media/search.png" alt="Поиск" />
          </button>
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Искать товар или поставщика"
          />
          <button className="clear-search" type="button" onClick={() => setQuery("")} aria-label="Очистить">
            ×
          </button>
        </div>

        <div className="categories" ref={categoriesRef}>
          {loopItems.map((item, idx) => {
            if (item.kind === "search") {
              return (
                <button
                  key={`search-${idx}`}
                  className="category category-search"
                  type="button"
                  onClick={() => searchInputRef.current?.focus()}
                >
                  <img src="/media/search.png" alt="Поиск" style={{ width: 40, height: 40, borderRadius: 999 }} />
                </button>
              );
            }

            const isActive = category === item.key;

            return (
              <button
                key={`${item.key}-${idx}`}
                className={`category ${isActive ? "active" : ""}`}
                style={item.btnStyle}
                onClick={() => setCategory(item.key)}
                type="button"
                data-category={item.key}
              >
                <img
                  src={item.icon}
                  alt={item.alt}
                  className={item.imgClassName}
                  style={item.imgStyle}
                  onError={(e) => {
                    const img = e.currentTarget;
                    if (item.key === "fruit") img.src = "/media/apple_car.png";
                    if (item.key === "grain") img.src = "/media/pshenica.png";
                  }}
                />
              </button>
            );
          })}
        </div>

        <div className="premium-banner">USC Премиум</div>

        <div className="product-grid" id="product-grid">
          {loading ? (
            <>
              {Array.from({ length: 6 }).map((_, i) => (
                <ProductCardSkeleton key={i} />
              ))}
            </>
          ) : filteredProducts.length === 0 ? (
            <div className="search-empty">Ничего не найдено. Попробуйте другой запрос.</div>
          ) : (
            filteredProducts.map((p, idx) => <ProductCard key={`${p.id}-${idx}`} product={p} onAdd={() => onAdd(p)} />)
          )}
        </div>
      </div>
    </section>
  );
}
