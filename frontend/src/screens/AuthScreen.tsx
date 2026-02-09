import { useEffect, useState } from "react";
import { login, registerEmail, requestEmailCode, requestPhoneCode, verifyPhoneCode } from "../api/auth";

type Role = "buyer" | "supplier";

const TEST_ACCOUNTS = [
  { email: "buyer1@usc.demo", password: "demo123456", role: "Покупатель", sales: 0, purchases: 1052 },
  { email: "buyer2@usc.demo", password: "demo123456", role: "Покупатель", sales: 0, purchases: 1141 },
  { email: "supplier1@usc.demo", password: "demo123456", role: "Поставщик", sales: 133, purchases: 0 },
  { email: "supplier2@usc.demo", password: "demo123456", role: "Поставщик", sales: 132, purchases: 0 },
  { email: "supplier3@usc.demo", password: "demo123456", role: "Поставщик", sales: 962, purchases: 0 },
  { email: "supplier4@usc.demo", password: "demo123456", role: "Поставщик", sales: 966, purchases: 0 },
] as const;

export default function AuthScreen({ onSuccess }: { onSuccess: () => void }) {
  const [method, setMethod] = useState<"email" | "phone">("email");
  const [emailMode, setEmailMode] = useState<"login" | "register">("login");
  const [role, setRole] = useState<Role>("buyer");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
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

  const passwordScore = (() => {
    let score = 0;
    if (password.length >= 8) score += 1;
    if (/[A-Z]/.test(password)) score += 1;
    if (/[a-z]/.test(password)) score += 1;
    if (/[0-9]/.test(password)) score += 1;
    if (/[^A-Za-z0-9]/.test(password)) score += 1;
    return score;
  })();

  const passwordLabel =
    passwordScore >= 4 ? "Сильный пароль" : passwordScore >= 3 ? "Нормальный пароль" : "Слабый пароль";

  const isEmailValid = (value: string) => /.+@.+\..+/.test(value.trim());
  const isPhoneValid = (value: string) => value.replace(/[^0-9+]/g, "").length >= 6;

  const resetCodes = () => {
    setCode("");
    setEmailCodeSent(false);
    setPhoneCodeSent(false);
  };

  const submitEmail = async () => {
    setMsg(null);
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedCode = code.trim();

    if (!normalizedEmail || !isEmailValid(normalizedEmail)) {
      setMsg("Введи корректный email");
      return;
    }
    if (!password) {
      setMsg("Введи пароль");
      return;
    }
    if (emailMode === "register" && (password.length < 6 || passwordScore < 3)) {
      setMsg("Пароль слишком слабый");
      return;
    }
    if (emailMode === "register" && !normalizedCode) {
      setMsg("Введи код из email");
      return;
    }

    try {
      setBusy(true);
      if (emailMode === "register") {
        await registerEmail({
          email: normalizedEmail,
          password,
          code: normalizedCode,
          phone,
          first_name: firstName,
          last_name: lastName,
          role,
        });
      }
      await login(normalizedEmail, password);
      onSuccess();
    } catch (e) {
      const text = String(e);
      if (text.includes("Invalid email")) setMsg("Некорректный email");
      else if (text.includes("Password too short")) setMsg("Пароль минимум 6 символов");
      else if (text.includes("Email code required")) setMsg("Требуется код из email");
      else if (text.includes("Code not requested")) setMsg("Сначала запроси код на email");
      else if (text.includes("Code expired")) setMsg("Код истек, запроси новый");
      else if (text.includes("Invalid code")) setMsg("Неверный код подтверждения");
      else if (text.includes("already exists")) setMsg("Такой аккаунт уже существует");
      else if (text.includes("401")) setMsg("Неверный email или пароль");
      else if (text.includes("422")) setMsg("Проверь данные и попробуй снова");
      else if (text.includes("Register failed. DB says:")) {
        const suffix = text.split("Register failed. DB says:")[1]?.trim();
        setMsg(suffix ? `DB: ${suffix}` : "Ошибка базы при регистрации");
      } else {
        setMsg(text);
      }
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  const sendEmailCode = async () => {
    setMsg(null);
    const e = email.trim().toLowerCase();
    if (!e || !isEmailValid(e)) {
      setMsg("Введи корректный email");
      return;
    }
    if (emailCooldown > 0) return;
    try {
      setBusy(true);
      const res = await requestEmailCode(e);
      if (res?.code) setMsg(`Код: ${res.code} (dev)`);
      setEmailCodeSent(true);
      setEmailCooldown(60);
    } catch (e) {
      setMsg("Не удалось отправить код");
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  const sendPhoneCode = async () => {
    setMsg(null);
    const p = phone.trim();
    if (!p || !isPhoneValid(p)) {
      setMsg("Введи корректный телефон");
      return;
    }
    if (phoneCooldown > 0) return;
    try {
      setBusy(true);
      const res = await requestPhoneCode(p);
      if (res?.code) setMsg(`Код: ${res.code} (dev)`);
      setPhoneCodeSent(true);
      setPhoneCooldown(60);
    } catch (e) {
      setMsg("Не удалось отправить код");
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  const verifyPhone = async () => {
    setMsg(null);
    if (!phone || !isPhoneValid(phone) || !code) {
      setMsg("Введи телефон и код");
      return;
    }
    try {
      setBusy(true);
      await verifyPhoneCode({
        phone: phone.trim(),
        code,
        email: email.trim().toLowerCase() || undefined,
        first_name: firstName,
        last_name: lastName,
        role,
      });
      onSuccess();
    } catch (e) {
      setMsg("Неверный код");
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
          <div className="auth-title">Вход в USC</div>
          <div className="auth-subtitle">Поставки. Быстро. Удобно.</div>
        </div>

        <div className={`auth-tabs ${method === "phone" ? "is-phone" : "is-email"}`}>
          <button
            type="button"
            className={`auth-tab ${method === "email" ? "active" : ""}`}
            onClick={() => {
              setMethod("email");
              resetCodes();
              setMsg(null);
            }}
          >
            Email + пароль
          </button>
          <button
            type="button"
            className={`auth-tab ${method === "phone" ? "active" : ""}`}
            onClick={() => {
              setMethod("phone");
              resetCodes();
              setMsg(null);
            }}
          >
            Телефон + код
          </button>
        </div>

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

        <div className={`auth-panels ${emailMode === "register" ? "tall" : ""}`}>
          <div className={`auth-panel ${method === "email" ? "active" : ""}`}>
            <div className="auth-row">
              <label>Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seller@usc.market"
              />
            </div>
            <div className="auth-row">
              <label>Пароль</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
              {emailMode === "register" && password.length > 0 && (
                <div className="pwd-meter">
                  <div className={`pwd-bar level-${Math.min(passwordScore, 5)}`} />
                  <div className="pwd-label">{passwordLabel}</div>
                </div>
              )}
            </div>

            {emailMode === "register" && (
              <>
                <div className="auth-row">
                  <label>Телефон (опционально)</label>
                  <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+996 ..." />
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
              </>
            )}

            {emailMode === "register" ? (
              <>
                {!emailCodeSent ? (
                  <button
                    className="primary-button"
                    type="button"
                    onClick={sendEmailCode}
                    disabled={busy || emailCooldown > 0}
                  >
                    {emailCooldown > 0 ? `Получить код (${emailCooldown}с)` : "Получить код"}
                  </button>
                ) : (
                  <>
                    <div className="auth-row">
                      <label>Код</label>
                      <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" />
                    </div>
                    <button className="primary-button" type="button" onClick={submitEmail} disabled={busy}>
                      Создать аккаунт
                    </button>
                  </>
                )}
                <button
                  className="auth-link"
                  type="button"
                  onClick={() => {
                    setEmailMode("login");
                    resetCodes();
                    setMsg(null);
                  }}
                >
                  Уже есть аккаунт? Войти
                </button>
              </>
            ) : (
              <div className="auth-actions">
                <button className="primary-button" type="button" onClick={submitEmail} disabled={busy}>
                  Войти
                </button>
                <button
                  className="auth-link"
                  type="button"
                  onClick={() => {
                    setEmailMode("register");
                    resetCodes();
                    setMsg(null);
                  }}
                >
                  Нет аккаунта? Регистрация
                </button>
              </div>
            )}
          </div>

          <div className={`auth-panel ${method === "phone" ? "active" : ""}`}>
            <div className="auth-row">
              <label>Телефон</label>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+996 ..." />
            </div>
            {!phoneCodeSent ? (
              <button
                className="primary-button"
                type="button"
                onClick={sendPhoneCode}
                disabled={busy || phoneCooldown > 0}
              >
                {phoneCooldown > 0 ? `Получить код (${phoneCooldown}с)` : "Получить код"}
              </button>
            ) : (
              <>
                <div className="auth-row">
                  <label>Код</label>
                  <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" />
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
                <div className="auth-row">
                  <label>Email (опционально)</label>
                  <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="seller@usc.market" />
                </div>
                <button className="primary-button" type="button" onClick={verifyPhone} disabled={busy}>
                  Войти
                </button>
              </>
            )}
          </div>
        </div>

        {msg && <div className="auth-msg">{msg}</div>}

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
      </div>
    </section>
  );
}


