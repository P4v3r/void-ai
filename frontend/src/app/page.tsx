"use client";

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Copy, RotateCcw, Trash2, Plus, Menu, Sun, Moon, CheckCircle, AlertCircle, FileEdit, Coins,  Settings, Download, Upload, FileText, MoreHorizontal, Info, Pin, Pencil, DownloadCloud, File as FileIcon} from "lucide-react";

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
  { id: "starter", title: "Starter", credits: 500, priceUsd: 2, note: "Quick test." },
  { id: "plus", title: "Plus", credits: 5_000, priceUsd: 10, note: "Best value." },
  { id: "max", title: "Max", credits: 20_000, priceUsd: 25, note: "Heavy usage." },
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
  // Definiamo l'URL di default
  const DEFAULT_API = process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000";
  // Lo rendiamo uno stato modificabile
  const [apiUrl, setApiUrl] = useState<string>(DEFAULT_API);

  // --- STATE ---
  // Identity / limits
  const [clientId, setClientId] = useState<string>("");
  const [freeLeft, setFreeLeft] = useState<number>(0);

  // Pro
  const [proToken, setProToken] = useState<string>("");
  const [tokenDraft, setTokenDraft] = useState<string>("");
  const [proStatus, setProStatus] = useState<ProStatus>("off");
  const [proLeft, setProLeft] = useState<number | null>(null);

  const [paymentDetailsOpen, setPaymentDetailsOpen] = useState(false);
  const [cryptoPrices, setCryptoPrices] = useState<{btc: number, xmr: number} | null>(null);

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

  const [settingsOpen, setSettingsOpen] = useState(false);

  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  const [infoOpen, setInfoOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Incolla qui gli indirizzi dei wallet che hai creato
  const MY_WALLET_BTC = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh"; // <--- CAMBIALO
  const MY_WALLET_XMR = "44Affq6kbKs4YmM2aVZGQV3wXJvP8kR8p9"; // <--- CAMBIALO

  // Modello AI
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState(process.env.NEXT_PUBLIC_DEFAULT_MODEL || "dolphin-mistral");

  type ChatMeta = { id: string; title: string; updatedAt: number; pinned?: boolean; };

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      // Chiudi il menu se clicchi fuori da qualsiasi cosa che non sia un pulsante "more"
      const target = e.target as HTMLElement;
      if (!target.closest('.chatMenuContainer')) {
        setActiveMenuId(null);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  // Effects Refs Sync
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  useEffect(() => {
    // Carica la lista dei modelli dal backend
    const loadModels = async () => {
      try {
        const res = await fetch(`${apiUrl}/models`);
        const data = await res.json();
        if (data.models && data.models.length > 0) {
          setModels(data.models);
          // Usa il default del backend o il primo della lista
          setSelectedModel(data.default || data.models[0]);
        }
      } catch (e) {
        console.error("Failed to load models", e);
      }
    };
    loadModels();
  }, [apiUrl]);

  // --- ACTIONS ---

  const cleanupStreamRefs = useCallback(() => {
    abortRef.current = null;
    readerRef.current = null;
  }, []);

  const fetchPrices = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/pro/get-prices`);
      const data = await res.json();
      setCryptoPrices({ btc: data.btc_usd, xmr: data.xmr_usd });
    } catch (e) {
      console.error("Failed to fetch prices", e);
    }
  }, [apiUrl]);

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

  // --- CHAT ACTIONS ---

const togglePin = useCallback((id: string) => {
  setChatList(prev => {
    const list = prev.map(c => c.id === id ? { ...c, pinned: !c.pinned } : c);
    // Ordina: Pinnati prima, poi per data
    list.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    });
    localStorage.setItem(STORAGE_KEY_CHATS, JSON.stringify(list));
    return list;
  });
  setActiveMenuId(null);
}, []);

const renameChat = useCallback((id: string, currentTitle: string) => {
  const newName = prompt("New chat name:", currentTitle);
  if (newName && newName.trim() !== "") {
    setChatList(prev => {
      const list = prev.map(c => c.id === id ? { ...c, title: newName.trim() } : c);
      localStorage.setItem(STORAGE_KEY_CHATS, JSON.stringify(list));
      return list;
    });
  }
  setActiveMenuId(null);
}, []);

const duplicateChat = useCallback((id: string) => {
  const msgs = localStorage.getItem(`void_chat_${id}`);
  if (!msgs) return;
  const newId = crypto.randomUUID();
  const chatToDupe = chatList.find(c => c.id === id);
  
  if (chatToDupe) {
    const newChat: ChatMeta = {
      id: newId,
      title: chatToDupe.title + " (Copy)",
      updatedAt: Date.now(),
      pinned: false // I duplicati non sono pinnati di solito
    };
    
    // Salva messaggi
    localStorage.setItem(`void_chat_${newId}`, msgs);
    
    // Aggiorna lista
    setChatList(prev => {
      const list = [newChat, ...prev];
      localStorage.setItem(STORAGE_KEY_CHATS, JSON.stringify(list));
      return list;
    });
  }
  setActiveMenuId(null);
}, [chatList]);

const downloadChat = useCallback((id: string, format: 'json' | 'txt') => {
  const chat = chatList.find(c => c.id === id);
  const msgsRaw = localStorage.getItem(`void_chat_${id}`);
  if (!chat || !msgsRaw) return;

  const msgs: Msg[] = JSON.parse(msgsRaw);
  let content = "";
  let mime = "text/plain";
  let ext = ".txt";

  if (format === 'json') {
    content = JSON.stringify({ meta: chat, messages: msgs }, null, 2);
    mime = "application/json";
    ext = ".json";
  } else {
    // TXT simple format
    content = `Chat: ${chat.title}\nDate: ${new Date(chat.updatedAt).toLocaleString()}\n\n`;
    msgs.forEach(m => {
      content += `[${m.role.toUpperCase()}]: ${m.text}\n\n`;
    });
  }

  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${chat.title.replace(/[^a-z0-9]/gi, '_').substring(0, 30)}${ext}`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setActiveMenuId(null);
}, [chatList]);

const clearAllData = useCallback(() => {
  if (confirm("WARNING: This will delete all chats, and cache locally (Save your token to recover credits). Are you sure?")) {
    localStorage.clear();
    window.location.reload(); // Ricarica la pagina pulita
  }
}, []);
  
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
      const res = await fetch(`${apiUrl}/pro/status`, {
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
  }, [proToken, apiUrl]);

  const clearInvoiceState = useCallback(() => {
    setInvoiceId("");
    setCheckoutLink("");
    setBillingState("idle");
    setBillingMsg("");
  }, []);

  // btcpay create invoice removed
  /*const createInvoice = useCallback(async () => {
    const plan = PLANS.find((p) => p.id === planId) ?? PLANS[0]!;
    setUiMsg("");
    setBillingMsg("");
    setBillingState("creating");

    try {
      const res = await fetch(`${apiUrl}/pro/create-invoice`, {
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
  }, [planId, apiUrl]);*/

  // --- FUNZIONE CHECK PAGAMENTO MANUALE ---
  const handleCheckPayment = async () => {
    const plan = PLANS.find((p) => p.id === planId) ?? PLANS[0]!;
    
    if (!plan) return;

    setBillingMsg("Verificando pagamento...");
    setBillingState("claiming");

    try {
      // Chiama l'endpoint che creerai nel backend (che controlla l'API esterna)
      const res = await fetch(`${apiUrl}/pro/manual-claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: plan.id,
          credits: plan.credits,
          amount: plan.priceUsd
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setBillingState("error");
        setBillingMsg(data.detail || "Pagamento non ricevuto o in attesa di conferme.");
        return;
      }

      const j = await res.json();
      const token = (j?.token || "").trim();
      if (!token) throw new Error("No token received");

      // Successo!
      setProToken(token);
      setTokenDraft(token);
      setProStatus("checking");
      void refreshProStatus(token);
      
      setBillingState("done");
      setBillingMsg("Pagamento confermato! Crediti attivati.");
      setWalletOpen(false); // Chiudi il popup

    } catch (e) {
      setBillingState("error");
      setBillingMsg("Errore verifica. Riprova tra qualche minuto.");
      console.error(e);
    }
  };

  /* btcpay auto-claim removed
  const claimTokenOnce = useCallback(async (inv: string): Promise<"paid" | "pending" | "already_claimed" | "error"> => {
    try {
      const res = await fetch(`${apiUrl}/pro/claim`, {
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
  }, [apiUrl, refreshProStatus, clearInvoiceState]);
  */

  /* Auto-claim polling btcpay removed
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
  }, [billingState, invoiceId, claimTokenOnce]);*/

  const checkServerStatus = useCallback(async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 500);
      const res = await fetch(`${apiUrl}/chat/stream`, {
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
  }, [apiUrl, clientId]);

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
      const res = await fetch(`${apiUrl}/chat/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-void-client-id": clientId,
          "x-void-browser-fp": await generateBrowserData(),
          ...(proToken ? { "x-void-pro-token": proToken } : {}),
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: selectedModel,
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
  }, [input, loading, clearing, freeLeft, proToken, chatId, apiUrl, clientId, createNewChat, cleanupStreamRefs]);

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

  // --- EXPORT CHATS ---
const handleExportChats = () => {
  try {
    const historyRaw = localStorage.getItem("void_chat_history");
    if (!historyRaw) {
      alert("No chat to export.");
      return;
    }
    const history: ChatMeta[] = JSON.parse(historyRaw);
    
    // Costruiamo un oggetto completo con meta + messaggi
    const fullBackup = history.map(meta => {
      const msgs = JSON.parse(localStorage.getItem(`void_chat_${meta.id}`) || "[]");
      return { meta, messages: msgs };
    });

    // Creiamo il file JSON
    const dataStr = JSON.stringify(fullBackup, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    
    // Trigger download
    const link = document.createElement("a");
    link.href = url;
    link.download = `void_backup_${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    alert("Backup downloaded successfully!");
  } catch (e) {
    console.error(e);
    alert("Error during export.");
  }
};

// --- IMPORT CHATS ---
const handleImportChats = (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const json = JSON.parse(event.target?.result as string);
      if (!Array.isArray(json)) throw new Error("Formato non valido");

      // Prendiamo la cronologia esistente
      const existingRaw = localStorage.getItem("void_chat_history");
      const existing: ChatMeta[] = existingRaw ? JSON.parse(existingRaw) : [];
      
      // Creiamo un Set degli ID esistenti per evitare duplicati
      const existingIds = new Set(existing.map(c => c.id));

      let importedCount = 0;

      // Loop sul backup
      json.forEach((item: any) => {
        if (item.meta && item.meta.id && item.messages) {
          // Se l'ID non esiste già, lo aggiungiamo
          if (!existingIds.has(item.meta.id)) {
            existing.push(item.meta);
            localStorage.setItem(`void_chat_${item.meta.id}`, JSON.stringify(item.messages));
            importedCount++;
          }
        }
      });

      // Aggiorniamo la lista principale
      localStorage.setItem("void_chat_history", JSON.stringify(existing));
      loadChatList(); // Ricarica la UI
      setSettingsOpen(false); // Chiudiamo il popup
      
      alert(`Import ${importedCount} chats successfully!`);
    } catch (e) {
      console.error(e);
      alert("Error during import. Check the file format.");
    }
  };
  reader.readAsText(file);
};

  return (
    <div className={`wpShell ${theme}`}>
      {/* --- SIDEBAR (DESTRA) --- */}
      <div className={`wpSidebar ${mobileSidebarOpen ? 'isOpen' : ''}`}>
        <div className="wpSidebarHeader">
          <span>Void/AI</span>
          <p style={{color: 'var(--wp-muted)', fontSize: 13}}>_beta V2.1</p>
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
          {!chatId && (
            <div className="wpChatItem active">New Chat</div>
          )}
          
          {chatList.map((chat) => (
            <div 
              key={chat.id} 
              className={`wpChatItem ${chatId === chat.id ? 'active' : ''} ${chat.pinned ? 'pinned' : ''}`}
              onClick={() => void loadChat(chat.id)}
            >
              {/* Pin Icon (visibile solo se pinnato) */}
              {chat.pinned && <Pin size={12} className="pinIcon" fill="currentColor" />}
              
              <span className="chatTitle">{chat.title}</span>
              
              {/* --- BOTTONE MORE (3 PUNTINI) --- */}
              <div className="chatMenuContainer">
                <button 
                  className="moreBtn" 
                  onClick={(e) => {
                    e.stopPropagation(); // Evita di aprire la chat
                    setActiveMenuId(activeMenuId === chat.id ? null : chat.id);
                  }}
                >
                  <MoreHorizontal size={16} />
                </button>

                {/* --- DROPDOWN MENU --- */}
                {activeMenuId === chat.id && (
                  <div className="chatMenu" onClick={e => e.stopPropagation()}>
                    <div className="chatMenuItem" onClick={() => togglePin(chat.id)}>
                      <Pin size={14} style={{marginRight: 8}} /> {chat.pinned ? "Unpin" : "Pin"}
                    </div>
                    <div className="chatMenuItem" onClick={() => renameChat(chat.id, chat.title)}>
                      <Pencil size={14} style={{marginRight: 8}} /> Rename
                    </div>
                    <div className="chatMenuItem" onClick={() => duplicateChat(chat.id)}>
                      <Copy size={14} style={{marginRight: 8}} /> Duplicate
                    </div>
                    
                    {/* Download Submenu (Semplificato qui) */}
                    <div className="chatMenuDivider"></div>
                    <div className="chatMenuItem" onClick={() => downloadChat(chat.id, 'json')}>
                      <FileIcon size={14} style={{marginRight: 8}} /> Export chat (.json)
                    </div>
                    <div className="chatMenuItem" onClick={() => downloadChat(chat.id, 'txt')}>
                      <FileText size={14} style={{marginRight: 8}} /> Plain Text (.txt)
                    </div>
                    {/* Placeholder PDF */}
                    <div className="chatMenuItem disabled" title="Coming soon">
                      <DownloadCloud size={14} style={{marginRight: 8}} /> PDF document (.pdf)
                    </div>

                    <div className="chatMenuDivider"></div>
                    <div className="chatMenuItem danger" onClick={(e) => void deleteChat(chat.id, e)}>
                      <Trash2 size={14} style={{marginRight: 8}} /> Delete
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

       {/* --- SIDEBAR BOTTOM: SETTINGS --- */}
        <div className="wpThemeToggleInSidebar">
          <div className="wpThemeCircle" onClick={() => setSettingsOpen(true)}>
            <Settings size={18} />
            <span style={{marginLeft: 8}}>Settings</span>
          </div>
        </div>
      </div>

      {/* --- MOBILE OVERLAY --- */}
      {mobileSidebarOpen && <div className="wpSidebarOverlay" onClick={() => setMobileSidebarOpen(false)}></div>}

      {/* --- WRAPPER CONTENUTO --- */}
      <div className="wpContentWrapper">
        
        {/* Top Bar */}
        <div className="wpTopbar">
              {/* Mobile Menu */}
              <div className="mobileMenuBtn" onClick={() => setMobileSidebarOpen(true)}>☰</div>

              {/* --- NUOVO MODEL SELECTOR (A SINISTRA) --- */}
              <div className="wpBrandContainer">
                <div className="wpModelInfo">
                  <div className="wpModelName">{selectedModel}</div>
                  <div className="wpModelTags">Uncensored • Private</div>
                </div>
                
                {/* Dropdown per scegliere il modello */}
                <select 
                  className="wpModelSelect"
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  title="Change Model"
                >
                  {models.map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>

              {/* Right Meta */}
              <div className="wpMeta">
                <div className="wpMetaItem">ID: <strong>{shortId(clientId)}</strong></div>
                {!proToken && <div className="wpMetaItem">Free: <strong>{freeLeft}</strong></div>}
                <div className="wpMetaItem"><strong>{proStatusLine()}</strong></div>
                
                <button className="wpBtn wpBtnIcon" onClick={() => setSettingsOpen(true)} title="Settings">
                  <Settings size={18} />
                </button>
                <button className="wpBtn wpBtnIcon" onClick={() => setInfoOpen(true)} title="Info / About">
                  <Info size={18} />
                </button>
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
                              <button className="wpActionBtn" onClick={() => void handleRegenerate()} title="Regenerate / Modify Prompt">
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
  
              {/* 1. Token Esistente */}
              <div className="wpSection">
                <span className="wpLabel">Existing Token</span>
                <div className="tokenInputRow">
                  <input 
                    className="wpInput" 
                    value={tokenDraft} 
                    onChange={e => setTokenDraft(e.target.value)} 
                    placeholder="Paste token here..." 
                  />
                </div>
                <div className="wpBtnGroup">
                  <button className="wpBtn primary" onClick={() => void activateToken(tokenDraft)}>Load</button>
                  <button className="wpBtn danger" onClick={() => { setTokenDraft(""); void activateToken(""); }}>
                    <Trash2 size={14} />
                  </button>
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
                
                {/* Selezione Piano (Visualizzazione Prezzo) */}
                <div className="wpPlansRow" style={{marginBottom: '20px'}}>
                  {PLANS.map(p => (
                    <div 
                      key={p.id} 
                      className={`wpPlanBtn ${planId === p.id ? 'active' : ''}`} 
                      onClick={() => setPlanId(p.id)}
                    >
                      <div className="wpPlanPrice">${p.priceUsd}</div>
                      <div className="wpPlanTitle">{p.title}</div>
                      <div className="wpPlanCredits">{p.credits.toLocaleString()} credits</div>
                    </div>
                  ))}
                </div>

              {/* --- PULSANTE CHE APRE IL NUOVO POPUP --- */}
            <div style={{display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end'}}>
              <button 
                className="wpBtn primary" 
                onClick={() => {
                  // 1. Prende i prezzi freschi
                  void fetchPrices(); 
                  // 2. Apre il popup dettagli
                  setPaymentDetailsOpen(true); 
                }}
              >
                Pay with {paymentMethod === 'btc' ? 'Bitcoin' : 'Monero'}
              </button>
            </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- MODALE DETTAGLI PAGAMENTO (SUB-POPUP) --- */}
      {paymentDetailsOpen && (
        <div className="wpModalBackdrop" onMouseDown={() => setPaymentDetailsOpen(false)}>
          <div className="wpModal wpPaymentDetailsModal" onMouseDown={e => e.stopPropagation()}>
            <div className="wpModalHead">
              <span className="wpModalTitle">Payment Details</span>
              <button className="wpBtn" onClick={() => setPaymentDetailsOpen(false)}>Close</button>
            </div>
            <div className="wpModalContent">
              
              <div style={{textAlign: 'center', marginBottom: 20}}>
                <h3 style={{margin: 0}}>{planId.toUpperCase()} Plan</h3>
                <div style={{fontSize: '20px', fontWeight: 700, color: 'var(--wp-primary)'}}>
                  ${PLANS.find(p => p.id === planId)!.priceUsd}
                </div>
              </div>

              {/* Se non abbiamo ancora i prezzi, mostra caricamento */}
              {!cryptoPrices ? (
                <div style={{textAlign: 'center', padding: 20}}>Fetching current rates...</div>
              ) : (
                <div style={{display: 'flex', flexDirection: 'column', gap: 20, alignItems: 'center'}}>
                  
                  {/* Calcolo Importo */}
                  {(() => {
                    const currentPlan = PLANS.find(p => p.id === planId)!;
                    const priceUsd = currentPlan.priceUsd;
                    const priceCrypto = paymentMethod === 'btc' ? cryptoPrices.btc : cryptoPrices.xmr;
                    const amountCrypto = priceUsd / priceCrypto;
                    
                    // Formattazione indirizzo (tronca se troppo lungo per visualizzazione)
                    const fullAddress = paymentMethod === 'btc' ? MY_WALLET_BTC : MY_WALLET_XMR;
                    const shortAddress = `${fullAddress.substring(0, 6)}...${fullAddress.substring(fullAddress.length - 4)}`;
                    
                    // Formattazione QR Code con Importo
                    // Format Bitcoin: bitcoin:address?amount=x
                    // Format Monero: monero:address?tx_amount=x
                    const qrData = paymentMethod === 'btc' 
                      ? `bitcoin:${fullAddress}?amount=${amountCrypto.toFixed(8)}` 
                      : `monero:${fullAddress}?tx_amount=${amountCrypto.toFixed(12)}`;

                    return (
                      <>
                        {/* Importo Preciso */}
                        <div style={{textAlign: 'center'}}>
                          {/* Importo Preciso (CLICCABILE) */}
                          <div 
                            className="wpCopyAmountBtn"
                            onClick={() => void copyToClipboard(amountCrypto.toFixed(paymentMethod === 'btc' ? 8 : 12))}
                            title="Click to copy amount"
                          >
                            <div className="wpCopyLabel">Send exactly:</div>
                            <div className="wpCopyValue">
                              <span className="amount">{amountCrypto.toFixed(paymentMethod === 'btc' ? 8 : 12)}</span>
                              <span className="currency">{paymentMethod.toUpperCase()}</span>
                              <Copy size={16} />
                            </div>
                          </div>
                        </div>

                        {/* QR Code */}
                        <img 
                          src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrData)}`} 
                          alt="Payment QR" 
                          style={{borderRadius: '8px', border: '1px solid var(--wp-border)', padding: 10, background: 'white'}}
                        />

                        {/* Indirizzo */}
                        <div style={{width: '100%', display: 'flex', gap: 8, alignItems: 'center'}}>
                          <input 
                            className="wpInput" 
                            readOnly 
                            value={fullAddress} 
                            style={{fontFamily: 'monospace', fontSize: '11px', flex: 1}}
                          />
                          <button className="wpBtn" onClick={() => void copyToClipboard(fullAddress)}>
                            <Copy size={16} />
                          </button>
                        </div>

                        {/* Tasto Check Payment */}
                        <button 
                          className="wpBtn primary" 
                          onClick={handleCheckPayment}
                          disabled={billingState === "claiming"}
                          style={{width: '100%', padding: 12, fontSize: 15}}
                        >
                          {billingState === "claiming" ? "Checking..." : "Check Payment"}
                        </button>
                      </>
                    );
                  })()}
                  
                </div>
              )}

            </div>
          </div>
        </div>
      )}

     {/* --- SETTINGS MODAL --- */}
    {settingsOpen && (
      <div className="wpModalBackdrop" onMouseDown={() => setSettingsOpen(false)}>
        <div className="wpModal" onMouseDown={e => e.stopPropagation()}>
          <div className="wpModalHead">
            <span className="wpModalTitle">Settings</span>
            <button className="wpBtn" onClick={() => setSettingsOpen(false)}>Close</button>
          </div>
          <div className="wpModalContent">
  
          {/* --- 1. TEMA --- */}
          <div className="wpSection">
            <span className="wpLabel">Appearance</span>
            <div className="wpThemeToggleInModal">
              <div 
                className={`wpThemeOption ${theme === 'light' ? 'active' : ''}`}
                onClick={() => setTheme('light')}
              >
                <Sun size={16} style={{marginRight:8}} /> Light Mode
              </div>
              <div 
                className={`wpThemeOption ${theme === 'dark' ? 'active' : ''}`}
                onClick={() => setTheme('dark')}
              >
                <Moon size={16} style={{marginRight:8}} /> Dark Mode
              </div>
            </div>
          </div>

          {/* --- 2. GESTIONE DATI --- */}
          <div className="wpSection">
            <span className="wpLabel">Data Management</span>
             <p style={{fontSize: '13px', color: 'var(--wp-muted)', marginBottom: '12px'}}>
              Save your chats locally. You can restore them later if you clear your browser cache.
            </p>
            <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
              <button className="wpBtn primary" onClick={handleExportChats} style={{flex: 1}}>
                <span style={{display: 'flex', alignItems: 'center', gap: 6}}>
                  <Download size={16} /> Export Chats (.json)
                </span>
              </button>
              <input 
                  type="file" 
                  ref={fileInputRef}  // <--- USA REF INVECE DI ID
                  style={{display: 'none'}} 
                  accept=".json"
                  onChange={handleImportChats}
                />
              <button 
                className="wpBtn" 
                onClick={() => fileInputRef.current?.click()} // <--- USA IL REF PER APRIRE
                style={{flex: 1}}
              >
                <span style={{display: 'flex', alignItems: 'center', gap: 6}}>
                  <Upload size={16} /> Import Chats (.json)
                </span>
              </button>
            </div>

            <button className="wpBtn danger" style={{width: '100%', marginTop: 10}} onClick={clearAllData}>
              <span style={{display: 'flex', alignItems: 'center', gap: 6}}>
                <Trash2 size={16} /> Clear All Data
              </span>
            </button>
          </div>

          {/* --- 3. API OVERRIDE --- */}
          <div className="wpSection">
            <span className="wpLabel">Advanced settings</span>
            <p style={{fontSize: '12px', color: 'var(--wp-muted)', marginBottom: '10px'}}>
              Change API URL to use a local or custom instance.
            </p>
            
            <div style={{display: 'flex', gap: 8, marginBottom: 8}}>
              <input 
                className="wpInput" 
                // TRUCCO: Se è uguale a DEFAULT, lascia il value vuoto (così mostra il placeholder)
                // Se è diverso (custom), mostra il valore reale
                value={apiUrl === DEFAULT_API ? "" : apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                placeholder={DEFAULT_API}
                style={{
                  width: '100%',
                  fontWeight: apiUrl === DEFAULT_API ? '400' : '600'
                }}
              />
            </div>

            <div style={{display: 'flex', gap: 8}}>
              {/* Questo bottone è opzionale visto che l'aggiornamento è automatico, ma lo lascio come conferma */}
              <button 
                className="wpBtn primary" 
                onClick={() => {
                  // Qui potresti fare un ping test, ma ora non serve
                }}
                style={{flex: 1}}
              >
                Set URL
              </button>
              <button 
                className="wpBtn" 
                onClick={() => setApiUrl(DEFAULT_API)}
                title="Restore default"
                style={{flex: '0 0 auto'}}
              >
                <RotateCcw size={16} />
              </button>
            </div>
          </div>

        </div>
        </div>
      </div>
    )}

    {/* --- INFO / ABOUT MODAL --- */}
    {infoOpen && (
      <div className="wpModalBackdrop" onMouseDown={() => setInfoOpen(false)}>
        <div className="wpModal" onMouseDown={e => e.stopPropagation()}>
          <div className="wpModalHead">
            <span className="wpModalTitle">About & Info</span>
            <button className="wpBtn" onClick={() => setInfoOpen(false)}>Close</button>
          </div>
          <div className="wpModalContent">
            
            <div style={{textAlign: 'center', marginBottom: 20}}>
              <h2 style={{margin: 0, fontSize: 24}}>VOID/AI</h2>
              <p style={{color: 'var(--wp-muted)', fontSize: 13}}>_beta V2.1</p>
              <p style={{color: 'var(--wp-muted)', fontSize: 13}}>Uncensored & Private Assistant</p>
            </div>

            <div className="wpSection">
              <span className="wpLabel">Useful Links</span>
              <div style={{display: 'flex', flexDirection: 'column', gap: 10}}>
                {/* GitHub */}
                <a href="https://github.com/P4v3r/void-ai" target="_blank" rel="noreferrer" className="wpBtn" style={{width: '100%', justifyContent: 'center', alignItems: 'center'}}>
                  <span style={{fontSize: 18, marginRight: 8}}>⭐</span> GitHub Repository
                </a>

                {/* FAQ */}
                <a href="#" onClick={() => alert("FAQ coming soon!")} className="wpBtn" style={{width: '100%', justifyContent: 'center', alignItems: 'center'}}>
                  <span style={{display: 'flex', alignItems: 'center', gap: 8}}>
                    <FileText size={16} /> FAQ
                  </span>
                </a>

                {/* Terms */}
                <a href="#" onClick={() => alert("Terms coming soon!")} className="wpBtn" style={{width: '100%', justifyContent: 'center', alignItems: 'center'}}>
                  <span style={{display: 'flex', alignItems: 'center', gap: 8}}>
                    <CheckCircle size={16} /> Terms & Privacy
                  </span>
                </a>
              </div>
            </div>

          </div>
        </div>
      </div>
    )}
    </div>
  );
}