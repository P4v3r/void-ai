"use client";

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Copy, RotateCcw, Trash2, Plus, Menu, Sun, Moon, CheckCircle, AlertCircle, FileEdit, Coins } from "lucide-react";
const STORAGE_KEY_CHATS = "void_chat_history";

type Role = "user" | "ai";
type Msg = { id: string; role: Role; text: string; interrupted?: boolean };
type ChatMeta = { id: string; title: string; updatedAt: number; };
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

// --- UTILS ---
const generateBrowserData = async (): Promise<string> => {
  const nav = window.navigator;
  const screen = window.screen;
  const dataString = [
    nav.userAgent,
    nav.language,
    screen.colorDepth,
    new Date().getTimezoneOffset(),
    screen.width + "x" + screen.height,
  ].join("||");

  const msgBuffer = new TextEncoder().encode(dataString);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

function safeJson(text: string) {
  try { return JSON.parse(text); } catch { return null; }
}

function normalizeBase(url: string) { return url.replace(/\/+$/, ""); }

function readLS(key: string) {
  try { if (typeof window === "undefined") return ""; return (localStorage.getItem(key) || "").trim(); } catch { return ""; }
}

function writeLS(key: string, value: string) {
  try { if (typeof window === "undefined") return; if (value) localStorage.setItem(key, value); else localStorage.removeItem(key); } catch {}
}

async function copyToClipboard(text: string) {
  if (!text) return false;
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

export default function Page() {
  const API_BASE = useMemo(() => {
    const base = process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000";
    return normalizeBase(base);
  }, []);

  // --- STATE ---
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
  
  // Theme & UI
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Chat History State
  const [chatId, setChatId] = useState<string | null>(null);
  const [chatList, setChatList] = useState<ChatMeta[]>([]);

  const [paymentMethod, setPaymentMethod] = useState<"btc" | "xmr">("btc");

  // Refs
  const messagesRef = useRef<Msg[]>(messages);
  const abortRef = useRef<AbortController | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const genIdRef = useRef<string | null>(null);
  const prevMsgCountRef = useRef(0);
  const scrollBoxRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRef = useRef<boolean>(true);

  // Effects Refs Sync
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // --- ACTIONS ---

  const cleanupStreamRefs = useCallback(() => {
    abortRef.current = null;
    readerRef.current = null;
  }, []);

  const stop = useCallback(() => {
    try { abortRef.current?.abort(); } catch {}
    const r = readerRef.current;
    if (r) r.cancel().catch(() => {});
    cleanupStreamRefs();
    
    const currentMsgs = messagesRef.current;
    const lastMsg = currentMsgs[currentMsgs.length - 1];
    if (lastMsg && lastMsg.role === "ai") {
      setMessages(prev => prev.map(m => m.id === lastMsg.id ? { ...m, interrupted: true } : m));
    }

    setLoading(false);
    setStatus("stopped");
  }, [cleanupStreamRefs]);

  const startNewChat = useCallback(() => {
    if (clearing) return;
    stop();
    setClearing(true);
    setChatId(null);
    setMessages([{ id: crypto.randomUUID(), role: "ai", text: "New chat. What do you want to do?", interrupted: false }]);
    setInput("");
    writeLS("void_active_chat_id", "");
    setMobileSidebarOpen(false); // Chiudi sidebar su mobile
    window.setTimeout(() => setClearing(false), 150);
  }, [clearing, stop]);

  const clearChat = useCallback(async () => {
    if (clearing) return;
    if (!confirm("Are you sure you want to delete this conversation?")) return;
    
    stop();
    setClearing(true);

    if (chatId) {
      setChatList(prev => prev.filter(c => c.id !== chatId));
      const listRaw = localStorage.getItem("void_chat_history");
      if (listRaw) {
        const list: ChatMeta[] = JSON.parse(listRaw);
        const newList = list.filter(c => c.id !== chatId);
        localStorage.setItem("void_chat_history", JSON.stringify(newList));
      }
      localStorage.removeItem(`void_chat_${chatId}`);
    }

    setChatId(null);
    setMessages([{ id: crypto.randomUUID(), role: "ai", text: "Conversation deleted.", interrupted: false }]);
    setInput("");
    writeLS("void_active_chat_id", "");
    
    window.setTimeout(() => setClearing(false), 150);
  }, [chatId, clearing, stop]);

  // --- CHAT LOGIC (LOCAL STORAGE) ---

  const loadChatList = useCallback(() => {
    try {
      const raw = localStorage.getItem("void_chat_history");
      if (raw) {
        const list: ChatMeta[] = JSON.parse(raw);
        list.sort((a, b) => b.updatedAt - a.updatedAt);
        setChatList(list);
      }
    } catch (e) { console.error("Failed to load chats", e); }
  }, []);

  const createNewChat = useCallback((firstMessage: string) => {
    const newId = crypto.randomUUID();
    const title = firstMessage.slice(0, 30).trim() + (firstMessage.length > 30 ? "..." : "");
    const newChat: ChatMeta = { id: newId, title: title || "New Chat", updatedAt: Date.now() };

    setChatList(prev => [newChat, ...prev]);
    setChatId(newId);
    writeLS("void_active_chat_id", newId);

    const existingRaw = localStorage.getItem("void_chat_history");
    let list: ChatMeta[] = existingRaw ? JSON.parse(existingRaw) : [];
    list.push(newChat);
    localStorage.setItem("void_chat_history", JSON.stringify(list));
    localStorage.setItem(`void_chat_${newId}`, JSON.stringify(messagesRef.current));
  }, []);

  const loadChat = useCallback((id: string) => {
    try {
      const raw = localStorage.getItem(`void_chat_${id}`);
      if (raw) {
        const msgs: Msg[] = JSON.parse(raw);
        setMessages(msgs);
        setChatId(id);
        writeLS("void_active_chat_id", id);
        setMobileSidebarOpen(false); // Chiudi su mobile dopo click
      }
    } catch (e) { console.error("Failed to load chat", e); }
  }, []);

  const deleteChat = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this chat?")) return;

    setChatList(prev => prev.filter(c => c.id !== id));
    if (chatId === id) void clearChat();

    const listRaw = localStorage.getItem("void_chat_history");
    if (listRaw) {
      const list: ChatMeta[] = JSON.parse(listRaw);
      const newList = list.filter(c => c.id !== id);
      localStorage.setItem("void_chat_history", JSON.stringify(newList));
    }
    localStorage.removeItem(`void_chat_${id}`);
  }, [chatId, clearChat]);

  // --- SCROLL EFFECTS ---
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

  // Lock page scroll
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

  // Key Handlers
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setWalletOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Persistence & Meta Updates
  useEffect(() => {
    if (chatId) {
      const timeoutId = setTimeout(() => {
        try { localStorage.setItem(`void_chat_${chatId}`, JSON.stringify(messages)); } catch (e) { console.error("Error saving chat", e); }
      }, 1000);
      return () => clearTimeout(timeoutId);
    }
  }, [messages, chatId]);

  // --- GESTIONE SIDEBAR (Solo su attività) ---
  const bumpChatToTop = useCallback((id: string) => {
    setChatList(prev => {
      const list = [...prev];
      const index = list.findIndex(c => c.id === id);
      
      if (index !== -1) {
        // Aggiorna timestamp
        list[index] = { ...list[index], updatedAt: Date.now() };
        // Riordina: il modificato va in cima
        list.sort((a, b) => b.updatedAt - a.updatedAt);
        // Salva su disco
        localStorage.setItem(STORAGE_KEY_CHATS, JSON.stringify(list));
      }
      
      return list;
    });
  }, []);

  // --- INIT ---
  useEffect(() => {
    let id = readLS(LS.clientId);
    if (!id) { id = crypto.randomUUID(); writeLS(LS.clientId, id); }
    setClientId(id);

    const savedChatId = readLS("void_active_chat_id");
    if (savedChatId) {
      setChatId(savedChatId);
      void loadChat(savedChatId);
    } else {
      setChatId(null);
      setMessages([{ id: crypto.randomUUID(), role: "ai", text: "New chat. What do you want to do?" }]);
    }

    const storedFree = readLS(LS.freeLeft);
    const n = storedFree ? Number(storedFree) : NaN;
    setFreeLeft(Number.isFinite(n) ? n : 0);
    loadChatList();

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

    if (t) { setProStatus("checking"); void refreshProStatus(t); } else { setProStatus("off"); setProLeft(null); }
    
    void checkServerStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadChat, loadChatList]);

  // Persist simple vars
  useEffect(() => writeLS(LS.freeLeft, String(freeLeft)), [freeLeft]);
  useEffect(() => writeLS(LS.proToken, proToken), [proToken]);
  useEffect(() => writeLS(LS.invoiceId, invoiceId), [invoiceId]);
  useEffect(() => writeLS(LS.checkoutLink, checkoutLink), [checkoutLink]);
  useEffect(() => writeLS(LS.planId, planId), [planId]);

  // --- API LOGIC ---

  const activateToken = useCallback(async (draft: string) => {
    const token = (draft || "").trim();
    setTokenDraft(token);
    if (!token) { setProToken(""); setProStatus("off"); setProLeft(null); return; }
    setProToken(token);
    setProStatus("checking");
    await refreshProStatus(token);
    setUiMsg("Token saved in this browser.");
  }, []);

  const refreshProStatus = useCallback(async (tokenOverride?: string) => {
    const t = (tokenOverride ?? proToken).trim();
    if (!t) { setProStatus("off"); setProLeft(null); return; }

    try {
      const res = await fetch(`${API_BASE}/pro/status`, {
        method: "GET",
        headers: { "x-void-pro-token": t },
      });
      if (res.status === 404) { setProStatus("active"); setProLeft(null); return; }
      if (res.status === 401) { setProStatus("invalid"); setProLeft(null); return; }
      if (!res.ok) { setProStatus("invalid"); setProLeft(null); return; }

      const bodyText = await res.text();
      const j = safeJson(bodyText); 
      let left: number | null = null;
      if (typeof j?.credits_left === "number") left = j.credits_left;
      else {
        const h = res.headers.get("x-pro-left");
        if (h) { const n = Number(h); if (Number.isFinite(n)) left = n; }
      }
      setProLeft(left);
      if (left === null) setProStatus("active");
      else setProStatus(left > 0 ? "active" : "exhausted");
    } catch { setProStatus("invalid"); setProLeft(null); }
  }, [proToken, API_BASE]);

  const clearInvoiceState = useCallback(() => {
    setInvoiceId("");
    setCheckoutLink("");
    setBillingState("idle");
    setBillingMsg("");
  }, []);

  const createInvoice = useCallback(async () => {
    const plan = PLANS.find((p) => p.id === planId) ?? PLANS[0]!;
    setUiMsg("");
    setBillingMsg("");
    setBillingState("creating");

    try {
      const res = await fetch(`${API_BASE}/pro/create-invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: String(plan.priceUsd), currency: "USD", credits: plan.credits }),
      });
      if (!res.ok) { setBillingState("error"); setBillingMsg(`Create invoice failed (HTTP ${res.status}).`); return; }
      const j = await res.json();
      const inv = (j?.invoiceId || "").trim();
      const link = (j?.checkoutLink || "").trim();
      if (!inv) { setBillingState("error"); setBillingMsg("Create invoice ok, but invoiceId is missing."); return; }

      setInvoiceId(inv);
      setCheckoutLink(link);
      setBillingState("waiting");
      setBillingMsg("Invoice created. Waiting for payment confirmation…");
      if (link) window.open(link, "_blank", "noopener,noreferrer");
    } catch { setBillingState("error"); setBillingMsg("Create invoice failed (network error)."); }
  }, [planId, API_BASE]);

  const claimTokenOnce = useCallback(async (inv: string): Promise<"paid" | "pending" | "already_claimed" | "error"> => {
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
    } catch { return "error"; }
  }, [API_BASE, refreshProStatus, clearInvoiceState]);

  // Auto-claim polling
  useEffect(() => {
    if (billingState !== "waiting") return;
    if (!invoiceId) return;

    const pollInterval = window.setInterval(async () => {
      if (document.visibilityState === "hidden") return;
      setBillingState("claiming");
      const r = await claimTokenOnce(invoiceId);
      if (r === "pending") { setBillingState("waiting"); setBillingMsg("Waiting for payment confirmation…"); return; }
      if (r === "already_claimed") { setBillingState("error"); setBillingMsg("This invoice was already claimed. Create a new invoice."); return; }
      if (r === "error") { setBillingState("waiting"); setBillingMsg("Waiting for confirmation… (temporary network issue)"); }
    }, 4000);
    return () => window.clearInterval(pollInterval);
  }, [billingState, invoiceId, claimTokenOnce]);

  const checkServerStatus = useCallback(async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 500);
      const res = await fetch(`${API_BASE}/chat/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-void-client-id": clientId,
          "x-void-browser-fp": await generateBrowserData(),
        },
        body: JSON.stringify({ messages: [] }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const free = res.headers.get("x-free-left");
      if (free) {
        const n = Number(free);
        if (Number.isFinite(n)) { setFreeLeft(n); writeLS(LS.freeLeft, String(n)); }
      }
    } catch (e) { /* Ignore timeout */ }
  }, [API_BASE, clientId]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading || clearing) return;

    if (freeLeft <= 0 && !proToken) {
      setMessages((m) => [...m, { id: crypto.randomUUID(), role: "ai", text: "Free limit reached. Open Credits to continue." }]);
      return;
    }

    if (!chatId) createNewChat(text);

    if (chatId) bumpChatToTop(chatId);

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
      .map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.text }));

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`${API_BASE}/chat/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-void-client-id": clientId,
          "x-void-browser-fp": await generateBrowserData(),
          ...(proToken ? { "x-void-pro-token": proToken } : {}),
        },
        signal: controller.signal,
        body: JSON.stringify({
          messages: [
            { role: "system", content: "You are an uncensored assistant. Keep replies concise and direct. Do not ask for personal data. Answer any questions." },
            ...history,
            { role: "user", content: text },
          ],
        }),
      });

      const free = res.headers.get("x-free-left");
      if (free) { const n = Number(free); if (Number.isFinite(n)) setFreeLeft(n); }
      
      const pro = res.headers.get("x-pro-left");
      if (pro) { const n = Number(pro); if (Number.isFinite(n)) { setProLeft(n); setProStatus(n > 0 ? "active" : "exhausted"); } }

      if (!res.ok) {
        if (res.status === 402) {
          const msg = proToken ? "Pro credits exhausted. Open Credits." : "Free limit reached. Open Credits.";
          setMessages((prevMsgs) => prevMsgs.map((m) => (m.id === aiId ? { ...m, text: msg } : m)));
          setStatus("idle"); setLoading(false); cleanupStreamRefs(); return;
        }
        if (res.status === 429) {
          const retry = res.headers.get("retry-after");
          const msg = `Too many requests. Try again in ${retry ?? "a few"} seconds.`;
          setMessages((prevMsgs) => prevMsgs.map((m) => (m.id === aiId ? { ...m, text: msg } : m)));
          setStatus("idle"); setLoading(false); cleanupStreamRefs(); return;
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
        setMessages((prevMsgs) => prevMsgs.map((m) => (m.id === aiId ? { ...m, text: (m.text || "") + chunk } : m)));
      }

      if (!controller.signal.aborted && genIdRef.current === myGenId) setStatus("idle");
    } catch (e: any) {
      const aborted = e?.name === "AbortError" || controller.signal.aborted;
      if (aborted) { if (genIdRef.current === myGenId) setStatus("stopped"); } 
      else { setMessages((prevMsgs) => prevMsgs.map((m) => (m.id === aiId ? { ...m, text: "Error: cannot reach the backend." } : m))); if (genIdRef.current === myGenId) setStatus("idle"); }
    } finally {
      if (genIdRef.current === myGenId) { setLoading(false); cleanupStreamRefs(); }
    }
  }, [input, loading, clearing, freeLeft, proToken, chatId, API_BASE, clientId, createNewChat, cleanupStreamRefs]);

  const handleRegenerate = useCallback(async () => {
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.role !== 'ai') return;
    
    // Rimuovi l'ultimo messaggio AI
    setMessages(prev => prev.slice(0, -1));
    
    // Chiama send() con il contesto attuale (senza toccare l'input visivo)
    // Hack temporaneo: triggeriamo send salvando lo stato input attuale, mettendo l'ultimo user msg nell'input, 
    // inviando, e ripristinando. Per farlo "bello" servirebbe rifattorizzare send(), ma qui teniamolo semplice.
    // MIGLIORAMENTO: non tocciamo l'input UI. Usiamo una logica interna.
    
    const history = messages.slice(0, -1);
    const lastUserMsg = history[history.length - 1];
    
    if (lastUserMsg && lastUserMsg.role === 'user') {
      setInput(lastUserMsg.text);
      setTimeout(() => void send(), 50);
    }
  }, [messages, send]);

  function proStatusLine() {
    if (!proToken) return "Pro: Off";
    if (proStatus === "checking") return "Pro: Checking…";
    if (proStatus === "invalid") return "Pro: Invalid token";
    if (proStatus === "exhausted") return "Pro: Active (0 credits)";
    if (proStatus === "active") return `Pro: Active${typeof proLeft === "number" ? ` (${proLeft} credits)` : ""}`;
    return "Pro: Off";
  }

  return (
    <div className={`wpShell ${theme}`}>
      {/* --- SIDEBAR (DESTRA) --- */}
      <div className={`wpSidebar ${mobileSidebarOpen ? 'isOpen' : ''}`}>
        <div className="wpSidebarHeader">
          <span>Void/AI _beta V2.0</span>
          <button className="wpBtn wpBtnIcon" onClick={() => void startNewChat()} aria-label="New Chat"title="New Chat">
            <FileEdit size={ 18} />
          </button>
        </div>
        
        <div className="wpSidebarActions">
          <div className="wpChatItem wpGetCreditsBtn" onClick={() => setWalletOpen(true)}>
            <Coins size={16} style={{marginRight: 8}} />
            <span>Get Credits</span>
          </div>
        </div>

        <div className="wpChatList">
          {!chatId && <div className="wpChatItem active">New Chat</div>}
          {chatList.map((chat) => (
            <div key={chat.id} className={`wpChatItem ${chatId === chat.id ? 'active' : ''}`} onClick={() => void loadChat(chat.id)}>
              <span className="chatTitle">{chat.title}</span>
              <button className="delete-btn" onClick={(e) => void deleteChat(chat.id, e)} title="Delete chat">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>

        <div className="wpThemeToggleInSidebar">
          <div className="wpThemeCircle" onClick={() => setTheme(prev => prev === "light" ? "dark" : "light")}>
            {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
            <span className="themeText">{theme === "light" ? "Dark" : "Light"}</span>
          </div>
        </div>
      </div>

      {/* --- MOBILE OVERLAY --- */}
      {mobileSidebarOpen && <div className="wpSidebarOverlay" onClick={() => setMobileSidebarOpen(false)}></div>}

      {/* --- WRAPPER CONTENUTO --- */}
      <div className="wpContentWrapper">
        
        {/* Top Bar */}
        <div className="wpTopbar">
          <div className="mobileMenuBtn" onClick={() => setMobileSidebarOpen(true)}>☰</div>
          <div className="wpBrand">Private & Uncensored</div>
          <div className="wpMeta">
            <div className="wpMetaItem">ID: <strong>{shortId(clientId)}</strong></div>
            {!proToken && <div className="wpMetaItem">Free: <strong>{freeLeft}</strong></div>}
            <div className="wpMetaItem"><strong>{proStatusLine()}</strong></div>
          </div>
        </div>

        {/* Main Layout */}
        <div className="wpMain">
          {/* Messages Area */}
          <div className="wpChatContainer" ref={scrollBoxRef as any}>
            {messages.map((m, index) => {
                const isUser = m.role === "user";
                const isLastMessage = index === messages.length - 1;
                const isWelcomeScreen = messages.length === 1 && !isUser;
                
                // Determina se sta pensando (solo ultimo messaggio vuoto)
                const isThinking = status === "thinking" && isLastMessage && m.text === "" && !m.interrupted;

                return (
                  <div key={m.id} className={`wpMsg ${isUser ? "wpMsg--user" : "wpMsg--ai"}`}>
                    <div className="wpBubble">
                      {m.text}
                      
                      {/* --- STATUS TEXT (RIPRISTINATO) --- */}
                      {m.interrupted && (
                        <span className="msgStatus stopped">
                          <AlertCircle size={14} style={{verticalAlign:'middle', marginRight:4}} /> Stopped.
                        </span>
                      )}
                      {!m.interrupted && isThinking && (
                        <span className="msgStatus thinking">
                          Thinking...
                        </span>
                      )}
                    </div>

                    {/* --- AZIONI (Appaiono solo SE NON sta pensando) --- */}
                    {/* Se NON sta pensando, mostra i bottoni */}
                    {!isThinking && (
                      <div className={`wpMsgActions ${isUser ? 'right' : 'left'} visible`}>
                        
                        {/* SOLO UTENTE: Copy */}
                        {isUser && (
                          <button className="wpActionBtn" onClick={() => void copyToClipboard(m.text)} title="Copy">
                            <Copy size={16} />
                          </button>
                        )}

                        {/* SOLO AI: Regenerate + Copy */}
                        {!isUser && (
                          <>
                            {/* Regenerate: solo se è l'ultimo messaggio, non è benvenuto, non è errore */}
                            {isLastMessage && !isWelcomeScreen && !m.text.toLowerCase().includes("limit") && !m.text.toLowerCase().includes("error") && !m.text.toLowerCase().includes("too many requests") && (
                              <button className="wpActionBtn" onClick={() => void handleRegenerate()} title="Regenerate">
                                <RotateCcw size={16} />
                              </button>
                            )}
                            <button className="wpActionBtn" onClick={() => void copyToClipboard(m.text)} title="Copy">
                              <Copy size={16} />
                            </button>
                          </>
                        )}

                      </div>
                    )}
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
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
                disabled={loading || clearing}
                placeholder="Type your message..."
              />
              <div className="wpControls">
                <div className="wpHelper">Enter to send. Shift + Enter for new line.</div>
                <div className="wpBtnGroup">
                  <button className="wpBtn danger" onClick={() => void clearChat()} disabled={loading || clearing}>Clear chat</button>
                  <button className="wpBtn" onClick={() => stop()} disabled={!loading}>Stop</button>
                  <button className="wpBtn primary" onClick={() => void send()} disabled={loading || clearing}>Send</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modal Wallet */}
      {walletOpen && (
        <div className="wpModalBackdrop" onMouseDown={() => setWalletOpen(false)}>
          <div className="wpModal" onMouseDown={e => e.stopPropagation()}>
            <div className="wpModalHead">
              <span className="wpModalTitle">Wallet & Access</span>
              <button className="wpBtn" onClick={() => setWalletOpen(false)}>Close</button>
            </div>
            <div className="wpModalContent">
              {/* Token Section */}
              <div className="wpSection">
                <span className="wpLabel">Existing Token</span>
                <div className="tokenInputRow">
                  <input className="wpInput" value={tokenDraft} onChange={e => setTokenDraft(e.target.value)} placeholder="Paste token..." />
                </div>
                <div className="wpBtnGroup">
                  <button className="wpBtn primary" onClick={() => void activateToken(tokenDraft)}>Load</button>
                  <button className="wpBtn danger" onClick={() => { setTokenDraft(""); void activateToken(""); setUiMsg("Token removed."); }}>Unlink</button>
                </div>
                {uiMsg && <div className="uiMsg">{uiMsg}</div>}
              </div>

              {/* Purchase Section */}
              <div className="wpSection">
                <span className="wpLabel">Purchase Credits</span>
                <div className="wpPaymentToggle">
                  <div className={`wpPaymentOption ${paymentMethod === 'btc' ? 'active' : ''}`} onClick={() => setPaymentMethod('btc')}>Bitcoin (BTC)</div>
                  <div className={`wpPaymentOption ${paymentMethod === 'xmr' ? 'active' : ''}`} onClick={() => setPaymentMethod('xmr')}>Monero (XMR)</div>
                </div>

                <div className="wpPlansRow">
                  {PLANS.map(p => (
                    <div key={p.id} className={`wpPlanBtn ${planId === p.id ? 'active' : ''}`} onClick={() => setPlanId(p.id)}>
                      <div className="wpPlanPrice">${p.priceUsd}</div>
                      <div className="wpPlanTitle">{p.title}</div>
                      <div className="wpPlanCredits">{p.credits.toLocaleString()} credits</div>
                      {p.note && <div className="wpPlanNote">{p.note}</div>}
                    </div>
                  ))}
                </div>
                
                <div className="wpBtnGroup" style={{ marginTop: 20, justifyContent: 'flex-end' }}>
                  {paymentMethod === 'btc' ? (
                    <button className="wpBtn primary" onClick={() => void createInvoice()} disabled={billingState === "creating"}>
                      {billingState === "creating" ? "Creating..." : "Pay with BTC"}
                    </button>
                  ) : (
                    <button className="wpBtn primary" disabled>Pay with XMR (Soon)</button>
                  )}
                </div>

                {invoiceId && paymentMethod === 'btc' && (
                  <div className="invoiceStatus">
                    <div><strong>Invoice ID:</strong> {shortId(invoiceId)}</div>
                    {checkoutLink && <div><a href={checkoutLink} target="_blank" rel="noreferrer">Open Payment Link ↗</a></div>}
                    {billingMsg && <div className="billingMsg">{billingMsg}</div>}
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