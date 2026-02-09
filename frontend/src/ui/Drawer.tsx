import type { Screen } from "../types";

export function Drawer({
  open,
  onClose,
  onGo,
  onLogout,
  onSwitchCompany,
  companyName,
  role,
  notificationCount = 0,
  ratingValue = 4.8,
  reviewCount = 128,
  completedOrders = 96,
}: {
  open: boolean;
  onClose: () => void;
  onGo: (s: Screen) => void;
  onLogout: () => void;
  onSwitchCompany: () => void;
  companyName?: string | null;
  role?: string | null;
  notificationCount?: number;
  ratingValue?: number;
  reviewCount?: number;
  completedOrders?: number;
}) {
  const safeRating = Math.max(0, Math.min(5, ratingValue));

  return (
    <>
      <div className="overlay" style={{ display: open ? "block" : "none" }} onClick={onClose} />
      <aside className="drawer" style={{ transform: open ? "translateX(0)" : "translateX(-110%)" }}>
        <div className="drawer-top">
          <div className="drawer-header">
            <div className="drawer-avatar">
              <img src="/media/ava_burger.svg" alt="Профиль" id="drawer-avatar" />
            </div>
            <button className="drawer-close" onClick={onClose}>
              ×
            </button>
          </div>

          <div className="drawer-rating">
            <div className="stars">
              {Array.from({ length: 5 }, (_, idx) => {
                const fill = Math.max(0, Math.min(1, safeRating - idx));
                const steppedFillPct = Math.round(fill * 5) * 20;
                return (
                  <span key={idx} className="star-slot" aria-hidden="true">
                    <img className="star-base" src="/media/star_none.svg" alt="" />
                    <span className="star-fill" style={{ width: `${steppedFillPct}%` }}>
                      <img className="star-top" src="/media/star.svg" alt="" />
                    </span>
                  </span>
                );
              })}
            </div>
            <div className="drawer-rating-text" id="drawer-rating-text">
              {`${safeRating.toFixed(1)} · ${reviewCount} отзывов`}
            </div>
            <div className="drawer-score-row">
              <span className="drawer-score-pill">{`${completedOrders} заказов`}</span>
              <span className="drawer-score-pill drawer-score-pill-accent">{`${Math.max(94, Math.min(99, Math.round(safeRating * 20)))}% SLA`}</span>
            </div>
            {companyName && <div className="drawer-company">{companyName}</div>}
            {role && <div className="drawer-role">{role}</div>}
          </div>
        </div>

        <nav className="drawer-menu">
          <button className="drawer-link" onClick={() => (onGo("publications"), onClose())}>
            <img src="/media/your_publish.png" alt="" />
            <span>Ваши публикации</span>
          </button>

          <button className="drawer-link" onClick={() => (onGo("profile-edit"), onClose())}>
            <img src="/media/ava_burger1.svg" alt="" />
            <span>Редактирование профиля</span>
          </button>

          <button className="drawer-link" onClick={() => (onGo("orders"), onClose())}>
            <img src="/media/history.png" alt="" />
            <span>История заказов</span>
          </button>

          <button className="drawer-link" onClick={() => (onGo("deliveries"), onClose())}>
            <img src="/media/apple_car.svg" alt="" />
            <span>Доставки</span>
          </button>

          <button className="drawer-link" onClick={() => (onGo("notifications"), onClose())}>
            <img src="/media/notifications.png" alt="" />
            <span>Уведомления</span>
            <span className={`drawer-notification-badge ${notificationCount > 0 ? "show" : ""}`}>{notificationCount > 0 ? notificationCount : ""}</span>
          </button>

          <button className="drawer-link" onClick={() => (onGo("about"), onClose())}>
            <img src="/media/phone.png" alt="" />
            <span>О приложении</span>
          </button>

          <button className="drawer-link" onClick={() => (onGo("help"), onClose())}>
            <img src="/media/headphones.png" alt="" />
            <span>Помощь</span>
          </button>

          <button className="drawer-link" onClick={() => (onGo("faq"), onClose())}>
            <img src="/media/questions.png" alt="" />
            <span>Частые вопросы</span>
          </button>

          <button className="drawer-link" onClick={onSwitchCompany}>
            <img src="/media/ava_burger1.svg" alt="" />
            <span>Сменить компанию</span>
          </button>

          <button className="drawer-link drawer-logout" onClick={onLogout}>
            <img src="/media/icon.png" alt="" />
            <span>Выйти</span>
          </button>
        </nav>
      </aside>
    </>
  );
}
