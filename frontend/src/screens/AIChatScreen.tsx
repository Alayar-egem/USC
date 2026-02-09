import { useEffect, useMemo, useRef, useState } from "react";
import TopHeader from "../ui/TopHeader";
import { queryAnalyticsAssistant, type AnalyticsAssistantResponse } from "../api/analytics";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: number;
  data?: AnalyticsAssistantResponse;
};

type ChatSession = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
};

const QUICK_PROMPTS = [
  "Почему выручка просела в последнем месяце?",
  "Что сделать, чтобы вырасти в следующем месяце?",
  "Где основные риски по заказам?",
  "Какие действия приоритетнее на этой неделе?",
] as const;

function sessionKey(companyId: number | null | undefined, role: string | null | undefined) {
  return `usc.ai.sessions.${companyId ?? "none"}.${(role ?? "unknown").toLowerCase()}`;
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeTitle(text: string) {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (!normalized) return "Новый чат";
  return normalized.length > 46 ? `${normalized.slice(0, 46)}…` : normalized;
}

export default function AIChatScreen({
  active,
  cartCount,
  onBurger,
  onNotify,
  role,
  companyId,
  showCompanyBanner = false,
  onPickCompany,
}: {
  active: boolean;
  cartCount: number;
  onBurger: () => void;
  onNotify: (text: string, tone?: "info" | "success" | "error") => void;
  role?: string | null;
  companyId?: number | null;
  showCompanyBanner?: boolean;
  onPickCompany?: () => void;
}) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const historyRef = useRef<HTMLDivElement | null>(null);
  const key = useMemo(() => sessionKey(companyId, role), [companyId, role]);
  const analyticsRole = (role || "").toLowerCase() === "supplier" ? "supplier" : "buyer";

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) {
        setSessions([]);
        setCurrentId(null);
        return;
      }
      const parsed = JSON.parse(raw) as ChatSession[];
      if (!Array.isArray(parsed)) {
        setSessions([]);
        setCurrentId(null);
        return;
      }
      const clean = parsed.slice(0, 60);
      setSessions(clean);
      setCurrentId(clean[0]?.id ?? null);
    } catch {
      setSessions([]);
      setCurrentId(null);
    }
  }, [key]);

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(sessions.slice(0, 60)));
    } catch {
      // ignore
    }
  }, [key, sessions]);

  const currentSession = sessions.find((s) => s.id === currentId) ?? null;

  useEffect(() => {
    const sync = () => {
      if (window.innerWidth > 860) setMobileSidebarOpen(false);
    };
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  useEffect(() => {
    const el = historyRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [currentId, currentSession?.messages.length, loading]);

  const newChat = () => {
    const now = Date.now();
    const id = makeId("chat");
    const next: ChatSession = {
      id,
      title: "Новый чат",
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    setSessions((prev) => [next, ...prev]);
    setCurrentId(id);
    setInput("");
    setMobileSidebarOpen(false);
  };

  const updateSession = (id: string, updater: (s: ChatSession) => ChatSession) => {
    setSessions((prev) =>
      prev
        .map((s) => (s.id === id ? updater(s) : s))
        .sort((a, b) => b.updatedAt - a.updatedAt)
    );
  };

  const sendMessage = async (rawQuestion?: string) => {
    const question = (rawQuestion ?? input).trim();
    if (!question || !companyId) return;

    let targetId = currentId;
    if (!targetId) {
      const now = Date.now();
      targetId = makeId("chat");
      const session: ChatSession = {
        id: targetId,
        title: makeTitle(question),
        createdAt: now,
        updatedAt: now,
        messages: [],
      };
      setSessions((prev) => [session, ...prev]);
      setCurrentId(targetId);
    }

    const userMsg: ChatMessage = {
      id: makeId("u"),
      role: "user",
      text: question,
      timestamp: Date.now(),
    };

    updateSession(targetId, (s) => {
      const title = s.messages.length === 0 ? makeTitle(question) : s.title;
      return {
        ...s,
        title,
        updatedAt: Date.now(),
        messages: [...s.messages, userMsg],
      };
    });

    setInput("");
    setLoading(true);
    try {
      const res = await queryAnalyticsAssistant({
        companyId,
        role: analyticsRole,
        question,
        days: 365,
      });
      const assistantMsg: ChatMessage = {
        id: makeId("a"),
        role: "assistant",
        text: res.summary,
        timestamp: Date.now(),
        data: res,
      };
      updateSession(targetId, (s) => ({
        ...s,
        updatedAt: Date.now(),
        messages: [...s.messages, assistantMsg],
      }));
    } catch {
      const errMsg: ChatMessage = {
        id: makeId("e"),
        role: "assistant",
        text: "Не удалось получить ответ. Попробуйте еще раз.",
        timestamp: Date.now(),
      };
      updateSession(targetId, (s) => ({
        ...s,
        updatedAt: Date.now(),
        messages: [...s.messages, errMsg],
      }));
      onNotify("Ошибка запроса к AI", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section id="screen-ai" className={`screen ${active ? "active" : ""}`}>
      <TopHeader onBurger={onBurger} badgeCount={cartCount} />
      <header className="simple-header">
        <div className="simple-title">AI Ассистент</div>
      </header>

      {showCompanyBanner ? (
        <div className="company-banner">
          <div>
            <div className="company-banner-title">Добавьте компанию</div>
            <div className="company-banner-text">AI работает с вашими данными компании и аналитики.</div>
          </div>
          <button className="company-banner-btn" type="button" onClick={onPickCompany}>
            Выбрать
          </button>
        </div>
      ) : null}

      {mobileSidebarOpen ? (
        <button
          type="button"
          className="ai-sidebar-overlay"
          onClick={() => setMobileSidebarOpen(false)}
          aria-label="Закрыть список чатов"
        />
      ) : null}

      <div className="ai-layout">
        <aside className={`ai-sidebar ${mobileSidebarOpen ? "mobile-open" : ""}`}>
          <div className="ai-sidebar-mobile-head">
            <button
              type="button"
              className="ai-sidebar-close"
              onClick={() => setMobileSidebarOpen(false)}
              aria-label="Закрыть список чатов"
            >
              ×
            </button>
          </div>
          <button type="button" className="ai-new-chat" onClick={newChat}>
            + Новый чат
          </button>
          <div className="ai-sessions">
            {sessions.length ? (
              sessions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`ai-session-item ${s.id === currentId ? "active" : ""}`}
                  onClick={() => {
                    setCurrentId(s.id);
                    setMobileSidebarOpen(false);
                  }}
                >
                  <div className="ai-session-title">{s.title}</div>
                  <div className="ai-session-meta">{new Date(s.updatedAt).toLocaleString("ru-RU")}</div>
                </button>
              ))
            ) : (
              <div className="ai-session-empty">Пока нет диалогов</div>
            )}
          </div>
        </aside>

        <div className="ai-chat">
          <div className="ai-chat-mobile-head">
            <button
              type="button"
              className="ai-mobile-sidebar-toggle"
              onClick={() => setMobileSidebarOpen(true)}
              aria-label="Открыть список чатов"
            >
              <span />
              <span />
              <span />
            </button>
            <div className="ai-mobile-chat-title">{currentSession?.title ?? "AI-чат"}</div>
          </div>
          <div className="ai-quick-row">
            {QUICK_PROMPTS.map((q) => (
              <button key={q} type="button" className="ai-quick-btn" onClick={() => void sendMessage(q)} disabled={!companyId || loading}>
                {q}
              </button>
            ))}
          </div>
          <div className="ai-history" ref={historyRef}>
            {currentSession?.messages.length ? (
              currentSession.messages.map((m) => (
                <div key={m.id} className={`ai-msg ${m.role}`}>
                  <div className="ai-msg-text">{m.text}</div>
                  {m.role === "assistant" && m.data?.probable_causes?.length ? (
                    <div className="ai-msg-section">
                      <div className="ai-msg-section-title">Почему так происходит</div>
                      <ul className="ai-msg-list">
                        {m.data.probable_causes.slice(0, 4).map((x, idx) => (
                          <li key={`${m.id}-cause-${idx}`}>{x}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {m.role === "assistant" && m.data?.actions?.length ? (
                    <div className="ai-msg-section">
                      <div className="ai-msg-section-title">Что делать</div>
                      <ul className="ai-msg-list ai-msg-list-actions">
                        {m.data.actions.slice(0, 5).map((x, idx) => (
                          <li key={`${m.id}-action-${idx}`}>{x}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="ai-empty-chat">
                {companyId ? "Выберите чат или начните новый диалог." : "Сначала выберите компанию, чтобы AI видел аналитику."}
              </div>
            )}
            {loading ? (
              <div className="ai-msg assistant loading">
                <div className="ai-typing"><span /><span /><span /></div>
              </div>
            ) : null}
          </div>
          <form
            className="ai-input-row"
            onSubmit={(e) => {
              e.preventDefault();
              void sendMessage();
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Спросите AI по вашим данным..."
              disabled={!companyId || loading}
            />
            <button type="submit" disabled={!companyId || loading || !input.trim()}>
              {loading ? "..." : ">"}
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
