import { useState, type ChangeEvent } from "react";
import SecondaryTopbar from "../ui/SecondaryTopbar";
import type { ToastTone } from "../hooks/useToast";

type EditForm = {
  accountName: string;
  email: string;
  phone: string;
  warehouseAddress: string;
};

function formatPhoneKg(value: string): string {
  const digits = value.replace(/\D/g, "");
  let local = digits;
  if (local.startsWith("996")) {
    local = local.slice(3);
  } else if (value.trim().startsWith("+") && local.length <= 2) {
    // If user backspaces the country code itself (e.g. "+99"), keep only the default prefix.
    local = "";
  }
  local = local.slice(0, 9);
  const groups = local.match(/.{1,3}/g) ?? [];
  return `+996${groups.length ? ` ${groups.join(" ")}` : ""}`;
}

export default function ProfileEditScreen({
  active,
  onBurger,
  onOpenNotifications,
  notificationCount,
  onNotify,
}: {
  active: boolean;
  onBurger: () => void;
  onOpenNotifications?: () => void;
  notificationCount?: number;
  onNotify?: (message: string, tone?: ToastTone) => void;
}) {
  const [form, setForm] = useState<EditForm>({
    accountName: "USC Premium Seller",
    email: "seller@usc.market",
    phone: "+996 500 000 000",
    warehouseAddress: "Бишкек, Медерова 161а",
  });

  const initials = form.accountName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x[0]?.toUpperCase())
    .join("");

  const onChange = (key: keyof EditForm) => (e: ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [key]: e.target.value }));
  };

  const onPhoneChange = (e: ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, phone: formatPhoneKg(e.target.value) }));
  };

  return (
    <section id="screen-profile-edit" className={`screen ${active ? "active" : ""}`}>
      <SecondaryTopbar onBurger={onBurger} onNotifications={onOpenNotifications} notificationCount={notificationCount} />

      <header className="simple-header">
        <div className="simple-title">Редактирование профиля</div>
      </header>

      <div className="profile-edit-hero">
        <div className="profile-edit-avatar">{initials || "US"}</div>
        <div className="profile-edit-hero-main">
          <div className="profile-edit-hero-title">Личный кабинет поставщика</div>
          <div className="profile-edit-hero-subtitle">Обновите контактные данные и адрес склада, чтобы заказы и доставки работали корректно.</div>
        </div>
      </div>

      <form
        className="profile-edit-form"
        onSubmit={(e) => {
          e.preventDefault();
          onNotify?.("Профиль сохранен", "success");
        }}
      >
        <div className="profile-edit-grid">
          <label className="profile-edit-field">
            <span className="profile-edit-label">Название аккаунта</span>
            <div className="profile-edit-input-wrap">
              <span className="profile-edit-icon">A</span>
              <input type="text" value={form.accountName} onChange={onChange("accountName")} />
            </div>
          </label>

          <label className="profile-edit-field">
            <span className="profile-edit-label">Email</span>
            <div className="profile-edit-input-wrap">
              <span className="profile-edit-icon">@</span>
              <input type="email" value={form.email} onChange={onChange("email")} />
            </div>
          </label>

          <label className="profile-edit-field">
            <span className="profile-edit-label">Телефон</span>
            <div className="profile-edit-input-wrap">
              <span className="profile-edit-icon">#</span>
              <input
                type="tel"
                inputMode="numeric"
                value={form.phone}
                onChange={onPhoneChange}
                onFocus={() => {
                  setForm((prev) => ({ ...prev, phone: formatPhoneKg(prev.phone) }));
                }}
              />
            </div>
          </label>

          <label className="profile-edit-field">
            <span className="profile-edit-label">Адрес склада</span>
            <div className="profile-edit-input-wrap">
              <span className="profile-edit-icon">+</span>
              <input type="text" value={form.warehouseAddress} onChange={onChange("warehouseAddress")} />
            </div>
          </label>
        </div>

        <div className="profile-edit-foot">
          <div className="profile-edit-hint">Изменения сохраняются для текущего профиля компании.</div>
          <button className="primary-button profile-edit-submit" type="submit">
            Сохранить изменения
          </button>
        </div>
      </form>
    </section>
  );
}
