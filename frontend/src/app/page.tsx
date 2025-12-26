"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type Role = "user" | "ai";
type Msg = { id: string; role: Role; text: string; interrupted?: boolean };
type ProStatus = "off" | "checking" | "active" | "invalid" | "exhausted";
type BillingState = "idle" | "creating" | "waiting" | "claiming" | "done" | "error";

const LS = {
  freeLeft: "void_free_left",
  clientId: "void_client_id",
  proToken: "void_pro_token",
  invoiceId: "void_invoice_id",
  checkoutLink: "void_checkout_link",
  planId: "void_plan_id",
} as const;

type Plan = {
  id: string;
  title: string;
  credits: number;
  priceUsd: number;
  note?: string;
};

const PLANS: Plan[] = [
  { id: "starter", title: "Starter", credits: 1_000, priceUsd: 1, note: "Quick test." },
  { id: "plus", title: "Plus", credits: 5_000, priceUsd: 4, note: "Most picked." },
  { id: "max", title: "Max", credits: 15_000, priceUsd: 10, note: "Heavy usage." },
];

function shortId(id: string) {
  return id ? `${id.slice(0, 8)}…` : "—";
}

function safeJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeBase(url: string) {
  return url.replace(/\/+$/, "");
}

function readLS(key: string) {
  try {
    if (typeof window === "undefined") return "";
    return (localStorage.getItem(key) || "").trim();
  } catch {
    return "";
  }
}

function writeLS(key: string, value: string) {
  try {
    if (typeof window === "undefined") return;
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {}
}

async function copyToClipboard(text: string) {
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export default function Page() {
  const API_BASE = useMemo(() => {
    const base = process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000";
    return normalizeBase(base);
  }, []);

  // Identity / limits
  const [clientId, setClientId] = useState<string>("");
  const [freeLeft, setFreeLeft] = useState<number>(0);

  // Pro
  const [proToken, setProToken] = useState<string>("");
  const [tokenDraft, setTokenDraft] = useState<string>("");
  const [proStatus, setProStatus] = useState<ProStatus>("off");
  const [proLeft, setProLeft] = useState<number | null>(null);

  // Billing
  const [walletOpen, setWalletOpen] = useState<boolean>(false);
  const [planId, setPlanId] = useState<string>(PLANS[0]!.id);
  const [invoiceId, setInvoiceId] = useState<string>("");
  const [checkoutLink, setCheckoutLink] = useState<string>("");
  const [billingState, setBillingState] = useState<BillingState>("idle");
  const [billingMsg, setBillingMsg] = useState<string>("");
  const [uiMsg, setUiMsg] = useState<string>("");

  // Chat
  const [messages, setMessages] = useState<Msg[]>([
    { id: "welcome", role: "ai", text: "Welcome. How can I help?" },
  ]);
  const [input, setInput] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [status, setStatus] = useState<"idle" | "thinking" | "stopped">("idle");
  const [clearing, setClearing] = useState<boolean>(false);
  
  // Theme state
  const [theme, setTheme] = useState<"light" | "dark">("dark");

  const [paymentMethod, setPaymentMethod] = useState<"btc" | "xmr">("btc");

  // Concurrency refs
  const messagesRef = useRef<Msg[]>(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Streaming refs
  const abortRef = useRef<AbortController | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const genIdRef = useRef<string | null>(null);

  function cleanupStreamRefs() {
    abortRef.current = null;
    readerRef.current = null;
  }

    function stop() {
    try {
      abortRef.current?.abort();
    } catch {}
    const r = readerRef.current;
    if (r) r.cancel().catch(() => {});
    cleanupStreamRefs();
    
    const currentMsgs = messagesRef.current;
    const lastMsg = currentMsgs[currentMsgs.length - 1];
    if (lastMsg && lastMsg.role === "ai") {
      setMessages(prev => prev.map(m => m.id === lastMsg.id ? { ...m, interrupted: true } : m));
    }
    // -------------------

    setLoading(false);
    setStatus("stopped");
  }

  async function clearChat() {
    if (clearing) return;
    stop();
    setClearing(true);
    genIdRef.current = null;
    setMessages([{ id: crypto.randomUUID(), role: "ai", text: "New chat. What do you want to do?" }]);
    setInput("");
    window.setTimeout(() => setClearing(false), 150);
  }

  // Scroll handling
  const scrollBoxRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRef = useRef<boolean>(true);

  useEffect(() => {
    const el = scrollBoxRef.current;
    if (!el) return;

    const onScroll = () => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      autoScrollRef.current = dist < 120;
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!autoScrollRef.current) return;
    bottomRef.current?.scrollIntoView({ behavior: loading ? "auto" : "smooth", block: "end" });
  }, [messages, loading]);

  // Hard-lock page scroll
  useEffect(() => {
    const prevHtml = document.documentElement.style.overflow;
    const prevBody = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = prevHtml;
      document.body.style.overflow = prevBody;
    };
  }, []);

  // ESC to close wallet
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setWalletOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Init
  useEffect(() => {
    let id = readLS(LS.clientId);
    if (!id) {
      id = crypto.randomUUID();
      writeLS(LS.clientId, id);
    }
    setClientId(id);

    const storedFree = readLS(LS.freeLeft);
    const n = storedFree ? Number(storedFree) : NaN;
    setFreeLeft(Number.isFinite(n) ? n : 0);

    const t = readLS(LS.proToken);
    setProToken(t);
    setTokenDraft(t);

    const savedPlanId = readLS(LS.planId);
    if (savedPlanId) setPlanId(savedPlanId);

    const inv = readLS(LS.invoiceId);
    const link = readLS(LS.checkoutLink);
    if (inv) {
      setInvoiceId(inv);
      setCheckoutLink(link);
      setBillingState("waiting");
      setBillingMsg("Payment pending. Waiting for confirmation…");
    }

    if (t) {
      setProStatus("checking");
      void refreshProStatus(t);
    } else {
      setProStatus("off");
      setProLeft(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist
  useEffect(() => writeLS(LS.freeLeft, String(freeLeft)), [freeLeft]);
  useEffect(() => writeLS(LS.proToken, proToken), [proToken]);
  useEffect(() => writeLS(LS.invoiceId, invoiceId), [invoiceId]);
  useEffect(() => writeLS(LS.checkoutLink, checkoutLink), [checkoutLink]);
  useEffect(() => writeLS(LS.planId, planId), [planId]);

  async function activateToken(draft: string) {
    const token = (draft || "").trim();
    setTokenDraft(token);

    if (!token) {
      setProToken("");
      setProStatus("off");
      setProLeft(null);
      return;
    }

    setProToken(token);
    setProStatus("checking");
    await refreshProStatus(token);
    setUiMsg("Token saved in this browser.");
  }

  async function refreshProStatus(tokenOverride?: string) {
    const t = (tokenOverride ?? proToken).trim();
    if (!t) {
      setProStatus("off");
      setProLeft(null);
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/pro/status`, {
        method: "GET",
        headers: { "x-void-pro-token": t },
      });

      if (res.status === 404) {
        setProStatus("active");
        setProLeft(null);
        return;
      }

      if (res.status === 401) {
        setProStatus("invalid");
        setProLeft(null);
        return;
      }

      if (!res.ok) {
        setProStatus("invalid");
        setProLeft(null);
        return;
      }

      const bodyText = await res.text();
      const j = safeJson(bodyText); 

      let left: number | null = null;
      if (typeof j?.credits_left === "number") left = j.credits_left;
      else {
        const h = res.headers.get("x-pro-left");
        if (h) {
          const n = Number(h);
          if (Number.isFinite(n)) left = n;
        }
      }

      setProLeft(left);
      if (left === null) setProStatus("active");
      else setProStatus(left > 0 ? "active" : "exhausted");
    } catch {
      setProStatus("invalid");
      setProLeft(null);
    }
  }

  function clearInvoiceState() {
    setInvoiceId("");
    setCheckoutLink("");
    setBillingState("idle");
    setBillingMsg("");
  }

  async function createInvoice() {
    const plan = PLANS.find((p) => p.id === planId) ?? PLANS[0]!;
    setUiMsg("");
    setBillingMsg("");
    setBillingState("creating");

    try {
      const res = await fetch(`${API_BASE}/pro/create-invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: String(plan.priceUsd),
          currency: "USD",
          credits: plan.credits,
        }),
      });

      if (!res.ok) {
        setBillingState("error");
        setBillingMsg(`Create invoice failed (HTTP ${res.status}).`);
        return;
      }

      const j = await res.json();
      const inv = (j?.invoiceId || "").trim();
      const link = (j?.checkoutLink || "").trim();

      if (!inv) {
        setBillingState("error");
        setBillingMsg("Create invoice ok, but invoiceId is missing.");
        return;
      }

      setInvoiceId(inv);
      setCheckoutLink(link);
      setBillingState("waiting");
      setBillingMsg("Invoice created. Waiting for payment confirmation…");

      if (link) window.open(link, "_blank", "noopener,noreferrer");
    } catch {
      setBillingState("error");
      setBillingMsg("Create invoice failed (network error).");
    }
  }

  async function claimTokenOnce(inv: string): Promise<"paid" | "pending" | "already_claimed" | "error"> {
    try {
      const res = await fetch(`${API_BASE}/pro/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId: inv }),
      });

      if (res.status === 404) return "pending";
      if (res.status === 409) return "already_claimed";
      if (!res.ok) return "error";

      const j = await res.json();
      const token = (j?.token || "").trim();
      if (!token) return "error";

      setProToken(token);
      setTokenDraft(token);
      setProStatus("checking");
      await refreshProStatus(token);

      const copied = await copyToClipboard(token);
      setUiMsg(copied ? "Token copied." : "Token saved (clipboard blocked).");

      setBillingState("done");
      setBillingMsg("Payment confirmed. Credits unlocked.");
      clearInvoiceState();
      return "paid";
    } catch {
      return "error";
    }
  }

  // Auto-claim polling
  const pollRef = useRef<number | null>(null);
  useEffect(() => {
    if (billingState !== "waiting") return;
    if (!invoiceId) return;

    if (pollRef.current) window.clearInterval(pollRef.current);

    const startedAt = Date.now();
    pollRef.current = window.setInterval(() => {
      const ageMs = Date.now() - startedAt;

      if (ageMs > 20 * 60 * 1000) {
        if (pollRef.current) window.clearInterval(pollRef.current);
        pollRef.current = null;
        setBillingState("error");
        setBillingMsg("Timeout. If you paid, click Claim. Otherwise create a new invoice.");
        return;
      }

      if (document.visibilityState === "hidden") return;

      void (async () => {
        setBillingState("claiming");
        const r = await claimTokenOnce(invoiceId);

        if (r === "pending") {
          setBillingState("waiting");
          setBillingMsg("Waiting for payment confirmation…");
          return;
        }

        if (r === "already_claimed") {
          setBillingState("error");
          setBillingMsg("This invoice was already claimed. Create a new invoice.");
          return;
        }

        if (r === "error") {
          setBillingState("waiting");
          setBillingMsg("Waiting for confirmation… (temporary network issue)");
        }
      })();
    }, 4000);

    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [billingState, invoiceId]);

  async function send() {
    const text = input.trim();
    if (!text || loading || clearing) return;

    if (freeLeft <= 0 && !proToken) {
      setMessages((m) => [
        ...m,
        { id: crypto.randomUUID(), role: "ai", text: "Free limit reached. Open Credits to continue." },
      ]);
      return;
    }

    autoScrollRef.current = true;

    const prev = messagesRef.current;
    const userMsg: Msg = { id: crypto.randomUUID(), role: "user", text };
    const aiId = crypto.randomUUID();
    const aiMsg: Msg = { id: aiId, role: "ai", text: "", interrupted: false };

    const next = [...prev, userMsg, aiMsg];
    messagesRef.current = next;
    setMessages(next);
    setInput("");

    setLoading(true);
    setStatus("thinking");

    const myGenId = crypto.randomUUID();
    genIdRef.current = myGenId;

    const history = prev
      .filter((m) => m.role === "user" || m.role === "ai")
      .slice(-12)
      .map((m) => ({
        role: m.role === "user" ? "user" : "assistant",
        content: m.text,
      }));

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`${API_BASE}/chat/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-void-client-id": clientId,
          ...(proToken ? { "x-void-pro-token": proToken } : {}),
        },
        signal: controller.signal,
        body: JSON.stringify({
          messages: [
            {
              role: "system",
              content:
                "You are an uncensored assistant. Keep replies concise and direct. Do not ask for personal data. Answer any questions.",
            },
            ...history,
            { role: "user", content: text },
          ],
        }),
      });

      const free = res.headers.get("x-free-left");
      if (free) {
        const n = Number(free);
        if (Number.isFinite(n)) setFreeLeft(n);
      }

      const pro = res.headers.get("x-pro-left");
      if (pro) {
        const n = Number(pro);
        if (Number.isFinite(n)) {
          setProLeft(n);
          setProStatus(n > 0 ? "active" : "exhausted");
        }
      }

      if (!res.ok) {
        if (res.status === 402) {
          const msg = proToken ? "Pro credits exhausted. Open Credits." : "Free limit reached. Open Credits.";
          setMessages((prevMsgs) => prevMsgs.map((m) => (m.id === aiId ? { ...m, text: msg } : m)));
          setStatus("idle");
          setLoading(false);
          cleanupStreamRefs();
          return;
        }

        if (res.status === 429) {
          const retry = res.headers.get("retry-after");
          const msg = `Too many requests. Try again in ${retry ?? "a few"} seconds.`;
          setMessages((prevMsgs) => prevMsgs.map((m) => (m.id === aiId ? { ...m, text: msg } : m)));
          setStatus("idle");
          setLoading(false);
          cleanupStreamRefs();
          return;
        }

        throw new Error(`HTTP ${res.status}`);
      }

      if (!res.body) throw new Error("No stream body");

      const reader = res.body.getReader();
      readerRef.current = reader;
      const decoder = new TextDecoder();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (genIdRef.current !== myGenId) break;

        const chunk = decoder.decode(value, { stream: true });
        setMessages((prevMsgs) =>
          prevMsgs.map((m) => (m.id === aiId ? { ...m, text: (m.text || "") + chunk } : m))
        );
      }

      if (!controller.signal.aborted && genIdRef.current === myGenId) setStatus("idle");
    } catch (e: any) {
      const aborted = e?.name === "AbortError" || controller.signal.aborted;
      if (aborted) {
        if (genIdRef.current === myGenId) setStatus("stopped");
      } else {
        setMessages((prevMsgs) =>
          prevMsgs.map((m) => (m.id === aiId ? { ...m, text: "Error: cannot reach the backend." } : m))
        );
        if (genIdRef.current === myGenId) setStatus("idle");
      }
    } finally {
      if (genIdRef.current === myGenId) {
        setLoading(false);
        cleanupStreamRefs();
      }
    }
  }

  function proStatusLine() {
    if (!proToken) return "Pro: Off";
    if (proStatus === "checking") return "Pro: Checking…";
    if (proStatus === "invalid") return "Pro: Invalid token";
    if (proStatus === "exhausted") return "Pro: Active (0 credits)";
    if (proStatus === "active") {
      return `Pro: Active${typeof proLeft === "number" ? ` (${proLeft} credits)` : ""}`;
    }
    return "Pro: Off";
  }

// ---------------- UI (ORIGINAL STYLE RESTORED) ----------------

  return (
    <div className={`wpShell ${theme}`}>
      {/* --- SIDEBAR (DESTRA) --- */}
      <div className="wpSidebar">
        <div className="wpSidebarHeader">
          <div className="wpBrand">
            <span>VOID / AI</span>
          </div>
          <span>_beta V1.d6</span>
          <button className="wpBtn" style={{padding: "4px 8px", fontSize: "12px"}} onClick={() => void clearChat()}>
            + New Chat
          </button>
        </div>
        
        {/* Sezione Azioni Rapide */}
        <div style={{padding: "10px"}}>
           <div className="wpChatItem wpGetCreditsBtn" onClick={() => setWalletOpen(true)}>
             💎 Get Credits
           </div>
        </div>

        <div className="wpChatList">
          <div className="wpChatItem active">Current Conversation</div>
          <div className="wpChatItem">Previous Chat (Example)</div>
          <div className="wpChatItem">Old Project Ideas</div>
          <div className="wpChatItem">Code Help</div>
          <div className="wpChatItem">Research Notes</div>
        </div>

        {/* Theme Toggle in fondo alla sidebar */}
        <div className="wpThemeToggleInSidebar">
          <div className="wpThemeCircle" onClick={() => setTheme(prev => prev === "light" ? "dark" : "light")}>
            <span style={{fontSize: "18px"}}>{theme === "light" ? "🌙 Dark Mode" : "☀ Light Mode"}</span>
          </div>
        </div>
      </div>

      {/* --- WRAPPER PER CONTENUTO PRINCIPALE --- */}
      <div className="wpContentWrapper">
        
        {/* Top Bar */}
        <div className="wpTopbar">
          <div style={{fontSize: "0.9rem", color: "var(--wp-muted)"}}>Private & Uncensored</div>
          <div className="wpMeta">
            <div className="wpMetaItem">Session: <strong>{shortId(clientId)}</strong></div>
            
            {/* Mostra Free Credits SOLO se non c'è Token Pro */}
            {!proToken && (
              <div className="wpMetaItem">Free: <strong>{freeLeft}</strong></div>
            )}
            
            <div className="wpMetaItem"><strong>{proStatusLine()}</strong></div>
            {/* RIMOSSO IL PULSANTE CREDITS QUI, ORA È NELLA SIDEBAR */}
          </div>
        </div>

        {/* Main Layout */}
        <div className="wpMain">
          
          {/* Messages Area */}
          <div className="wpChatContainer" ref={scrollBoxRef as any}>
            {messages.map((m, index) => {
              const isUser = m.role === "user";
              const isLastMessage = index === messages.length - 1;
              
              return (
                <div key={m.id} className={`wpMsg ${isUser ? "wpMsg--user" : "wpMsg--ai"}`}>
                  <div className="wpRoleName">{isUser ? "You" : "Assistant"}</div>
                  
                  <div className="wpBubble">
                    {m.text}
                    
                    {/* LOGICA STATO MESSAGGIO */}
                    {m.interrupted && (
                      <span className="msgStatus stopped">Stopped.</span>
                    )}

                    {!m.interrupted && m.text === "" && status === "thinking" && isLastMessage && (
                      <span className="msgStatus thinking">Thinking...</span>
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef as any} />
          </div>

          {/* Composer Area */}
          <div className="wpComposerArea">
            <div className="wpComposerBox">
              <textarea
                className="wpTextarea"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                disabled={loading || clearing}
                placeholder="Type your message..."
              />
              <div className="wpControls">
                <div className="wpHelper">Enter to send, Shift+Enter for new line</div>
                <div style={{ display: "flex", gap: "10px" }}>
                  <button 
                    className="wpBtn danger" 
                    onClick={() => void clearChat()} 
                    disabled={loading || clearing}
                  >
                    Clear Chat
                  </button>
                  <button 
                    className="wpBtn" 
                    onClick={() => stop()} 
                    disabled={!loading}
                  >
                    Stop
                  </button>
                  <button 
                    className="wpBtn primary" 
                    onClick={() => void send()} 
                    disabled={loading || clearing}
                  >
                    Send Message
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div> {/* Fine wpContentWrapper */}

      {/* Modal */}
      {walletOpen && (
        <div className="wpModalBackdrop" onMouseDown={() => setWalletOpen(false)}>
          <div className="wpModal" onMouseDown={e => e.stopPropagation()}>
            <div className="wpModalHead">
              <span className="wpModalTitle">Wallet & Access</span>
              <button className="wpBtn" onClick={() => setWalletOpen(false)}>Close</button>
            </div>
            <div className="wpModalContent">
              
              {/* Sezione 1: Token Esistente */}
              <div className="wpSection">
                <span className="wpLabel">Existing Token</span>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <input 
                    className="wpTextarea" 
                    style={{ minHeight: '40px', padding: '8px 12px' }}
                    value={tokenDraft}
                    onChange={e => setTokenDraft(e.target.value)}
                    placeholder="Paste token here..."
                  />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="wpBtn primary" onClick={() => void activateToken(tokenDraft)}>Load Token</button>
                  <button className="wpBtn danger" onClick={() => {
                     setTokenDraft("");
                     void activateToken("");
                     setUiMsg("Token removed.");
                  }}>Unlink</button>
                </div>
                {uiMsg && <div style={{ fontSize: 13, marginTop: 8, color: 'var(--wp-primary)' }}>{uiMsg}</div>}
              </div>

              {/* Sezione 2: Acquisto (ORIZZONTALE + TOGGLE MONERO) */}
              <div className="wpSection">
                <span className="wpLabel">Purchase Credits</span>
                
                {/* Toggle BTC / XMR */}
                <div className="wpPaymentToggle">
                  <div 
                    className={`wpPaymentOption ${paymentMethod === 'btc' ? 'active' : ''}`}
                    onClick={() => setPaymentMethod('btc')}
                  >
                    Bitcoin (BTC)
                  </div>
                  <div 
                    className={`wpPaymentOption ${paymentMethod === 'xmr' ? 'active' : ''}`}
                    onClick={() => setPaymentMethod('xmr')}
                  >
                    Monero (XMR)
                  </div>
                </div>

                {/* Piani in Orizzontale */}
                <div className="wpPlansRow">
                  {PLANS.map(p => (
                    <div 
                      key={p.id} 
                      className={`wpPlanBtn ${planId === p.id ? 'active' : ''}`}
                      onClick={() => setPlanId(p.id)}
                    >
                      <div className="wpPlanPrice">${p.priceUsd}</div>
                      <div style={{fontWeight: 600}}>{p.title}</div>
                      <div className="wpPlanCredits">{p.credits.toLocaleString()} credits</div>
                      {p.note && <div style={{fontSize: 11, marginTop: 4, opacity: 0.7}}>{p.note}</div>}
                    </div>
                  ))}
                </div>
                
                {/* Pulsanti Azione */}
                <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
                  {paymentMethod === 'btc' ? (
                    <button 
                      className="wpBtn primary" 
                      onClick={() => void createInvoice()}
                      disabled={billingState === "creating"}
                      style={{minWidth: "150px"}}
                    >
                      {billingState === "creating" ? "Creating..." : "Pay with BTC"}
                    </button>
                  ) : (
                    // Placeholder per Monero
                    <button className="wpBtn primary" disabled style={{minWidth: "150px"}}>
                      Pay with XMR (Soon)
                    </button>
                  )}
                </div>

                {/* Stato Invoice (visibile solo per BTC per ora) */}
                {invoiceId && paymentMethod === 'btc' && (
                  <div style={{ marginTop: 20, padding: 12, background: 'var(--wp-bg)', borderRadius: 8, fontSize: 13 }}>
                    <div><strong>Invoice ID:</strong> {shortId(invoiceId)}</div>
                    {checkoutLink && (
                      <div style={{ marginTop: 4 }}>
                        <a href={checkoutLink} target="_blank" rel="noreferrer" style={{ color: 'var(--wp-primary)' }}>Open Payment Link ↗</a>
                      </div>
                    )}
                    {billingMsg && <div style={{ marginTop: 8, color: 'var(--wp-muted)', fontStyle: 'italic' }}>{billingMsg}</div>}
                  </div>
                )}
              </div>

            </div>
          </div>
        </div>
      )}
    </div>
  );
}