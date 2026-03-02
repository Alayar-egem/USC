import { useEffect, useState } from "react";
import { login, registerEmail, requestEmailCode, requestPhoneCode, verifyPhoneCode } from "../api/auth";
import { logger } from "../utils/logger";

type Role = "buyer" | "supplier";

type AuthMode = "login" | "register";

type LoginMethod = "email" | "phone";

type AuthErrorDetail = {
  reason_code?: string;
  captcha_required?: boolean;
  lockout_seconds?: number;
};

const TEST_ACCOUNTS = [
  { email: "buyer1@usc.demo", password: "demo123456", role: "–ü–æ–∫—É–ø–∞—Ç–µ–ª—å", sales: 0, purchases: 1450 },
  { email: "buyer2@usc.demo", password: "demo123456", role: "–ü–æ–∫—É–ø–∞—Ç–µ–ª—å", sales: 0, purchases: 857 },
  { email: "supplier1@usc.demo", password: "demo123456", role: "–ü–æ—Å—Ç–∞–≤—â–∏–∫", sales: 133, purchases: 0 },
  { email: "supplier2@usc.demo", password: "demo123456", role: "–ü–æ—Å—Ç–∞–≤—â–∏–∫", sales: 132, purchases: 0 },
  { email: "supplier3@usc.demo", password: "demo123456", role: "–ü–æ—Å—Ç–∞–≤—â–∏–∫", sales: 962, purchases: 0 },
  { email: "supplier4@usc.demo", password: "demo123456", role: "–ü–æ—Å—Ç–∞–≤—â–∏–∫", sales: 966, purchases: 0 },
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
  const [captchaRequired, setCaptchaRequired] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const [lockoutSeconds, setLockoutSeconds] = useState(0);

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
    if (lockoutSeconds <= 0) return;
    const t = setInterval(() => setLockoutSeconds((x) => (x > 0 ? x - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [lockoutSeconds]);

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
    passwordScore >= 4 ? "–°–∏–ª—å–Ω—ã–π –ø–∞—Ä–æ–ª—å" : passwordScore >= 3 ? "–ù–æ—Ä–º–∞–ª—å–Ω—ã–π –ø–∞—Ä–æ–ª—å" : "–°–ª–∞–±—ã–π –ø–∞—Ä–æ–ª—å";

  const isEmailValid = (value: string) => /.+@.+\..+/.test(value.trim());
  const isPhoneValid = (value: string) => value.replace(/[^0-9+]/g, "").length >= 6;

    const mapError = (e: unknown) => {
    const text = String(e);
    let parsed: AuthErrorDetail | null = null;
    const payloadStart = text.indexOf("{");
    if (payloadStart >= 0) {
      try {
        parsed = JSON.parse(text.slice(payloadStart)) as AuthErrorDetail;
      } catch {
        parsed = null;
      }
    }

    if (parsed?.lockout_seconds && parsed.lockout_seconds > 0) setLockoutSeconds(parsed.lockout_seconds);
    if (parsed?.captcha_required) setCaptchaRequired(true);
    if (parsed?.reason_code === "locked_out") return "—ÎË¯ÍÓÏ ÏÌÓ„Ó ÔÓÔ˚ÚÓÍ. ¿ÍÍ‡ÛÌÚ ‚ÂÏÂÌÌÓ Á‡·ÎÓÍËÓ‚‡Ì.";
    if (parsed?.reason_code === "captcha_required") return "“Â·ÛÂÚÒˇ captcha-ÔÓ‚ÂÍ‡.";
    if (parsed?.reason_code === "rate_limited") return "—ÎË¯ÍÓÏ ÏÌÓ„Ó Á‡ÔÓÒÓ‚. œÓÔÓ·ÛÈÚÂ ÔÓÁÊÂ.";

    if (text.includes("Invalid email")) return "ÕÂÍÓÂÍÚÌ˚È email";
    if (text.includes("Password too short")) return "œ‡ÓÎ¸ ÏËÌËÏÛÏ 6 ÒËÏ‚ÓÎÓ‚";
    if (text.includes("Email code required")) return "“Â·ÛÂÚÒˇ ÍÓ‰ ËÁ email";
    if (text.includes("Code not requested")) return "—Ì‡˜‡Î‡ Á‡ÔÓÒËÚÂ ÍÓ‰ Ì‡ email";
    if (text.includes("Code expired")) return " Ó‰ ËÒÚÂÍ, Á‡ÔÓÒËÚÂ ÌÓ‚˚È";
    if (text.includes("Invalid code")) return "ÕÂ‚ÂÌ˚È ÍÓ‰ ÔÓ‰Ú‚ÂÊ‰ÂÌËˇ";
    if (text.includes("already exists")) return "“‡ÍÓÈ ‡ÍÍ‡ÛÌÚ ÛÊÂ ÒÛ˘ÂÒÚ‚ÛÂÚ";
    if (text.includes("Failed to send email code")) return "ÕÂ Û‰‡ÎÓÒ¸ ÓÚÔ‡‚ËÚ¸ ÍÓ‰ Ì‡ ÔÓ˜ÚÛ";
    if (text.includes("Email provider is not configured")) return "œÓ˜ÚÓ‚˚È ÒÂ‚ËÒ ÌÂ Ì‡ÒÚÓÂÌ";
    if (text.includes("401")) return "ÕÂ‚ÂÌ˚È email ËÎË Ô‡ÓÎ¸";
    if (text.includes("422")) return "œÓ‚Â¸ÚÂ ‰‡ÌÌ˚Â Ë ÔÓÔÓ·ÛÈÚÂ ÒÌÓ‚‡";
    if (text.includes("Register failed. DB says:")) {
      const suffix = text.split("Register failed. DB says:")[1]?.trim();
      return suffix ? `DB: ${suffix}` : "Œ¯Ë·Í‡ ·‡Á˚ ÔË Â„ËÒÚ‡ˆËË";
    }
    return text;
  };

  const submitLoginEmail = async () => {
    setMsg(null);
    if (lockoutSeconds > 0) {
      setMsg(`œÓ‚ÚÓËÚÂ ˜ÂÂÁ ${lockoutSeconds} ÒÂÍ`);
      return;
    }
    if (captchaRequired && !captchaToken.trim()) {
      setMsg("¬‚Â‰ËÚÂ captcha token");
      return;
    }
    const email = loginEmailValue.trim().toLowerCase();
    if (!email || !isEmailValid(email)) {
      setMsg("–í–≤–µ–¥–∏—Ç–µ –∫–æ—Ä—Ä–µ–∫—Ç–Ω—ã–π email");
      return;
    }
    if (!loginPassword) {
      setMsg("–í–≤–µ–¥–∏—Ç–µ –ø–∞—Ä–æ–ª—å");
      return;
    }

    try {
      setBusy(true);
      await login(email, loginPassword, captchaRequired ? captchaToken.trim() : undefined);
      setCaptchaRequired(false);
      setCaptchaToken("");
      setLockoutSeconds(0);
      onSuccess();
    } catch (e) {
      setMsg(mapError(e));
      logger.error(e);
    } finally {
      setBusy(false);
    }
  };

  const sendPhoneLoginCode = async () => {
    setMsg(null);
    const phone = loginPhone.trim();
    if (!phone || !isPhoneValid(phone)) {
      setMsg("–í–≤–µ–¥–∏—Ç–µ –∫–æ—Ä—Ä–µ–∫—Ç–Ω—ã–π —Ç–µ–ª–µ—Ñ–æ–Ω");
      return;
    }
    if (phoneCooldown > 0) return;

    try {
      setBusy(true);
      const res = await requestPhoneCode(phone);
      if (res?.code) setMsg(`–ö–æ–¥: ${res.code} (dev)`);
      else setMsg("–ö–æ–¥ –æ—Ç–ø—Ä–∞–≤–ª–µ–Ω");
      setPhoneCodeSent(true);
      setPhoneCooldown(60);
    } catch (e) {
      setMsg("–ù–µ —É–¥–∞–ª–æ—Å—å –æ—Ç–ø—Ä–∞–≤–∏—Ç—å –∫–æ–¥");
      logger.error(e);
    } finally {
      setBusy(false);
    }
  };

  const verifyPhoneLoginCode = async () => {
    setMsg(null);
    if (lockoutSeconds > 0) {
      setMsg(`œÓ‚ÚÓËÚÂ ˜ÂÂÁ ${lockoutSeconds} ÒÂÍ`);
      return;
    }
    if (captchaRequired && !captchaToken.trim()) {
      setMsg("¬‚Â‰ËÚÂ captcha token");
      return;
    }
    if (!loginPhone || !isPhoneValid(loginPhone) || !loginPhoneCode.trim()) {
      setMsg("–í–≤–µ–¥–∏—Ç–µ —Ç–µ–ª–µ—Ñ–æ–Ω –∏ –∫–æ–¥");
      return;
    }

    try {
      setBusy(true);
      await verifyPhoneCode({
        phone: loginPhone.trim(),
        code: loginPhoneCode.trim(),
        captcha_token: captchaRequired ? captchaToken.trim() : undefined,
      });
      setCaptchaRequired(false);
      setCaptchaToken("");
      setLockoutSeconds(0);
      onSuccess();
    } catch (e) {
      setMsg(mapError(e));
      logger.error(e);
    } finally {
      setBusy(false);
    }
  };

  const sendRegisterEmailCode = async () => {
    setMsg(null);
    const email = regEmail.trim().toLowerCase();
    if (!email || !isEmailValid(email)) {
      setMsg("–í–≤–µ–¥–∏—Ç–µ –∫–æ—Ä—Ä–µ–∫—Ç–Ω—ã–π email");
      return;
    }
    if (emailCooldown > 0) return;

    try {
      setBusy(true);
      const res = await requestEmailCode(email);
      if (res?.code) setMsg(`–ö–æ–¥: ${res.code} (dev)`);
      else setMsg("–ö–æ–¥ –æ—Ç–ø—Ä–∞–≤–ª–µ–Ω –Ω–∞ email");
      setEmailCodeSent(true);
      setEmailCooldown(60);
    } catch (e) {
      setMsg(mapError(e));
      logger.error(e);
    } finally {
      setBusy(false);
    }
  };

  const submitRegisterEmail = async () => {
    setMsg(null);
    const email = regEmail.trim().toLowerCase();
    const code = regCode.trim();

    if (!email || !isEmailValid(email)) {
      setMsg("–í–≤–µ–¥–∏—Ç–µ –∫–æ—Ä—Ä–µ–∫—Ç–Ω—ã–π email");
      return;
    }
    if (!regPassword) {
      setMsg("–í–≤–µ–¥–∏—Ç–µ –ø–∞—Ä–æ–ª—å");
      return;
    }
    if (regPassword.length < 6 || passwordScore < 3) {
      setMsg("–ü–∞—Ä–æ–ª—å —Å–ª–∏—à–∫–æ–º —Å–ª–∞–±—ã–π");
      return;
    }
    if (!code) {
      setMsg("–í–≤–µ–¥–∏—Ç–µ –∫–æ–¥ –∏–∑ email");
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
      logger.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="auth-screen">
      <div className="auth-card">
        <div className="auth-header">
          <img src="/media/usc.svg" alt="USC" className="auth-logo" />
          <div className="auth-title">{authMode === "login" ? "–í—Ö–æ–¥ –≤ USC" : "–†–µ–≥–∏—Å—Ç—Ä–∞—Ü–∏—è –≤ USC"}</div>
          <div className="auth-subtitle">
            {authMode === "login" ? "–í–æ–π–¥–∏—Ç–µ –≤ –∞–∫–∫–∞—É–Ω—Ç –∫–æ–º–ø–∞–Ω–∏–∏" : "–°–æ–∑–¥–∞–π—Ç–µ –∞–∫–∫–∞—É–Ω—Ç –∏ –ø–æ–¥—Ç–≤–µ—Ä–¥–∏—Ç–µ email –∫–æ–¥–æ–º"}
          </div>
        </div>

        <div className={`auth-mode-tabs ${authMode === "register" ? "is-register" : "is-login"}`}>
          <button type="button" className={`auth-mode-tab ${authMode === "login" ? "active" : ""}`} onClick={() => setAuthMode("login")}>
            –í—Ö–æ–¥
          </button>
          <button
            type="button"
            className={`auth-mode-tab ${authMode === "register" ? "active" : ""}`}
            onClick={() => setAuthMode("register")}
          >
            –†–µ–≥–∏—Å—Ç—Ä–∞—Ü–∏—è
          </button>
        </div>

        {authMode === "login" ? (
          <>
            <div className={`auth-tabs ${method === "phone" ? "is-phone" : "is-email"}`}>
              <button type="button" className={`auth-tab ${method === "email" ? "active" : ""}`} onClick={() => setMethod("email")}>
                Email + –ø–∞—Ä–æ–ª—å
              </button>
              <button type="button" className={`auth-tab ${method === "phone" ? "active" : ""}`} onClick={() => setMethod("phone")}>
                –¢–µ–ª–µ—Ñ–æ–Ω + –∫–æ–¥
              </button>
            </div>

            <div className={`auth-panels ${method === "phone" && phoneCodeSent ? "tall" : ""}`}>
              <div className={`auth-panel ${method === "email" ? "active" : ""}`}>
                <div className="auth-row">
                  <label>Email</label>
                  <input
                    data-testid="auth-login-email"
                    type="email"
                    value={loginEmailValue}
                    onChange={(e) => setLoginEmailValue(e.target.value)}
                    placeholder="seller@usc.market"
                  />
                </div>
                <div className="auth-row">
                  <label>–ü–∞—Ä–æ–ª—å</label>
                  <input
                    data-testid="auth-login-password"
                    type="password"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="‚Ä¢‚Ä¢‚Ä¢‚Ä¢‚Ä¢‚Ä¢‚Ä¢‚Ä¢"
                  />
                </div>
                                {captchaRequired && (
                  <div className="auth-row">
                    <label>Captcha token</label>
                    <input
                      type="text"
                      value={captchaToken}
                      onChange={(e) => setCaptchaToken(e.target.value)}
                      placeholder="pass-captcha"
                    />
                  </div>
                )}
                {lockoutSeconds > 0 && <div className="auth-msg">{`¡ÎÓÍËÓ‚Í‡: ${lockoutSeconds} ÒÂÍ`}</div>}
                <button
                  className="primary-button"
                  data-testid="auth-login-submit"
                  type="button"
                  onClick={submitLoginEmail}
                  disabled={busy}
                >
                  –í–æ–π—Ç–∏
                </button>
              </div>

              <div className={`auth-panel ${method === "phone" ? "active" : ""}`}>
                <div className="auth-row">
                  <label>–¢–µ–ª–µ—Ñ–æ–Ω</label>
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
                    {phoneCooldown > 0 ? `–ü–æ–ª—É—á–∏—Ç—å –∫–æ–¥ (${phoneCooldown}—Å)` : "–ü–æ–ª—É—á–∏—Ç—å –∫–æ–¥"}
                  </button>
                ) : (
                  <>
                    <div className="auth-row">
                      <label>–ö–æ–¥</label>
                      <input
                        value={loginPhoneCode}
                        onChange={(e) => setLoginPhoneCode(e.target.value)}
                        placeholder="123456"
                      />
                    </div>
                                        {captchaRequired && (
                      <div className="auth-row">
                        <label>Captcha token</label>
                        <input
                          type="text"
                          value={captchaToken}
                          onChange={(e) => setCaptchaToken(e.target.value)}
                          placeholder="pass-captcha"
                        />
                      </div>
                    )}
                    {lockoutSeconds > 0 && <div className="auth-msg">{`¡ÎÓÍËÓ‚Í‡: ${lockoutSeconds} ÒÂÍ`}</div>}
                    <button className="primary-button" type="button" onClick={verifyPhoneLoginCode} disabled={busy}>
                      –í–æ–π—Ç–∏
                    </button>
                  </>
                )}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="auth-row">
              <label>–†–æ–ª—å</label>
              <div className="auth-seg">
                <button type="button" className={role === "buyer" ? "active" : ""} onClick={() => setRole("buyer")}>
                  –ü–æ–∫—É–ø–∞—Ç–µ–ª—å
                </button>
                <button type="button" className={role === "supplier" ? "active" : ""} onClick={() => setRole("supplier")}>
                  –ü–æ—Å—Ç–∞–≤—â–∏–∫
                </button>
              </div>
            </div>

            <div className="auth-body">
              <div className="auth-row">
                <label>Email</label>
                <input type="email" value={regEmail} onChange={(e) => setRegEmail(e.target.value)} placeholder="seller@usc.market" />
              </div>
              <div className="auth-row">
                <label>–ü–∞—Ä–æ–ª—å</label>
                <input
                  type="password"
                  value={regPassword}
                  onChange={(e) => setRegPassword(e.target.value)}
                  placeholder="‚Ä¢‚Ä¢‚Ä¢‚Ä¢‚Ä¢‚Ä¢‚Ä¢‚Ä¢"
                />
                {regPassword.length > 0 && (
                  <div className="pwd-meter">
                    <div className={`pwd-bar level-${Math.min(passwordScore, 5)}`} />
                    <div className="pwd-label">{passwordLabel}</div>
                  </div>
                )}
              </div>
              <div className="auth-row">
                <label>–¢–µ–ª–µ—Ñ–æ–Ω (–æ–ø—Ü–∏–æ–Ω–∞–ª—å–Ω–æ)</label>
                <input type="tel" value={regPhone} onChange={(e) => setRegPhone(e.target.value)} placeholder="+996 ..." />
              </div>
              <div className="auth-row split">
                <div className="auth-col">
                  <label>–ò–º—è</label>
                  <input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                </div>
                <div className="auth-col">
                  <label>–§–∞–º–∏–ª–∏—è</label>
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
                  {emailCooldown > 0 ? `–ü–æ–ª—É—á–∏—Ç—å –∫–æ–¥ (${emailCooldown}—Å)` : "–ü–æ–ª—É—á–∏—Ç—å –∫–æ–¥ –Ω–∞ email"}
                </button>
              ) : (
                <>
                  <div className="auth-row">
                    <label>–ö–æ–¥ –ø–æ–¥—Ç–≤–µ—Ä–∂–¥–µ–Ω–∏—è</label>
                    <input value={regCode} onChange={(e) => setRegCode(e.target.value)} placeholder="123456" />
                  </div>
                  <button className="primary-button" type="button" onClick={submitRegisterEmail} disabled={busy}>
                    –°–æ–∑–¥–∞—Ç—å –∞–∫–∫–∞—É–Ω—Ç
                  </button>
                  <button className="auth-link" type="button" onClick={sendRegisterEmailCode} disabled={busy || emailCooldown > 0}>
                    {emailCooldown > 0 ? `–û—Ç–ø—Ä–∞–≤–∏—Ç—å –∫–æ–¥ –ø–æ–≤—Ç–æ—Ä–Ω–æ (${emailCooldown}—Å)` : "–û—Ç–ø—Ä–∞–≤–∏—Ç—å –∫–æ–¥ –ø–æ–≤—Ç–æ—Ä–Ω–æ"}
                  </button>
                </>
              )}
            </div>
          </>
        )}

        {msg && <div className="auth-msg">{msg}</div>}

        {authMode === "login" ? (
          <div className="auth-test-box">
            <div className="auth-test-title">–¢–µ—Å—Ç–æ–≤—ã–µ –∞–∫–∫–∞—É–Ω—Ç—ã (–≤—Ä–µ–º–µ–Ω–Ω–æ)</div>
            <div className="auth-test-subtitle">–î–ª—è –±—ã—Å—Ç—Ä–æ–≥–æ –≤—Ö–æ–¥–∞ –∏ –ø—Ä–æ–≤–µ—Ä–∫–∏ –∞–Ω–∞–ª–∏—Ç–∏–∫–∏. –ü–æ—Ç–æ–º —É–¥–∞–ª–∏–º.</div>
            <div className="auth-test-list">
              {TEST_ACCOUNTS.map((x) => (
                <div key={x.email} className="auth-test-item">
                  <div className="auth-test-main">
                    <div className="auth-test-email">{x.email}</div>
                    <div className="auth-test-pass">{`–ü–∞—Ä–æ–ª—å: ${x.password}`}</div>
                  </div>
                  <div className="auth-test-meta">
                    <span>{x.role}</span>
                    <span>{`–ü—Ä–æ–¥–∞–∂–∏: ${x.sales}`}</span>
                    {x.purchases > 0 ? <span>{`–ü–æ–∫—É–ø–∫–∏: ${x.purchases}`}</span> : null}
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








