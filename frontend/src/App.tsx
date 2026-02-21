import { useEffect, useMemo, useState } from "react";
import HomeScreen from "./screens/HomeScreen";
import SearchScreen from "./screens/SearchScreen";
import CartScreen from "./screens/CartScreen";
import ProfileScreen from "./screens/ProfileScreen";
import SupplierScreen from "./screens/SupplierScreen";
import OrdersScreen from "./screens/OrdersScreen";
import AuthScreen from "./screens/AuthScreen";
import AnalyticsScreen from "./screens/AnalyticsScreen";
import CompanyPickerScreen from "./screens/CompanyPickerScreen";
import PublicationsScreen from "./screens/PublicationsScreen";
import ProfileEditScreen from "./screens/ProfileEditScreen";
import NotificationsScreen from "./screens/NotificationsScreen";
import DeliveriesScreen from "./screens/DeliveriesScreen";
import AboutScreen from "./screens/AboutScreen";
import HelpScreen from "./screens/HelpScreen";
import FaqScreen from "./screens/FaqScreen";
import AIChatScreen from "./screens/AIChatScreen";
import TabBar, { type TabKey } from "./ui/TabBar";
import { Toast } from "./ui/Toast";
import { Drawer } from "./ui/Drawer";
import { useCart } from "./hooks/useCart";
import { useToast } from "./hooks/useToast";
import type { Product, Screen } from "./types";
import type { Supplier } from "./api/suppliers";
import { logout as clearAuth } from "./api/auth";
import { fetchNotifications } from "./api/notifications";
import { fetchMe, type MeProfile } from "./api/profile";

function hashSeed(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0;
  }
  return h;
}

function normalizeRole(input?: string | null): "buyer" | "supplier" {
  return String(input || "").toLowerCase() === "supplier" ? "supplier" : "buyer";
}

export default function App() {
  const toast = useToast();
  const initialAuthed = !!localStorage.getItem("usc_access_token");
  const [authed, setAuthed] = useState(initialAuthed);
  const [activeTab, setActiveTab] = useState<TabKey>("home");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerScreen, setDrawerScreen] = useState<Screen | null>(null);
  const [companyPickerOpen, setCompanyPickerOpen] = useState(false);
  const [profile, setProfile] = useState<MeProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileNonce, setProfileNonce] = useState(0);
  const [notificationCount, setNotificationCount] = useState(0);
  const [companyId, setCompanyId] = useState<number | null>(() => {
    const raw = localStorage.getItem("usc_company_id");
    if (!raw) return null;
    const num = Number(raw);
    return Number.isFinite(num) ? num : null;
  });
  const [appRole, setAppRole] = useState<"buyer" | "supplier">(() => normalizeRole(localStorage.getItem("usc_app_role")));

  const [ordersOpen, setOrdersOpen] = useState(false);
  const [focusOrderId, setFocusOrderId] = useState<number | null>(null);
  const [supplierView, setSupplierView] = useState<{ id: string; name: string } | null>(null);
  const [searchPreset, setSearchPreset] = useState<{ categoryId: number | null }>({ categoryId: null });

  const [splashAnimationDone, setSplashAnimationDone] = useState(!initialAuthed);

  useEffect(() => {
    if (!authed) {
      setSplashAnimationDone(true);
      return;
    }
    setSplashAnimationDone(false);
    const t = setTimeout(() => setSplashAnimationDone(true), 2200);
    return () => clearTimeout(t);
  }, [authed]);

  useEffect(() => {
    if (!authed) {
      setProfile(null);
      setProfileError(null);
      setProfileLoading(false);
      return;
    }

    let alive = true;
    setProfileLoading(true);
    setProfileError(null);

    fetchMe()
      .then((data) => {
        if (!alive) return;
        setProfile(data);

        const storedRaw = localStorage.getItem("usc_company_id");
        const storedId = storedRaw ? Number(storedRaw) : null;
        const storedValid =
          storedId != null &&
          Number.isFinite(storedId) &&
          (data.companies || []).some((c) => c.company_id === storedId);

        if (data.companies?.length === 1) {
          const onlyCompany = data.companies[0];
          const onlyId = onlyCompany.company_id;
          setCompanyId(onlyId);
          localStorage.setItem("usc_company_id", String(onlyId));
          localStorage.setItem("usc_company_name", onlyCompany.name || "");
          return;
        }

        if (storedValid) {
          setCompanyId(storedId);
          const storedCompany = data.companies?.find((c) => c.company_id === storedId);
          if (storedCompany) localStorage.setItem("usc_company_name", storedCompany.name || "");
        } else {
          setCompanyId(null);
          localStorage.removeItem("usc_company_id");
          localStorage.removeItem("usc_company_name");
        }
      })
      .catch(() => {
        if (!alive) return;
        setProfileError("\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u043f\u0440\u043e\u0444\u0438\u043b\u044c");
        setProfile(null);
      })
      .finally(() => {
        if (!alive) return;
        setProfileLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [authed, profileNonce]);

  useEffect(() => {
    if (!authed) {
      setNotificationCount(0);
      return;
    }

    let alive = true;
    const load = () => {
      fetchNotifications(30)
        .then((data) => {
          if (!alive) return;
          const unread = data.filter((n) => n.is_new !== false).length;
          setNotificationCount(unread);
        })
        .catch(() => {
          if (!alive) return;
          setNotificationCount(0);
        });
    };

    load();
    const timer = setInterval(load, 20000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [authed]);

  useEffect(() => {
    if (drawerScreen === "notifications") {
      setNotificationCount(0);
    }
  }, [drawerScreen]);

  useEffect(() => {
    localStorage.setItem("usc_app_role", appRole);
  }, [appRole]);

  const cart = useCart();
  const cartItems = useMemo(() => cart.items, [cart.items]);
  const currentCompany = profile?.companies?.find((c) => c.company_id === companyId) ?? null;
  const currentCompanyType = String(currentCompany?.company_type || "").toUpperCase();
  const currentCompanyName = currentCompany?.name ?? null;
  const reputation = useMemo(() => {
    const seedSource = `${profile?.email ?? ""}|${profile?.role ?? ""}|${currentCompanyName ?? ""}`;
    const seed = hashSeed(seedSource || "usc-user");
    const rating = Math.min(4.9, 4.3 + (seed % 61) / 100);
    const reviews = 85 + (seed % 540);
    const completedOrders = 40 + (seed % 320);
    return {
      rating: Number(rating.toFixed(1)),
      reviews,
      completedOrders,
    };
  }, [profile?.email, profile?.role, currentCompanyName]);

  useEffect(() => {
    if (!profile) return;
    const companyBasedRole = currentCompanyType === "SUPPLIER" ? "supplier" : currentCompanyType === "BUYER" ? "buyer" : null;
    const savedRole = normalizeRole(localStorage.getItem("usc_app_role"));
    setAppRole(companyBasedRole ?? savedRole ?? normalizeRole(profile.role));
  }, [profile, currentCompanyType]);

  function addToCart(product: Product) {
    cart.add(product);
  }

  function inc(productId: string) {
    const it = cart.items.find((x) => x.product.id === productId);
    cart.setQty(productId, (it?.qty ?? 0) + 1);
  }

  function dec(productId: string) {
    const it = cart.items.find((x) => x.product.id === productId);
    const next = (it?.qty ?? 0) - 1;
    if (next <= 0) cart.remove(productId);
    else cart.setQty(productId, next);
  }

  const openDrawer = () => setDrawerOpen(true);
  const closeDrawer = () => setDrawerOpen(false);
  const handleLogout = () => {
    clearAuth();
    localStorage.removeItem("usc_company_id");
    localStorage.removeItem("usc_company_name");
    localStorage.removeItem("usc_app_role");
    setAuthed(false);
    setProfile(null);
    setCompanyId(null);
    setDrawerOpen(false);
    setDrawerScreen(null);
    setOrdersOpen(false);
    setSupplierView(null);
  };

  const handleSwitchCompany = () => {
    setCompanyId(null);
    localStorage.removeItem("usc_company_id");
    localStorage.removeItem("usc_company_name");
    setDrawerOpen(false);
    setCompanyPickerOpen(true);
  };

  const goTab = (tab: TabKey) => {
    setOrdersOpen(false);
    setFocusOrderId(null);
    setSupplierView(null);
    setDrawerScreen(null);

    setActiveTab(tab);
    if (tab === "search") setSearchPreset({ categoryId: null });
    closeDrawer();
  };

  const openFilters = () => {
    console.log("Open filters");
  };

  const openSupplier = (s: Supplier) => {
    setOrdersOpen(false);
    setFocusOrderId(null);
    setSupplierView({ id: String(s.id), name: s.name });
  };

  const closeSupplier = () => setSupplierView(null);

  const openOrders = () => {
    setSupplierView(null);
    setOrdersOpen(true);
    setFocusOrderId(null);
    setDrawerScreen(null);
    closeDrawer();
  };

  const openOrderFromNotification = (orderId: number) => {
    setSupplierView(null);
    setDrawerScreen(null);
    setOrdersOpen(true);
    setFocusOrderId(orderId);
    closeDrawer();
  };

  const openDrawerScreen = (screen: Screen) => {
    if (screen === "search") {
      goTab("home");
      return;
    }
    if (screen === "home" || screen === "cart" || screen === "analytics" || screen === "ai" || screen === "profile") {
      goTab(screen as TabKey);
      return;
    }
    if (screen === "orders") {
      openOrders();
      return;
    }

    setOrdersOpen(false);
    setSupplierView(null);
    setDrawerScreen(screen);
    closeDrawer();
  };

  const screensLocked = !!supplierView || ordersOpen || !!drawerScreen;
  const keepSplashVisible = authed && (!splashAnimationDone || profileLoading);

  if (!authed) {
    return (
      <div className="app">
        <AuthScreen onSuccess={() => setAuthed(true)} />
      </div>
    );
  }

  if (profileError) {
    return (
      <div className="app">
        <section className="company-screen">
          <div className="company-card">
            <img src="/media/usc.svg" alt="USC" className="company-logo" />
            <div className="company-title">{"\u041e\u0448\u0438\u0431\u043a\u0430 \u043f\u0440\u043e\u0444\u0438\u043b\u044f"}</div>
            <div className="company-subtitle">{profileError}</div>
            <button className="primary-button" type="button" onClick={() => setProfileNonce((x) => x + 1)}>
              {"\u041f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u044c"}
            </button>
            <button className="auth-link" type="button" onClick={handleLogout}>
              {"\u0412\u044b\u0439\u0442\u0438"}
            </button>
          </div>
        </section>
      </div>
    );
  }

  const needsCompany = profile && companyId == null;

  return (
    <div className={`app ${drawerOpen ? "drawer-open" : ""}`}>
      <div id="splash" className={`splash ${keepSplashVisible ? "" : "splash-hide"}`}>
        <div className="splash-logo-row">
          <img src="/media/u.svg" className="splash-letter splash-u" alt="U" />
          <img src="/media/s.svg" className="splash-letter splash-s" alt="S" />
          <img src="/media/c.svg" className="splash-letter splash-c" alt="C" />
          <img src="/media/chain.svg" className="splash-letter splash-chain" alt="Chain" />
        </div>
        <div className="splash-tagline">
          <img src="/media/desc.svg" className="splash-desc" alt="Unity supply chain" />
        </div>
      </div>

      <Drawer
        open={drawerOpen}
        onClose={closeDrawer}
        onGo={openDrawerScreen}
        onLogout={handleLogout}
        onSwitchCompany={() => setCompanyPickerOpen(true)}
        companyName={currentCompanyName}
        role={appRole}
        onRoleChange={setAppRole}
        notificationCount={notificationCount}
        ratingValue={reputation.rating}
        reviewCount={reputation.reviews}
        completedOrders={reputation.completedOrders}
      />

      <main className="screens">
        <HomeScreen
          active={!screensLocked && activeTab === "home"}
          cartCount={cart.count}
          onBurger={openDrawer}
          onAdd={addToCart}
          showCompanyBanner={!!needsCompany}
          onPickCompany={() => setCompanyPickerOpen(true)}
        />

        <SearchScreen
          active={!screensLocked && activeTab === "search"}
          initialCategoryId={searchPreset.categoryId}
          onOpenFilters={openFilters}
          onAdd={addToCart}
          cartCount={cart.count}
          onBurger={openDrawer}
          onOpenSupplier={openSupplier}
        />

        <AnalyticsScreen
          active={!screensLocked && activeTab === "analytics"}
          cartCount={cart.count}
          onBurger={openDrawer}
          role={appRole}
          companyId={companyId}
          showCompanyBanner={!!needsCompany}
          onPickCompany={() => setCompanyPickerOpen(true)}
        />

        <AIChatScreen
          active={!screensLocked && activeTab === "ai"}
          cartCount={cart.count}
          onBurger={openDrawer}
          onNotify={toast.show}
          role={appRole}
          companyId={companyId}
          showCompanyBanner={!!needsCompany}
          onPickCompany={() => setCompanyPickerOpen(true)}
        />

        <CartScreen
          active={!screensLocked && activeTab === "cart"}
          items={cartItems}
          total={cart.total}
          onInc={inc}
          onDec={dec}
          onRemove={cart.remove}
          onClear={cart.clear}
          cartCount={cart.count}
          onBurger={openDrawer}
          onCheckoutSuccess={openOrders}
          buyerCompanyId={companyId}
          onNotify={toast.show}
        />

        <ProfileScreen
          active={!screensLocked && activeTab === "profile"}
          cartCount={cart.count}
          onBurger={openDrawer}
          profile={profile}
          companyName={currentCompanyName}
          onSwitchCompany={handleSwitchCompany}
          showCompanyBanner={!!needsCompany}
          onPickCompany={() => setCompanyPickerOpen(true)}
          ratingValue={reputation.rating}
          reviewCount={reputation.reviews}
          completedOrders={reputation.completedOrders}
        />

        <SupplierScreen
          active={!!supplierView}
          supplierId={supplierView?.id ?? null}
          supplierName={supplierView?.name ?? "\u041f\u043e\u0441\u0442\u0430\u0432\u0449\u0438\u043a"}
          cartCount={cart.count}
          onBack={closeSupplier}
          onAdd={addToCart}
        />

        <OrdersScreen
          active={ordersOpen}
          cartCount={cart.count}
          onBurger={openDrawer}
          onBack={() => setOrdersOpen(false)}
          buyerCompanyId={companyId}
          role={appRole}
          onOpenNotifications={() => openDrawerScreen("notifications")}
          notificationCount={notificationCount}
          focusOrderId={focusOrderId}
          onFocusOrderHandled={() => setFocusOrderId(null)}
          onNotify={toast.show}
        />

        <DeliveriesScreen
          active={drawerScreen === "deliveries"}
          onBurger={openDrawer}
          onOpenNotifications={() => openDrawerScreen("notifications")}
          notificationCount={notificationCount}
        />

        <PublicationsScreen
          active={drawerScreen === "publications"}
          onBurger={openDrawer}
          onOpenNotifications={() => openDrawerScreen("notifications")}
          notificationCount={notificationCount}
        />

        <ProfileEditScreen
          active={drawerScreen === "profile-edit"}
          onBurger={openDrawer}
          onOpenNotifications={() => openDrawerScreen("notifications")}
          notificationCount={notificationCount}
          onNotify={toast.show}
        />

        <NotificationsScreen
          active={drawerScreen === "notifications"}
          onBurger={openDrawer}
          onOpenNotifications={() => openDrawerScreen("notifications")}
          notificationCount={notificationCount}
          role={appRole}
          onOpenOrder={openOrderFromNotification}
          onNotify={toast.show}
        />

        <AboutScreen
          active={drawerScreen === "about"}
          onBurger={openDrawer}
          onOpenNotifications={() => openDrawerScreen("notifications")}
          notificationCount={notificationCount}
        />

        <HelpScreen
          active={drawerScreen === "help"}
          onBurger={openDrawer}
          onOpenNotifications={() => openDrawerScreen("notifications")}
          notificationCount={notificationCount}
        />

        <FaqScreen
          active={drawerScreen === "faq"}
          onBurger={openDrawer}
          onOpenNotifications={() => openDrawerScreen("notifications")}
          notificationCount={notificationCount}
        />
      </main>

      <TabBar active={activeTab} cartCount={cart.count} onChange={goTab} />
      <Toast text={toast.text} tone={toast.tone} visible={toast.visible} onClose={toast.hide} />

      {companyPickerOpen && profile ? (
        <div className="company-overlay">
          <CompanyPickerScreen
            profile={profile}
            selectedId={companyId}
            onSelect={(id) => {
              const selected = profile.companies?.find((c) => c.company_id === id);
              setCompanyId(id);
              localStorage.setItem("usc_company_id", String(id));
              if (selected) localStorage.setItem("usc_company_name", selected.name || "");
              setCompanyPickerOpen(false);
            }}
            onLogout={handleLogout}
            onClose={() => setCompanyPickerOpen(false)}
          />
        </div>
      ) : null}
    </div>
  );
}
