"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  HelpCircle,
  FileCheck,
  Info,
  Star,
} from "lucide-react";

// Types & constants
import {
  type Msg,
  type ChatMeta,
  type ProStatus,
  type PlanConfig,
  LS,
} from "@/components/types";

// Components
import Sidebar from "@/components/layout/Sidebar";
import TopBar from "@/components/layout/TopBar";
import Composer from "@/components/layout/Composer";
import ChatContainer from "@/components/chat/ChatContainer";
import WalletModal from "@/components/modals/WalletModal";
import PaymentDetailsModal from "@/components/modals/PaymentDetailsModal";
import SettingsModal from "@/components/modals/SettingsModal";

/* ─────────────────────────────────────────────
 *  HELPER FUNCTIONS
 * ───────────────────────────────────────────── */

function readLS(key: string): string {
  try {
    if (typeof window === "undefined") return "";
    return (localStorage.getItem(key) || "").trim();
  } catch {
    return "";
  }
}

function writeLS(key: string, value: string): void {
  try {
    if (typeof window === "undefined") return;
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {}
}

function safeJson(text: string) {
  try { return JSON.parse(text); } catch { return null; }
}

async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

function shortId(id: string) {
  return id ? `${id.slice(0, 8)}…` : "—";
}

async function generateBrowserData(): Promise<string> {
  const nav = window.navigator;
  const screen = window.screen;
  const dataString = [
    nav.userAgent,
    nav.language,
    screen.colorDepth,
    new Date().getTimezoneOffset(),
    `${screen.width}x${screen.height}`,
  ].join("||");
  const msgBuffer = new TextEncoder().encode(dataString);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/* ─────────────────────────────────────────────
 *  PAGE COMPONENT (Orchestrator)
 * ───────────────────────────────────────────── */

export default function Page() {
  const DEFAULT_API = process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000";

  // ─── STATE ───

  // API
  const [apiUrl, setApiUrl] = useState<string>(DEFAULT_API);
  // Wallet addresses (loaded from backend /config)

  const [paymentsEnabled, setPaymentsEnabled] = useState(false);

  // AI URL (self-hosted)
  const [aiUrl, setAiUrl] = useState(""); // empty = use default from backend
  const [aiUrlDefault, setAiUrlDefault] = useState(""); // default from /config
  const [aiUrlMessage, setAiUrlMessage] = useState("");

  // Identity (only needed in payment mode)
  const [clientId, setClientId] = useState("");

  // Pro
  const [proToken, setProToken] = useState("");
  const [tokenDraft, setTokenDraft] = useState("");
  const [proStatus, setProStatus] = useState<ProStatus>("off");
  const [proLeft, setProLeft] = useState<number | null>(null);
  const [uiMsg, setUiMsg] = useState("");

  // Plans (from server when PAYMENTS_ENABLED=1)
  const [plans, setPlans] = useState<PlanConfig[]>([]);

  // Billing / Wallet
  const [walletOpen, setWalletOpen] = useState(false);
  const [planId, setPlanId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"btc" | "xmr">("btc");
  const [paymentDetailsOpen, setPaymentDetailsOpen] = useState(false);

  // Chat
  const [messages, setMessages] = useState<Msg[]>([
    { id: "welcome", role: "ai", text: "Welcome. How can I help?" },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<"idle" | "thinking" | "stopped">("idle");
  const [clearing, setClearing] = useState(false);

  // Chat history
  const [chatId, setChatId] = useState<string | null>(null);
  const [chatList, setChatList] = useState<ChatMeta[]>([]);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  // UI
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [faqOpen, setFaqOpen] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);

  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);

  // Wallet addresses (replace in .env or backend config before deploying)

  // Refs
  const messagesRef = useRef<Msg[]>(messages);
  const abortRef = useRef<AbortController | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const genIdRef = useRef<string | null>(null);
  const scrollBoxRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRef = useRef(true);

  // ─── EFFECTS ───

  // Sync messages ref
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // Click outside to close menus
  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".chatMenuContainer")) {
        setActiveMenuId(null);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".wpBrandContainer")) {
        setModelDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  // Load models
  useEffect(() => {
    const loadModels = async () => {
      try {
        const res = await fetch(`${apiUrl}/models`);
        const data = await res.json();
        if (data.models && data.models.length > 0) {
          setModels(data.models);
          const suggestedModel = data.default || data.models[0];
          if (data.models.includes(suggestedModel)) {
            setSelectedModel(suggestedModel);
          }
        }
      } catch (e) {
        console.error("Failed to load models — using default", e);
      }
    };
    loadModels();
  }, [apiUrl]);

  // Scroll behavior
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
    bottomRef.current?.scrollIntoView({
      behavior: loading ? "auto" : "smooth",
      block: "end",
    });
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

  // Persistence — messages to localStorage
  useEffect(() => {
    if (chatId) {
      const timeoutId = setTimeout(() => {
        try {
          localStorage.setItem(`void_chat_${chatId}`, JSON.stringify(messages));
        } catch (e) {
          console.error("Error saving chat", e);
        }
      }, 1000);
      return () => clearTimeout(timeoutId);
    }
  }, [messages, chatId]);

  // ─── INIT ───

  useEffect(() => {
    let id = readLS(LS.clientId);
    if (!id) {
      id = crypto.randomUUID();
      writeLS(LS.clientId, id);
    }
    setClientId(id);

    const savedChatId = readLS("void_active_chat_id");
    if (savedChatId) {
      setChatId(savedChatId);
      void loadChat(savedChatId);
    } else {
      setChatId(null);
      setMessages([{
        id: crypto.randomUUID(),
        role: "ai",
        text: "New chat. What do you want to do?",
      }]);
    }

    loadChatList();

    const t = readLS(LS.proToken);
    setProToken(t);
    setTokenDraft(t);

    const savedPlanId = readLS(LS.planId);
    if (savedPlanId) setPlanId(savedPlanId);


    if (t) {
      setProStatus("checking");
      void refreshProStatus(t);
    } else {
      setProStatus("off");
      setProLeft(null);
    }

    // Fetch server config (payments enabled/disabled)
    void (async () => {
      try {
        const cfg = await fetch(`${apiUrl}/config`).then((r) => r.json());
        if (cfg.payments_enabled !== undefined) setPaymentsEnabled(cfg.payments_enabled);
        if (cfg.ai_base_url) setAiUrlDefault(cfg.ai_base_url);
        // Load plans from server when payments are enabled
        if (cfg.payments_enabled && Array.isArray(cfg.plans) && cfg.plans.length > 0) {
          const serverPlans = cfg.plans.map((p: any) => ({
            id: p.id,
            title: p.title,
            credits: p.credits,
            priceUsd: p.price_usd,
            note: p.note || "",
          }));
          setPlans(serverPlans);
          setPlanId(serverPlans[0]?.id || "");
        }
      } catch { /* ignore */ }
    })();

    void checkServerStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist simple vars
  useEffect(() => writeLS(LS.proToken, proToken), [proToken]);
  useEffect(() => writeLS(LS.planId, planId), [planId]);

  // ─── CHAT STREAMING (placed before handlers that use stop) ───

  const cleanupStreamRefs = useCallback(() => {
    abortRef.current = null;
    readerRef.current = null;
  }, []);

  const stop = useCallback(() => {
    try { abortRef.current?.abort(); } catch {}
    const r = readerRef.current;
    if (r) r.cancel().catch(() => {});
    cleanupStreamRefs();
    const cur = messagesRef.current;
    const last = cur[cur.length - 1];
    if (last && last.role === "ai") {
      setMessages((p) => p.map((m) => (m.id === last.id ? { ...m, interrupted: true } : m)));
    }
    setLoading(false);
    setStatus("stopped");
  }, [cleanupStreamRefs]);

  // ─── HANDLERS ───

  const loadChatList = useCallback(() => {
    try {
      const raw = localStorage.getItem("void_chat_history");
      if (raw) {
        const list: ChatMeta[] = JSON.parse(raw);
        list.sort((a, b) => b.updatedAt - a.updatedAt);
        setChatList(list);
      }
    } catch (e) {
      console.error("Failed to load chats", e);
    }
  }, []);

  const loadChat = useCallback((id: string) => {
    try {
      const raw = localStorage.getItem(`void_chat_${id}`);
      if (raw) {
        const msgs: Msg[] = JSON.parse(raw);
        setMessages(msgs);
        setChatId(id);
        writeLS("void_active_chat_id", id);
        setMobileSidebarOpen(false);
      }
    } catch (e) {
      console.error("Failed to load chat", e);
    }
  }, []);

  const createNewChat = useCallback((firstMessage: string) => {
    const newId = crypto.randomUUID();
    const title = firstMessage.slice(0, 30).trim() + (firstMessage.length > 30 ? "..." : "");
    const newChat: ChatMeta = { id: newId, title: title || "New Chat", updatedAt: Date.now() };
    setChatList((p) => [newChat, ...p]);
    setChatId(newId);
    writeLS("void_active_chat_id", newId);
    const existingRaw = localStorage.getItem("void_chat_history");
    const list: ChatMeta[] = existingRaw ? JSON.parse(existingRaw) : [];
    list.push(newChat);
    localStorage.setItem("void_chat_history", JSON.stringify(list));
    localStorage.setItem(`void_chat_${newId}`, JSON.stringify(messagesRef.current));
  }, []);

  const startNewChat = useCallback(() => {
    if (clearing) return;
    stop();
    setClearing(true);
    setChatId(null);
    setMessages([{ id: crypto.randomUUID(), role: "ai", text: "New chat. What do you want to do?", interrupted: false }]);
    setInput("");
    writeLS("void_active_chat_id", "");
    setMobileSidebarOpen(false);
    setTimeout(() => setClearing(false), 150);
  }, [clearing, stop]);

  const clearChat = useCallback(async () => {
    if (clearing) return;
    if (!confirm("Are you sure you want to delete this chat?")) return;
    stop();
    setClearing(true);
    if (chatId) {
      setChatList((p) => p.filter((c) => c.id !== chatId));
      const listRaw = localStorage.getItem("void_chat_history");
      if (listRaw) {
        const list: ChatMeta[] = JSON.parse(listRaw);
        localStorage.setItem("void_chat_history", JSON.stringify(list.filter((c) => c.id !== chatId)));
      }
      localStorage.removeItem(`void_chat_${chatId}`);
    }
    setChatId(null);
    setMessages([{ id: crypto.randomUUID(), role: "ai", text: "Conversation deleted.", interrupted: false }]);
    setInput("");
    writeLS("void_active_chat_id", "");
    setTimeout(() => setClearing(false), 150);
  }, [chatId, clearing, stop]);

  const deleteChat = useCallback(
    (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (!confirm("Are you sure you want to delete this chat?")) return;
      setChatList((p) => p.filter((c) => c.id !== id));
      if (chatId === id) void clearChat();
      const listRaw = localStorage.getItem("void_chat_history");
      if (listRaw) {
        const list: ChatMeta[] = JSON.parse(listRaw);
        localStorage.setItem("void_chat_history", JSON.stringify(list.filter((c) => c.id !== id)));
      }
      localStorage.removeItem(`void_chat_${id}`);
    },
    [chatId, clearChat]
  );

  const togglePin = useCallback((id: string) => {
    setChatList((prev) => {
      const list = prev.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c));
      list.sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return b.updatedAt - a.updatedAt;
      });
      localStorage.setItem("void_chat_history", JSON.stringify(list));
      return list;
    });
    setActiveMenuId(null);
  }, []);

  const renameChat = useCallback((id: string, currentTitle: string) => {
    const newName = prompt("New chat name:", currentTitle);
    if (newName && newName.trim()) {
      setChatList((prev) => {
        const list = prev.map((c) => (c.id === id ? { ...c, title: newName.trim() } : c));
        localStorage.setItem("void_chat_history", JSON.stringify(list));
        return list;
      });
    }
    setActiveMenuId(null);
  }, []);

  const duplicateChat = useCallback(
    (id: string) => {
      const msgs = localStorage.getItem(`void_chat_${id}`);
      if (!msgs) return;
      const chatToDupe = chatList.find((c) => c.id === id);
      if (!chatToDupe) return;
      const newId = crypto.randomUUID();
      const newChat: ChatMeta = { id: newId, title: chatToDupe.title + " (Copy)", updatedAt: Date.now(), pinned: false };
      localStorage.setItem(`void_chat_${newId}`, msgs);
      setChatList((prev) => {
        const list = [newChat, ...prev];
        localStorage.setItem("void_chat_history", JSON.stringify(list));
        return list;
      });
      setActiveMenuId(null);
    },
    [chatList]
  );

  const downloadChat = useCallback(
    (id: string, format: "json" | "txt") => {
      const chat = chatList.find((c) => c.id === id);
      const msgsRaw = localStorage.getItem(`void_chat_${id}`);
      if (!chat || !msgsRaw) return;
      const msgs: Msg[] = JSON.parse(msgsRaw);
      let content = "";
      let mime = "text/plain";
      let ext = ".txt";
      if (format === "json") {
        content = JSON.stringify({ meta: chat, messages: msgs }, null, 2);
        mime = "application/json";
        ext = ".json";
      } else {
        content = `Chat: ${chat.title}\nDate: ${new Date(chat.updatedAt).toLocaleString()}\n\n`;
        msgs.forEach((m) => { content += `[${m.role.toUpperCase()}]: ${m.text}\n\n`; });
      }
      const blob = new Blob([content], { type: mime });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${chat.title.replace(/[^a-z0-9]/gi, "_").substring(0, 30)}${ext}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setActiveMenuId(null);
    },
    [chatList]
  );

  const bumpChatToTop = useCallback(
    (id: string) => {
      setChatList((prev) => {
        const list = [...prev];
        const index = list.findIndex((c) => c.id === id);
        if (index !== -1) {
          list[index] = { ...list[index], updatedAt: Date.now() };
          list.sort((a, b) => b.updatedAt - a.updatedAt);
          localStorage.setItem("void_chat_history", JSON.stringify(list));
        }
        return list;
      });
    },
    []
  );

  // ─── PRO / PAYMENTS ───

  const refreshProStatus = useCallback(
    async (tokenOverride?: string) => {
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
        setProStatus(left === null ? "active" : left > 0 ? "active" : "exhausted");
      } catch {
        setProStatus("invalid");
        setProLeft(null);
      }
    },
    [proToken, apiUrl]
  );

  const activateToken = useCallback(
    async (draft: string) => {
      const token = (draft || "").trim();
      setTokenDraft(token);
      if (!token) { setProToken(""); setProStatus("off"); setProLeft(null); return; }
      setProToken(token);
      setProStatus("checking");
      await refreshProStatus(token);
      setUiMsg("Token saved in this browser.");
    },
    [refreshProStatus]
  );

  const proStatusLine = (): string => {
    if (!paymentsEnabled) return "";
    if (!proToken) return "Credits: 0";
    if (proStatus === "checking") return "Credits: Checking…";
    if (proStatus === "invalid") return "Credits: Invalid";
    if (proStatus === "exhausted") return "Credits: 0";
    if (proStatus === "active") {
      if (typeof proLeft === "number") {
        return `Credits: ${proLeft.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
      }
      return `Credits: ${proLeft}`;
    }
    return "Credits: 0";
  };


  const checkServerStatus = useCallback(async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 500);
      await fetch(`${apiUrl}/chat/stream`, {
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
    } catch { /* ignore timeout */ }
  }, [apiUrl, clientId]);

  // ─── MANUAL PAYMENT CHECK ───


  // ─── EXPORT / IMPORT ───

  const handleExportChats = () => {
    try {
      const historyRaw = localStorage.getItem("void_chat_history");
      if (!historyRaw) { alert("No chat to export."); return; }
      const history: ChatMeta[] = JSON.parse(historyRaw);
      const fullBackup = history.map((meta) => ({
        meta,
        messages: JSON.parse(localStorage.getItem(`void_chat_${meta.id}`) || "[]"),
      }));
      const dataStr = JSON.stringify(fullBackup, null, 2);
      const blob = new Blob([dataStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `void_backup_${Date.now()}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      alert("Backup downloaded successfully!");
    } catch {
      alert("Error during export.");
    }
  };

  const handleImportChats = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        if (!Array.isArray(json)) throw new Error("Invalid format");
        const existingRaw = localStorage.getItem("void_chat_history");
        const existing: ChatMeta[] = existingRaw ? JSON.parse(existingRaw) : [];
        const existingIds = new Set(existing.map((c) => c.id));
        let importedCount = 0;
        json.forEach((item: any) => {
          if (item.meta?.id && item.messages && !existingIds.has(item.meta.id)) {
            existing.push(item.meta);
            localStorage.setItem(`void_chat_${item.meta.id}`, JSON.stringify(item.messages));
            importedCount++;
          }
        });
        localStorage.setItem("void_chat_history", JSON.stringify(existing));
        loadChatList();
        setSettingsOpen(false);
        alert(`Imported ${importedCount} chats successfully!`);
      } catch {
        alert("Error during import. Check the file format.");
      }
    };
    reader.readAsText(file);
  };

  const clearAllData = () => {
    if (confirm("WARNING: This will delete all chats and cache locally. Save your token to recover credits. Are you sure?")) {
      localStorage.clear();
      window.location.reload();
    }
  };

  // ─── SAVE AI URL (self-hosted only) ───
  const handleSaveAiUrl = async () => {
    const url = aiUrl || aiUrlDefault;
    setAiUrlMessage("");
    try {
      const res = await fetch(`${apiUrl}/configure/ai-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const json = await res.json();
      if (json.ok) {
        setAiUrlMessage("✓ AI URL saved successfully");
      } else {
        setAiUrlMessage(json.error || "Failed to save AI URL");
      }
    } catch {
      setAiUrlMessage("Network error — is the backend running?");
    }
  };

  // ─── CHAT SEND ───

  const send = useCallback(async () => {
    const text = input.trim();
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
            { role: "system", content: "You are a helpful AI assistant. Keep replies concise and direct." },
            ...history,
            { role: "user", content: text },
          ],
        }),
      });

      const pro = res.headers.get("x-pro-left");
      if (pro) { const n = Number(pro); if (Number.isFinite(n)) { setProLeft(n); setProStatus(n > 0 ? "active" : "exhausted"); } }

      if (!res.ok) {
        if (res.status === 402) {
          const msg = proToken ? "Pro credits exhausted. Open Credits." : "Zero Credits left. Open Credits.";
          setMessages((pm) => pm.map((m) => (m.id === aiId ? { ...m, text: msg } : m)));
          setStatus("idle"); setLoading(false); cleanupStreamRefs(); return;
        }
        if (res.status === 429) {
          const retry = res.headers.get("retry-after");
          const msg = `Too many requests. Try again in ${retry ?? "a few"} seconds.`;
          setMessages((pm) => pm.map((m) => (m.id === aiId ? { ...m, text: msg } : m)));
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
        setMessages((pm) => pm.map((m) => (m.id === aiId ? { ...m, text: (m.text || "") + chunk } : m)));
      }

      if (!controller.signal.aborted && genIdRef.current === myGenId) setStatus("idle");
    } catch (e: any) {
      const isAbort = e?.name === "AbortError" || controller.signal.aborted;
      if (isAbort) {
        if (genIdRef.current === myGenId) setStatus("stopped");
      } else {
        setMessages((pm) => pm.map((m) => (m.id === aiId ? { ...m, text: "Error: cannot reach the backend." } : m)));
        if (genIdRef.current === myGenId) setStatus("idle");
      }
    } finally {
      if (genIdRef.current === myGenId) { setLoading(false); cleanupStreamRefs(); }
    }
  }, [input, loading, clearing, proToken, chatId, apiUrl, clientId, createNewChat, bumpChatToTop, cleanupStreamRefs, selectedModel]);

  const handleRegenerate = useCallback(async () => {
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.role !== "ai") return;
    setMessages((p) => p.slice(0, -1));
    const history = messages.slice(0, -1);
    const lastUserMsg = history[history.length - 1];
    if (lastUserMsg && lastUserMsg.role === "user") {
      setInput(lastUserMsg.text);
      setTimeout(() => void send(), 50);
    }
  }, [messages, send]);

  const handleCopy = useCallback(async (text: string) => { await copyToClipboard(text); }, []);

  // ─── RENDER ───

  return (
    <div className={`wpShell ${theme}`}>
      {/* SIDEBAR */}
      <Sidebar
        chatId={chatId}
        chatList={chatList}
        activeMenuId={activeMenuId}
        mobileSidebarOpen={mobileSidebarOpen}
        onNewChat={startNewChat}
        onLoadChat={loadChat}
        onDeleteChat={deleteChat}
        onTogglePin={togglePin}
        onRenameChat={renameChat}
        onDuplicateChat={duplicateChat}
        onDownloadChat={downloadChat}
        onInfoOpen={() => setInfoOpen(true)}
        showGetCredits={paymentsEnabled}
        onGetCredits={() => paymentsEnabled && setWalletOpen(true)}
        onActiveMenuChange={setActiveMenuId}
        onMobileClose={() => setMobileSidebarOpen(false)}
      />

      {/* CONTENT */}
      <div className="wpContentWrapper">
        <TopBar
          clientId={clientId}
          proStatus={proStatus}
          proLeft={proLeft}
          proToken={proToken}
          models={models}
          selectedModel={selectedModel}
          onModelSelect={setSelectedModel}
          modelDropdownOpen={modelDropdownOpen}
          onModelDropdownToggle={() => setModelDropdownOpen(!modelDropdownOpen)}
          onSettingsOpen={() => setSettingsOpen(true)}
          onMobileMenuOpen={() => setMobileSidebarOpen(true)}
          proStatusLine={proStatusLine}
        />

        <div className="wpMain">
          <ChatContainer
            messages={messages}
            status={status}
            loading={loading}
            onCopy={handleCopy}
            onRegenerate={handleRegenerate}
            scrollBoxRef={scrollBoxRef}
            bottomRef={bottomRef}
          />
          <Composer
            input={input}
            onInputChange={setInput}
            onSend={() => void send()}
            onStop={stop}
            onClearChat={() => void clearChat()}
            loading={loading}
            clearing={clearing}
          />
        </div>
      </div>

      {/* WALLET MODAL — payments mode only */}
      {paymentsEnabled && walletOpen && (
        <WalletModal
          tokenDraft={tokenDraft}
          onTokenDraftChange={setTokenDraft}
          onActivateToken={(d) => void activateToken(d)}
          paymentMethod={paymentMethod}
          onPaymentMethodChange={setPaymentMethod}
          planId={planId}
          plans={plans}
          onPlanIdChange={setPlanId}
          uiMsg={uiMsg}
          onOpenPaymentDetails={() => setPaymentDetailsOpen(true)}
          onClose={() => setWalletOpen(false)}
          onClearToken={() => setTokenDraft("")}
        />
      )}

      {/* PAYMENT DETAILS MODAL */}
      {paymentDetailsOpen && (
        <PaymentDetailsModal
          planId={planId}
          paymentMethod={paymentMethod}
          plans={plans}
          apiUrl={apiUrl}
          onClose={() => setPaymentDetailsOpen(false)}
          onCopy={(t) => void copyToClipboard(t)}
          onTokenReceived={(token) => {
            setProToken(token);
            setTokenDraft(token);
            setUiMsg("Payment confirmed! Token activated.");
            void refreshProStatus(token);
          }}
        />
      )}

      {/* SETTINGS MODAL */}
      {settingsOpen && (
        <SettingsModal
          theme={theme}
          onThemeChange={setTheme}
          onClose={() => setSettingsOpen(false)}
          apiUrl={apiUrl}
          defaultApi={DEFAULT_API}
          onApiUrlChange={setApiUrl}
          onExportChats={handleExportChats}
          onImportChats={handleImportChats}
          onClearAllData={clearAllData}
          showAiUrlField={!paymentsEnabled}
          aiUrl={aiUrl}
          defaultAiUrl={aiUrlDefault}
          onAiUrlChange={setAiUrl}
          onAiUrlSave={handleSaveAiUrl}
          aiUrlMessage={aiUrlMessage}
          showAdvancedSettings={!paymentsEnabled}
        />
      )}

      {/* INFO MODAL */}
      {infoOpen && (
        <div className="wpModalBackdrop" onMouseDown={() => setInfoOpen(false)}>
          <div className="wpModal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="wpModalHead">
              <span className="wpModalTitle">About &amp; Info</span>
              <button className="wpBtn" onClick={() => setInfoOpen(false)}>Close</button>
            </div>
            <div className="wpModalContent">
              <div className="wpModalInfoHeader">
                <div className="wpMainLogo">VOID<span className="logoDot">.</span>AI</div>
              </div>
              <div style={{ textAlign: "center", marginBottom: 20 }}>
                <p style={{ margin: "5px 0 0", color: "var(--wp-muted)", fontSize: 13 }}>Private AI Assistant</p>
              </div>
              <div className="wpSection">
                <span className="wpLabel">Useful Links</span>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <a href="https://github.com/P4v3r/void-ai" target="_blank" rel="noreferrer" className="wpBtn" style={{ width: "100%", justifyContent: "center", alignItems: "center" }}>
                    <Star size={18} style={{ marginRight: 8 }} /> GitHub Repository
                  </a>
                  <button className="wpBtn" onClick={() => setFaqOpen(true)} style={{ width: "100%", justifyContent: "center", alignItems: "center" }}>
                    <HelpCircle size={18} style={{ marginRight: 8 }} /> FAQ
                  </button>
                  <button className="wpBtn" onClick={() => setTermsOpen(true)} style={{ width: "100%", justifyContent: "center", alignItems: "center" }}>
                    <FileCheck size={18} style={{ marginRight: 8 }} /> Terms &amp; Privacy
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* FAQ MODAL */}
      {faqOpen && (
        <div className="wpModalBackdrop" onMouseDown={() => setFaqOpen(false)}>
          <div className="wpModal wpFaqModal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="wpModalHead">
              <span className="wpModalTitle">Frequently Asked Questions</span>
              <button className="wpBtn" onClick={() => setFaqOpen(false)}>Close</button>
            </div>
            <div className="wpModalContent">
              <div className="faqList">
                <div className="faqItem">
                  <div className="faqQ"><HelpCircle size={16} style={{ marginRight: 6 }} /> Is VOID AI really private?</div>
                  <div className="faqA">Yes. No accounts, no email addresses, no personal data stored. All conversations are kept locally in your browser. Your privacy is our priority.</div>
                </div>
                <div className="faqItem">
                  <div className="faqQ"><HelpCircle size={16} style={{ marginRight: 6 }} /> Do you store my data?</div>
                  <div className="faqA">We don&apos;t store chat logs on our servers. All conversations are stored locally in your browser (LocalStorage). Your privacy is our priority.</div>
                </div>
                <div className="faqItem">
                  <div className="faqQ"><HelpCircle size={16} style={{ marginRight: 6 }} /> How do payments work?</div>
                  <div className="faqA">We accept Bitcoin and Monero. Payment is manual. You send the funds to our address and the system verifies the blockchain transaction to generate your access token.</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TERMS MODAL */}
      {termsOpen && (
        <div className="wpModalBackdrop" onMouseDown={() => setTermsOpen(false)}>
          <div className="wpModal wpTermsModal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="wpModalHead">
              <span className="wpModalTitle">Terms &amp; Privacy</span>
              <button className="wpBtn" onClick={() => setTermsOpen(false)}>Close</button>
            </div>
            <div className="wpModalContent">
              <div className="termsContent">
                <h3>1. Privacy Policy</h3>
                <p>We do not collect personal identifiable information (PII). No accounts, no email addresses required.</p>
                <h3>2. Data Storage</h3>
                <p>All chat history is stored locally on your device via LocalStorage.</p>
                <h3>3. Payments &amp; Monero</h3>
                <p>We accept Cryptocurrency (BTC/XMR). All payments are final and non-refundable.</p>
                <h3>4. Disclaimer</h3>
                <p>VOID AI is a private AI assistant. You are responsible for the content you generate and share.</p>
                <h3>5. Limitation of Liability</h3>
                <p>The service is provided &quot;as is&quot;. We are not liable for any damages arising from the use of this software.</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
