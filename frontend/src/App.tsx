import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import HomeScreen from "./screens/HomeScreen";
import SearchScreen from "./screens/SearchScreen";
import CartScreen from "./screens/CartScreen";
import ProfileScreen from "./screens/ProfileScreen";
import SupplierScreen from "./screens/SupplierScreen";
import OrdersScreen from "./screens/OrdersScreen";
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
import OnboardingOverlay from "./onboarding/OnboardingOverlay";
import { ONBOARDING_STEPS } from "./onboarding/steps";
import { useOnboarding } from "./onboarding/useOnboarding";
import TabBar, { type TabKey } from "./ui/TabBar";
import { Toast } from "./ui/Toast";
import { Drawer } from "./ui/Drawer";
import { useCart } from "./hooks/useCart";
import { useToast } from "./hooks/useToast";
import type { Product, Screen } from "./types";
import type { Supplier } from "./api/suppliers";
import { login as loginWithPresetAccount, logout as clearAuth, logoutAllRequest, logoutLocal } from "./api/auth";
import { isApiError, SESSION_EXPIRED_EVENT } from "./api/client";
import { fetchNotifications } from "./api/notifications";
import { fetchMe, type MeProfile } from "./api/profile";

const TAB_ORDER: TabKey[] = ["home", "cart", "analytics", "ai", "profile"];
const PRESET_DEMO_ACCOUNT = {
  email: "buyer1@usc.demo",
  password: "demo123456",
} as const;
const LOCAL_DEMO_PROFILE: MeProfile = {
  id: 1001,
  email: PRESET_DEMO_ACCOUNT.email,
  first_name: "Demo",
  last_name: "Buyer",
  phone: "",
  role: "buyer",
  companies: [
    {
      company_id: 1,
      name: "USC Demo Buyer Co.",
      company_type: "BUYER",
      role: "OWNER",
    },
  ],
};

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
  const [autoLoginBusy, setAutoLoginBusy] = useState(false);
  const [autoLoginError, setAutoLoginError] = useState<string | null>(null);
  const [autoLoginNonce, setAutoLoginNonce] = useState(0);
  const [demoMode, setDemoMode] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("home");
  const [tabTransitionDir, setTabTransitionDir] = useState<"forward" | "backward">("forward");
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
  const isSessionExpiringRef = useRef(false);
  const autoLoginInFlightRef = useRef(false);

  const [ordersOpen, setOrdersOpen] = useState(false);
  const [focusOrderId, setFocusOrderId] = useState<number | null>(null);
  const [supplierView, setSupplierView] = useState<{ id: string; name: string } | null>(null);
  const [searchPreset, setSearchPreset] = useState<{ categoryId: number | null }>({ categoryId: null });
  const [cartCheckoutOpen, setCartCheckoutOpen] = useState(false);
  const [tourTargetFound, setTourTargetFound] = useState(false);
  const [homeCategoryTouched, setHomeCategoryTouched] = useState(false);
  const [aiOnboardingAnswered, setAiOnboardingAnswered] = useState(false);

  const [splashAnimationDone, setSplashAnimationDone] = useState(!initialAuthed);
  const handleSessionExpired = useCallback(() => {
    if (isSessionExpiringRef.current) return;
    isSessionExpiringRef.current = true;
    logoutLocal();
    localStorage.removeItem("usc_company_id");
    localStorage.removeItem("usc_company_name");
    localStorage.removeItem("usc_app_role");
    setDemoMode(false);
    setAuthed(false);
    setNotificationCount(0);
    setProfile(null);
    setProfileError(null);
    setProfileLoading(false);
    setCompanyId(null);
    setCompanyPickerOpen(false);
    setDrawerOpen(false);
    setDrawerScreen(null);
    setOrdersOpen(false);
    setSupplierView(null);
    window.setTimeout(() => {
      isSessionExpiringRef.current = false;
    }, 50);
  }, []);

  useEffect(() => {
    const onSessionExpired = () => handleSessionExpired();
    window.addEventListener(SESSION_EXPIRED_EVENT, onSessionExpired as EventListener);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onSessionExpired as EventListener);
  }, [handleSessionExpired]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === "usc_access_token" && !event.newValue) {
        handleSessionExpired();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [handleSessionExpired]);

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
    if (demoMode) {
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
      .catch((error: unknown) => {
        if (!alive) return;
        if (isApiError(error) && error.status === 401) {
          handleSessionExpired();
          return;
        }
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
  }, [authed, demoMode, profileNonce, handleSessionExpired]);

  useEffect(() => {
    if (demoMode || !authed || !localStorage.getItem("usc_access_token")) {
      setNotificationCount(0);
      return;
    }

    let alive = true;
    let timer: number | null = null;
    const load = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      if (!localStorage.getItem("usc_access_token")) {
        alive = false;
        if (timer != null) window.clearInterval(timer);
        handleSessionExpired();
        return;
      }
      fetchNotifications(30)
        .then((data) => {
          if (!alive) return;
          setNotificationCount(data.unread_count ?? 0);
        })
        .catch((error: unknown) => {
          if (!alive) return;
          if (isApiError(error) && error.status === 401) {
            alive = false;
            if (timer != null) window.clearInterval(timer);
            handleSessionExpired();
            return;
          }
          setNotificationCount(0);
        });
    };

    load();
    timer = window.setInterval(load, 20000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        load();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      alive = false;
      if (timer != null) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [authed, demoMode, handleSessionExpired]);

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

  const keepSplashVisible = authed && (!splashAnimationDone || profileLoading);
  const onboardingContext = useMemo(() => {
    if (!profile || companyId == null) return null;
    const userId = Number(profile.id);
    if (!Number.isFinite(userId) || userId <= 0) return null;
    return {
      userId,
      companyId: Number(companyId),
      role: appRole,
    };
  }, [appRole, companyId, profile]);

  const onboardingEnabled =
    authed &&
    !!profile &&
    companyId != null &&
    !profileLoading &&
    !companyPickerOpen &&
    !profileError &&
    !keepSplashVisible;

  const onboarding = useOnboarding({
    enabled: onboardingEnabled,
    context: onboardingContext,
    stepsCount: ONBOARDING_STEPS.length,
  });

  const onboardingStep = onboarding.isRunning ? ONBOARDING_STEPS[onboarding.stepIndex] ?? null : null;
  const onboardingCartDemoMode =
    onboarding.isRunning &&
    (onboardingStep?.id === "tab_cart" || onboardingStep?.id === "cart_checkout" || onboardingStep?.id === "checkout_map");
  const onboardingAiPromptMode = onboarding.isRunning && onboardingStep?.id === "ai_assistant";

  const onboardingStepCompleted = useMemo(() => {
    if (!onboardingStep) return false;
    if (onboardingStep.id === "ai_assistant") return activeTab === "ai" && aiOnboardingAnswered;
    if (onboardingStep.mode !== "interaction_required") return true;
    if (onboardingStep.id === "open_drawer") return drawerOpen;
    if (onboardingStep.id === "home_category") return homeCategoryTouched;
    if (onboardingStep.id === "tab_cart") return activeTab === "cart";
    if (onboardingStep.id === "cart_checkout") return activeTab === "cart" && cartCheckoutOpen;
    if (onboardingStep.id === "tab_analytics") return activeTab === "analytics";
    if (onboardingStep.id === "tab_ai") return activeTab === "ai";
    if (onboardingStep.id === "tab_profile") return activeTab === "profile";
    return false;
  }, [activeTab, aiOnboardingAnswered, cartCheckoutOpen, drawerOpen, homeCategoryTouched, onboardingStep]);

  const onboardingCanGoNext = useMemo(() => {
    if (!onboardingStep) return false;
    const targetMissing = !!onboardingStep.targetSelector && !tourTargetFound;
    if (onboardingStep.id === "ai_assistant") return onboardingStepCompleted || targetMissing;
    if (onboardingStep.mode !== "interaction_required") return true;
    return onboardingStepCompleted || targetMissing;
  }, [onboardingStep, onboardingStepCompleted, tourTargetFound]);

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
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const handleLogout = async () => {
    await clearAuth().catch(() => undefined);
    handleSessionExpired();
  };

  const handleLogoutAll = async () => {
    await logoutAllRequest().catch(() => undefined);
    handleSessionExpired();
  };

  const handleSwitchCompany = () => {
    setCompanyId(null);
    localStorage.removeItem("usc_company_id");
    localStorage.removeItem("usc_company_name");
    setDrawerOpen(false);
    setCompanyPickerOpen(true);
  };

  const goTab = useCallback((tab: TabKey) => {
    setOrdersOpen(false);
    setFocusOrderId(null);
    setSupplierView(null);
    setDrawerScreen(null);

    if (tab !== activeTab) {
      const fromIndex = TAB_ORDER.indexOf(activeTab);
      const toIndex = TAB_ORDER.indexOf(tab);
      if (fromIndex >= 0 && toIndex >= 0) {
        setTabTransitionDir(toIndex > fromIndex ? "forward" : "backward");
      }
    }
    setActiveTab(tab);
    if (tab === "search") setSearchPreset({ categoryId: null });
    closeDrawer();
  }, [activeTab, closeDrawer]);

  useEffect(() => {
    setTourTargetFound(false);
  }, [onboardingStep?.id]);

  useEffect(() => {
    if (onboardingStep?.id === "ai_assistant") return;
    setAiOnboardingAnswered(false);
  }, [onboardingStep?.id]);

  useEffect(() => {
    setHomeCategoryTouched(false);
  }, [onboardingContext?.userId, onboardingContext?.companyId, onboardingContext?.role]);

  useEffect(() => {
    if (!onboarding.isRunning || !onboardingStep) return;
    if (onboardingStep.screen && activeTab !== onboardingStep.screen) {
      goTab(onboardingStep.screen);
      return;
    }
    if (onboardingStep.id !== "open_drawer" && drawerOpen) {
      closeDrawer();
    }
  }, [activeTab, closeDrawer, drawerOpen, goTab, onboarding.isRunning, onboardingStep]);

  const handleAuthSuccess = useCallback(() => {
    setSplashAnimationDone(false);
    setAutoLoginBusy(false);
    setAutoLoginError(null);
    setDemoMode(false);
    setAuthed(true);
  }, []);

  useEffect(() => {
    if (authed || autoLoginInFlightRef.current) return;

    let alive = true;
    autoLoginInFlightRef.current = true;
    setAutoLoginBusy(true);
    setAutoLoginError(null);

    loginWithPresetAccount(PRESET_DEMO_ACCOUNT.email, PRESET_DEMO_ACCOUNT.password)
      .then(() => {
        if (!alive) return;
        handleAuthSuccess();
      })
      .catch(() => {
        if (!alive) return;
        // Fallback mode: allow opening the app even when backend auth endpoint is unavailable.
        localStorage.setItem("usc_access_token", "demo-local-token");
        localStorage.setItem("usc_refresh_token", "demo-local-refresh-token");
        localStorage.setItem("usc_company_id", String(LOCAL_DEMO_PROFILE.companies[0].company_id));
        localStorage.setItem("usc_company_name", LOCAL_DEMO_PROFILE.companies[0].name);
        localStorage.setItem("usc_app_role", "buyer");
        setProfile(LOCAL_DEMO_PROFILE);
        setCompanyId(LOCAL_DEMO_PROFILE.companies[0].company_id);
        setAppRole("buyer");
        setDemoMode(true);
        setAutoLoginError(null);
        setSplashAnimationDone(false);
        setAuthed(true);
      })
      .finally(() => {
        autoLoginInFlightRef.current = false;
        if (!alive) return;
        setAutoLoginBusy(false);
      });

    return () => {
      alive = false;
    };
  }, [authed, autoLoginNonce, handleAuthSuccess]);

  const openFilters = () => {
    // Filters panel is not implemented yet.
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
  const screensClassName = `screens ${!screensLocked ? `tab-transition-${tabTransitionDir}` : ""}`.trim();

  if (!authed) {
    return (
      <div className="app">
        <section className="company-screen">
          <div className="company-card">
            <img src="/media/usc.svg" alt="USC" className="company-logo" />
            <div className="company-title">{"\u0412\u0445\u043e\u0434 \u0432 \u0434\u0435\u043c\u043e-\u0430\u043a\u043a\u0430\u0443\u043d\u0442"}</div>
            <div className="company-subtitle">
              {autoLoginBusy
                ? "\u0412\u044b\u043f\u043e\u043b\u043d\u044f\u0435\u0442\u0441\u044f \u0430\u0432\u0442\u043e\u0432\u0445\u043e\u0434..."
                : autoLoginError ||
                  "\u0410\u0432\u0442\u043e\u0432\u0445\u043e\u0434 \u0432\u043a\u043b\u044e\u0447\u0435\u043d: buyer1@usc.demo"}
            </div>
            {!autoLoginBusy ? (
              <button className="primary-button" type="button" onClick={() => setAutoLoginNonce((x) => x + 1)}>
                {"\u041f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u044c \u0432\u0445\u043e\u0434"}
              </button>
            ) : null}
          </div>
        </section>
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
        onLogoutAll={handleLogoutAll}
        onSwitchCompany={() => setCompanyPickerOpen(true)}
        companyName={currentCompanyName}
        role={appRole}
        onRoleChange={setAppRole}
        notificationCount={notificationCount}
        ratingValue={reputation.rating}
        reviewCount={reputation.reviews}
        completedOrders={reputation.completedOrders}
      />

      <main className={screensClassName}>
        <HomeScreen
          active={!screensLocked && activeTab === "home"}
          cartCount={cart.count}
          onBurger={openDrawer}
          onAdd={addToCart}
          showCompanyBanner={!!needsCompany}
          onPickCompany={() => setCompanyPickerOpen(true)}
          onCategoryChange={(nextCategory) => {
            if (nextCategory !== "meat") setHomeCategoryTouched(true);
          }}
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
          onboardingPromptEnabled={onboardingAiPromptMode}
          onOnboardingAnswerReady={setAiOnboardingAnswered}
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
          onCheckoutOpenChange={setCartCheckoutOpen}
          buyerCompanyId={companyId}
          onNotify={toast.show}
          onboardingDemoMode={onboardingCartDemoMode}
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
          role={appRole}
          companyId={companyId}
          showCompanyBanner={!!needsCompany}
          onPickCompany={() => setCompanyPickerOpen(true)}
          onNotify={toast.show}
        />

        <ProfileEditScreen
          active={drawerScreen === "profile-edit"}
          onBurger={openDrawer}
          onOpenNotifications={() => openDrawerScreen("notifications")}
          notificationCount={notificationCount}
          profile={profile}
          activeCompanyId={companyId}
          onNotify={toast.show}
          onSaved={(nextProfile) => {
            setProfile(nextProfile);
            setProfileNonce((x) => x + 1);
            if (companyId) {
              const company = nextProfile.companies.find((c) => c.company_id === companyId);
              if (company) localStorage.setItem("usc_company_name", company.name || "");
            }
          }}
        />

        <NotificationsScreen
          active={drawerScreen === "notifications"}
          onBurger={openDrawer}
          onOpenNotifications={() => openDrawerScreen("notifications")}
          notificationCount={notificationCount}
          role={appRole}
          onOpenOrder={openOrderFromNotification}
          onNotify={toast.show}
          onSessionExpired={handleSessionExpired}
          onUnreadCountChange={setNotificationCount}
        />

        <AboutScreen
          active={drawerScreen === "about"}
          onBurger={openDrawer}
          onOpenNotifications={() => openDrawerScreen("notifications")}
          notificationCount={notificationCount}
          onboardingReplayRequested={onboarding.replayRequested}
          onRequestOnboardingReplay={onboarding.requestReplay}
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
      <OnboardingOverlay
        visible={onboarding.isRunning}
        step={onboardingStep}
        stepIndex={onboarding.stepIndex}
        totalSteps={ONBOARDING_STEPS.length}
        canGoNext={onboardingCanGoNext}
        onBack={onboarding.back}
        onNext={onboarding.next}
        onSkip={onboarding.skip}
        onFinish={onboarding.finish}
        onTargetFoundChange={setTourTargetFound}
      />
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
