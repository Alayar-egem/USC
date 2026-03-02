import { useEffect, useMemo, useRef, useState } from "react";
import TopHeader from "../ui/TopHeader";
import { streamAnalyticsAssistant, type AnalyticsAssistantResponse } from "../api/analytics";
import { AI_TEXT } from "../constants/aiTexts";

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

const QUICK_PROMPTS = AI_TEXT.quickPrompts;

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

function sanitizeAssistantSummary(text: string): string {
  const clean = (text || "").replace(/\*\*/g, "").trim();
  if (!clean) return "";
  const lines = clean.split("\n");
  const sectionMarkers = [
    "что делать",
    "почему так происходит",
    "практические шаги",
    "рекомендации",
    "действия",
  ];
  let cutoff = lines.length;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim().toLowerCase();
    if (sectionMarkers.some((marker) => line.startsWith(marker))) {
      cutoff = i;
      break;
    }
  }
  const summary = lines.slice(0, cutoff).join("\n").trim();
  return summary || clean;
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
  const [streamingAssistantId, setStreamingAssistantId] = useState<string | null>(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [revealedCharsByMsgId, setRevealedCharsByMsgId] = useState<Record<string, number>>({});

  const historyRef = useRef<HTMLDivElement | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const revealTimerRef = useRef<number | null>(null);
  const activeMessagesRef = useRef<ChatMessage[]>([]);
  const lastSessionIdRef = useRef<string | null>(null);

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
    activeMessagesRef.current = currentSession?.messages ?? [];
  }, [currentSession?.messages]);

  useEffect(() => {
    const sid = currentSession?.id ?? null;
    if (!sid) {
      lastSessionIdRef.current = null;
      setRevealedCharsByMsgId({});
      return;
    }
    if (lastSessionIdRef.current === sid) return;
    const session = currentSession;
    if (!session) return;
    lastSessionIdRef.current = sid;
    const initial: Record<string, number> = {};
    for (const msg of session.messages) {
      if (msg.role === "assistant") initial[msg.id] = msg.text.length;
    }
    setRevealedCharsByMsgId(initial);
  }, [currentSession]);

  useEffect(() => {
    const sync = () => {
      if (window.innerWidth > 860) setMobileSidebarOpen(false);
    };
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  useEffect(() => {
    return () => {
      streamAbortRef.current?.abort();
      streamAbortRef.current = null;
      if (revealTimerRef.current != null) {
        window.clearInterval(revealTimerRef.current);
        revealTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!currentSession) return;
    const hasPendingReveal = currentSession.messages.some((msg) => {
      if (msg.role !== "assistant") return false;
      return (revealedCharsByMsgId[msg.id] ?? 0) < msg.text.length;
    });

    if (!hasPendingReveal) {
      if (revealTimerRef.current != null) {
        window.clearInterval(revealTimerRef.current);
        revealTimerRef.current = null;
      }
      return;
    }

    if (revealTimerRef.current != null) return;

    revealTimerRef.current = window.setInterval(() => {
      const liveMessages = activeMessagesRef.current;
      let pendingAfterTick = false;

      setRevealedCharsByMsgId((prev) => {
        let changed = false;
        const next = { ...prev };

        for (const msg of liveMessages) {
          if (msg.role !== "assistant") continue;
          const target = msg.text.length;
          const current = next[msg.id] ?? 0;
          if (current < target) {
            const remaining = target - current;
            const step = remaining > 120 ? 3 : remaining > 40 ? 2 : 1;
            const nextValue = Math.min(target, current + step);
            next[msg.id] = nextValue;
            changed = true;
            if (nextValue < target) pendingAfterTick = true;
          } else if (current > target) {
            next[msg.id] = target;
            changed = true;
          }
        }

        if (!changed) return prev;
        return next;
      });

      if (!pendingAfterTick && revealTimerRef.current != null) {
        window.clearInterval(revealTimerRef.current);
        revealTimerRef.current = null;
      }
    }, 24);
  }, [currentSession, revealedCharsByMsgId]);

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
    if (!question || !companyId || loading) return;

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

    const assistantMsgId = makeId("a");
    updateSession(targetId, (s) => ({
      ...s,
      updatedAt: Date.now(),
      messages: [
        ...s.messages,
        {
          id: assistantMsgId,
          role: "assistant",
          text: "",
          timestamp: Date.now(),
        },
      ],
    }));

    setInput("");
    setLoading(true);
    setStreamingAssistantId(assistantMsgId);

    streamAbortRef.current?.abort();
    streamAbortRef.current = new AbortController();

    try {
      const res = await streamAnalyticsAssistant(
        {
          companyId,
          role: analyticsRole,
          question,
          days: 365,
        },
        {
          signal: streamAbortRef.current.signal,
          onDelta: (chunk) => {
            if (!chunk) return;
            updateSession(targetId!, (s) => ({
              ...s,
              updatedAt: Date.now(),
              messages: s.messages.map((m) =>
                m.id === assistantMsgId
                  ? {
                      ...m,
                      text: `${m.text}${chunk}`,
                    }
                  : m
              ),
            }));
          },
        }
      );

      updateSession(targetId, (s) => ({
        ...s,
        updatedAt: Date.now(),
        messages: s.messages.map((m) =>
          m.id === assistantMsgId
            ? {
                ...m,
                text: res.summary || m.text,
                data: res,
                timestamp: Date.now(),
              }
            : m
        ),
      }));
    } catch {
      updateSession(targetId, (s) => ({
        ...s,
        updatedAt: Date.now(),
        messages: s.messages.map((m) =>
          m.id === assistantMsgId
            ? {
                ...m,
                text: "Не удалось получить ответ. Попробуйте еще раз.",
                timestamp: Date.now(),
              }
            : m
        ),
      }));
      onNotify("Ошибка запроса к AI", "error");
    } finally {
      setLoading(false);
      setStreamingAssistantId(null);
      streamAbortRef.current = null;
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
              currentSession.messages.map((m) => {
                const showCauses = m.role === "assistant" && !!m.data?.probable_causes?.length;
                const showActions = m.role === "assistant" && !!m.data?.actions?.length;
                const assistantText = m.role === "assistant" ? sanitizeAssistantSummary(m.text) : m.text;
                return (
                <div key={m.id} className={`ai-msg ${m.role} ${m.id === streamingAssistantId ? "is-streaming" : ""}`}>
                  <div className={`ai-msg-text ${m.role === "assistant" && (revealedCharsByMsgId[m.id] ?? 0) < m.text.length ? "revealing" : ""}`}>
                    {m.id === streamingAssistantId && !m.text ? (
                      <span className="ai-typing"><span /><span /><span /></span>
                    ) : (
                      <>
                        {m.role === "assistant"
                          ? assistantText.slice(0, Math.min(revealedCharsByMsgId[m.id] ?? 0, assistantText.length))
                          : m.text}
                        {m.role === "assistant" && (revealedCharsByMsgId[m.id] ?? 0) < m.text.length ? (
                          <span className="ai-reveal-caret" aria-hidden="true" />
                        ) : null}
                      </>
                    )}
                  </div>
                  {showCauses ? (
                    <div className="ai-msg-section">
                      <div className="ai-msg-section-title">Почему так происходит</div>
                      <ul className="ai-msg-list">
                        {m.data?.probable_causes?.slice(0, 4).map((x, idx) => (
                          <li key={`${m.id}-cause-${idx}`}>{x}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {showActions ? (
                    <div className="ai-msg-section">
                      <div className="ai-msg-section-title">Что делать</div>
                      <ul className="ai-msg-list ai-msg-list-actions">
                        {m.data?.actions?.slice(0, 5).map((x, idx) => (
                          <li key={`${m.id}-action-${idx}`}>{x}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              );
              })
            ) : (
              <div className="ai-empty-chat">
                {companyId ? "Выберите чат или начните новый диалог." : "Сначала выберите компанию, чтобы AI видел аналитику."}
              </div>
            )}
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
              {loading ? (
                <span className="ai-send-dots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
              ) : (
                ">"
              )}
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
