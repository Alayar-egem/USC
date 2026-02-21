import { useEffect, useState } from "react";
import { login, registerEmail, requestEmailCode, requestPhoneCode, verifyPhoneCode } from "../api/auth";

type Role = "buyer" | "supplier";

type AuthMode = "login" | "register";

type LoginMethod = "email" | "phone";

const TEST_ACCOUNTS = [
  { email: "buyer1@usc.demo", password: "demo123456", role: "Покупатель", sales: 0, purchases: 1450 },
  { email: "buyer2@usc.demo", password: "demo123456", role: "Покупатель", sales: 0, purchases: 857 },
  { email: "supplier1@usc.demo", password: "demo123456", role: "Поставщик", sales: 133, purchases: 0 },
  { email: "supplier2@usc.demo", password: "demo123456", role: "Поставщик", sales: 132, purchases: 0 },
  { email: "supplier3@usc.demo", password: "demo123456", role: "Поставщик", sales: 962, purchases: 0 },
  { email: "supplier4@usc.demo", password: "demo123456", role: "Поставщик", sales: 966, purchases: 0 },
] as const;

export default function AuthScreen({ onSuccess }: { onSuccess: () => void }) {
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [method, setMethod] = useState<LoginMethod>("email");
  const [role, setRole] = useState<Role>("buyer");

  const [loginEmailValue, setLoginEmailValue] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginPhone, setLoginPhone] = useState("");
  const [loginPhoneCode, setLoginPhoneCode] = useState("");

  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regPhone, setRegPhone] = useState("");
  const [regCode, setRegCode] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [emailCodeSent, setEmailCodeSent] = useState(false);
  const [phoneCodeSent, setPhoneCodeSent] = useState(false);
  const [emailCooldown, setEmailCooldown] = useState(0);
  const [phoneCooldown, setPhoneCooldown] = useState(0);

  useEffect(() => {
    if (emailCooldown <= 0) return;
    const t = setInterval(() => setEmailCooldown((x) => (x > 0 ? x - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [emailCooldown]);

  useEffect(() => {
    if (phoneCooldown <= 0) return;
    const t = setInterval(() => setPhoneCooldown((x) => (x > 0 ? x - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [phoneCooldown]);

  useEffect(() => {
    setMsg(null);
    if (authMode === "register") {
      setMethod("email");
      setPhoneCodeSent(false);
      setLoginPhoneCode("");
    } else {
      setEmailCodeSent(false);
      setRegCode("");
    }
  }, [authMode]);

  const passwordScore = (() => {
    let score = 0;
    if (regPassword.length >= 8) score += 1;
    if (/[A-Z]/.test(regPassword)) score += 1;
    if (/[a-z]/.test(regPassword)) score += 1;
    if (/[0-9]/.test(regPassword)) score += 1;
    if (/[^A-Za-z0-9]/.test(regPassword)) score += 1;
    return score;
  })();

  const passwordLabel =
    passwordScore >= 4 ? "Сильный пароль" : passwordScore >= 3 ? "Нормальный пароль" : "Слабый пароль";

  const isEmailValid = (value: string) => /.+@.+\..+/.test(value.trim());
  const isPhoneValid = (value: string) => value.replace(/[^0-9+]/g, "").length >= 6;

  const mapError = (e: unknown) => {
    const text = String(e);
    if (text.includes("Invalid email")) return "Некорректный email";
    if (text.includes("Password too short")) return "Пароль минимум 6 символов";
    if (text.includes("Email code required")) return "Требуется код из email";
    if (text.includes("Code not requested")) return "Сначала запросите код на email";
    if (text.includes("Code expired")) return "Код истек, запросите новый";
    if (text.includes("Invalid code")) return "Неверный код подтверждения";
    if (text.includes("already exists")) return "Такой аккаунт уже существует";
    if (text.includes("Failed to send email code")) return "Не удалось отправить код на почту";
    if (text.includes("Email provider is not configured")) return "Почтовый сервис не настроен";
    if (text.includes("401")) return "Неверный email или пароль";
    if (text.includes("422")) return "Проверьте данные и попробуйте снова";
    if (text.includes("Register failed. DB says:")) {
      const suffix = text.split("Register failed. DB says:")[1]?.trim();
      return suffix ? `DB: ${suffix}` : "Ошибка базы при регистрации";
    }
    return text;
  };

  const submitLoginEmail = async () => {
    setMsg(null);
    const email = loginEmailValue.trim().toLowerCase();
    if (!email || !isEmailValid(email)) {
      setMsg("Введите корректный email");
      return;
    }
    if (!loginPassword) {
      setMsg("Введите пароль");
      return;
    }

    try {
      setBusy(true);
      await login(email, loginPassword);
      onSuccess();
    } catch (e) {
      setMsg(mapError(e));
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  const sendPhoneLoginCode = async () => {
    setMsg(null);
    const phone = loginPhone.trim();
    if (!phone || !isPhoneValid(phone)) {
      setMsg("Введите корректный телефон");
      return;
    }
    if (phoneCooldown > 0) return;

    try {
      setBusy(true);
      const res = await requestPhoneCode(phone);
      if (res?.code) setMsg(`Код: ${res.code} (dev)`);
      else setMsg("Код отправлен");
      setPhoneCodeSent(true);
      setPhoneCooldown(60);
    } catch (e) {
      setMsg("Не удалось отправить код");
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  const verifyPhoneLoginCode = async () => {
    setMsg(null);
    if (!loginPhone || !isPhoneValid(loginPhone) || !loginPhoneCode.trim()) {
      setMsg("Введите телефон и код");
      return;
    }

    try {
      setBusy(true);
      await verifyPhoneCode({
        phone: loginPhone.trim(),
        code: loginPhoneCode.trim(),
      });
      onSuccess();
    } catch (e) {
      setMsg(mapError(e));
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  const sendRegisterEmailCode = async () => {
    setMsg(null);
    const email = regEmail.trim().toLowerCase();
    if (!email || !isEmailValid(email)) {
      setMsg("Введите корректный email");
      return;
    }
    if (emailCooldown > 0) return;

    try {
      setBusy(true);
      const res = await requestEmailCode(email);
      if (res?.code) setMsg(`Код: ${res.code} (dev)`);
      else setMsg("Код отправлен на email");
      setEmailCodeSent(true);
      setEmailCooldown(60);
    } catch (e) {
      setMsg(mapError(e));
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  const submitRegisterEmail = async () => {
    setMsg(null);
    const email = regEmail.trim().toLowerCase();
    const code = regCode.trim();

    if (!email || !isEmailValid(email)) {
      setMsg("Введите корректный email");
      return;
    }
    if (!regPassword) {
      setMsg("Введите пароль");
      return;
    }
    if (regPassword.length < 6 || passwordScore < 3) {
      setMsg("Пароль слишком слабый");
      return;
    }
    if (!code) {
      setMsg("Введите код из email");
      return;
    }

    try {
      setBusy(true);
      await registerEmail({
        email,
        password: regPassword,
        code,
        phone: regPhone,
        first_name: firstName,
        last_name: lastName,
        role,
      });
      await login(email, regPassword);
      onSuccess();
    } catch (e) {
      setMsg(mapError(e));
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="auth-screen">
      <div className="auth-card">
        <div className="auth-header">
          <img src="/media/usc.svg" alt="USC" className="auth-logo" />
          <div className="auth-title">{authMode === "login" ? "Вход в USC" : "Регистрация в USC"}</div>
          <div className="auth-subtitle">
            {authMode === "login" ? "Войдите в аккаунт компании" : "Создайте аккаунт и подтвердите email кодом"}
          </div>
        </div>

        <div className={`auth-mode-tabs ${authMode === "register" ? "is-register" : "is-login"}`}>
          <button type="button" className={`auth-mode-tab ${authMode === "login" ? "active" : ""}`} onClick={() => setAuthMode("login")}>
            Вход
          </button>
          <button
            type="button"
            className={`auth-mode-tab ${authMode === "register" ? "active" : ""}`}
            onClick={() => setAuthMode("register")}
          >
            Регистрация
          </button>
        </div>

        {authMode === "login" ? (
          <>
            <div className={`auth-tabs ${method === "phone" ? "is-phone" : "is-email"}`}>
              <button type="button" className={`auth-tab ${method === "email" ? "active" : ""}`} onClick={() => setMethod("email")}>
                Email + пароль
              </button>
              <button type="button" className={`auth-tab ${method === "phone" ? "active" : ""}`} onClick={() => setMethod("phone")}>
                Телефон + код
              </button>
            </div>

            <div className={`auth-panels ${method === "phone" && phoneCodeSent ? "tall" : ""}`}>
              <div className={`auth-panel ${method === "email" ? "active" : ""}`}>
                <div className="auth-row">
                  <label>Email</label>
                  <input
                    type="email"
                    value={loginEmailValue}
                    onChange={(e) => setLoginEmailValue(e.target.value)}
                    placeholder="seller@usc.market"
                  />
                </div>
                <div className="auth-row">
                  <label>Пароль</label>
                  <input
                    type="password"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                </div>
                <button className="primary-button" type="button" onClick={submitLoginEmail} disabled={busy}>
                  Войти
                </button>
              </div>

              <div className={`auth-panel ${method === "phone" ? "active" : ""}`}>
                <div className="auth-row">
                  <label>Телефон</label>
                  <input
                    type="tel"
                    value={loginPhone}
                    onChange={(e) => setLoginPhone(e.target.value)}
                    placeholder="+996 ..."
                  />
                </div>
                {!phoneCodeSent ? (
                  <button
                    className="primary-button"
                    type="button"
                    onClick={sendPhoneLoginCode}
                    disabled={busy || phoneCooldown > 0}
                  >
                    {phoneCooldown > 0 ? `Получить код (${phoneCooldown}с)` : "Получить код"}
                  </button>
                ) : (
                  <>
                    <div className="auth-row">
                      <label>Код</label>
                      <input
                        value={loginPhoneCode}
                        onChange={(e) => setLoginPhoneCode(e.target.value)}
                        placeholder="123456"
                      />
                    </div>
                    <button className="primary-button" type="button" onClick={verifyPhoneLoginCode} disabled={busy}>
                      Войти
                    </button>
                  </>
                )}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="auth-row">
              <label>Роль</label>
              <div className="auth-seg">
                <button type="button" className={role === "buyer" ? "active" : ""} onClick={() => setRole("buyer")}>
                  Покупатель
                </button>
                <button type="button" className={role === "supplier" ? "active" : ""} onClick={() => setRole("supplier")}>
                  Поставщик
                </button>
              </div>
            </div>

            <div className="auth-body">
              <div className="auth-row">
                <label>Email</label>
                <input type="email" value={regEmail} onChange={(e) => setRegEmail(e.target.value)} placeholder="seller@usc.market" />
              </div>
              <div className="auth-row">
                <label>Пароль</label>
                <input
                  type="password"
                  value={regPassword}
                  onChange={(e) => setRegPassword(e.target.value)}
                  placeholder="••••••••"
                />
                {regPassword.length > 0 && (
                  <div className="pwd-meter">
                    <div className={`pwd-bar level-${Math.min(passwordScore, 5)}`} />
                    <div className="pwd-label">{passwordLabel}</div>
                  </div>
                )}
              </div>
              <div className="auth-row">
                <label>Телефон (опционально)</label>
                <input type="tel" value={regPhone} onChange={(e) => setRegPhone(e.target.value)} placeholder="+996 ..." />
              </div>
              <div className="auth-row split">
                <div className="auth-col">
                  <label>Имя</label>
                  <input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                </div>
                <div className="auth-col">
                  <label>Фамилия</label>
                  <input value={lastName} onChange={(e) => setLastName(e.target.value)} />
                </div>
              </div>

              {!emailCodeSent ? (
                <button
                  className="primary-button"
                  type="button"
                  onClick={sendRegisterEmailCode}
                  disabled={busy || emailCooldown > 0}
                >
                  {emailCooldown > 0 ? `Получить код (${emailCooldown}с)` : "Получить код на email"}
                </button>
              ) : (
                <>
                  <div className="auth-row">
                    <label>Код подтверждения</label>
                    <input value={regCode} onChange={(e) => setRegCode(e.target.value)} placeholder="123456" />
                  </div>
                  <button className="primary-button" type="button" onClick={submitRegisterEmail} disabled={busy}>
                    Создать аккаунт
                  </button>
                  <button className="auth-link" type="button" onClick={sendRegisterEmailCode} disabled={busy || emailCooldown > 0}>
                    {emailCooldown > 0 ? `Отправить код повторно (${emailCooldown}с)` : "Отправить код повторно"}
                  </button>
                </>
              )}
            </div>
          </>
        )}

        {msg && <div className="auth-msg">{msg}</div>}

        {authMode === "login" ? (
          <div className="auth-test-box">
            <div className="auth-test-title">Тестовые аккаунты (временно)</div>
            <div className="auth-test-subtitle">Для быстрого входа и проверки аналитики. Потом удалим.</div>
            <div className="auth-test-list">
              {TEST_ACCOUNTS.map((x) => (
                <div key={x.email} className="auth-test-item">
                  <div className="auth-test-main">
                    <div className="auth-test-email">{x.email}</div>
                    <div className="auth-test-pass">{`Пароль: ${x.password}`}</div>
                  </div>
                  <div className="auth-test-meta">
                    <span>{x.role}</span>
                    <span>{`Продажи: ${x.sales}`}</span>
                    {x.purchases > 0 ? <span>{`Покупки: ${x.purchases}`}</span> : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
