"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Msg = { id?: string; role: "user" | "ai"; text: string };

export default function Page() {
  const API_BASE = useMemo(
    () => process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000",
    []
  );

  const [messages, setMessages] = useState<Msg[]>([
    { role: "ai", text: "Hi. How can I help you?" },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const messagesRef = useRef<Msg[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const endRef = useRef<HTMLDivElement | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  function stop() {
    try {
      abortRef.current?.abort();
    } catch {
    }

    const r = readerRef.current;
    if (r) {
      r.cancel().catch(() => {
      });
    }

    abortRef.current = null;
    readerRef.current = null;
    setLoading(false);
  }


  function clearChat() {
    stop(); // interrompe eventuale streaming in corso [web:347]

    const cleared: Msg[] = [
      { role: "ai", text: "Chat cleared. How can I help?" },
    ];

    messagesRef.current = cleared; // IMPORTANTISSIMO: resetta la history usata da send()
    setMessages(cleared);
  }


  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    const aiId = crypto.randomUUID();

    setMessages((m: any[]) => [...m, { role: "user", text }, { role: "ai", id: aiId, text: "" }]);
    setInput("");
    setLoading(true);

    // prendi un po’ di history (ultimi 12 messaggi)
    const history = messagesRef.current
      .filter((m: any) => m.role === "user" || m.role === "ai")
      .slice(-12)
      .map((m: any) => ({
        role: m.role === "user" ? "user" : "assistant",
        content: m.text,
      }));

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`${API_BASE}/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          messages: [
            { role: "system", content: "You are a helpful assistant. Reply in English." },
            ...history,
            { role: "user", content: text },
          ],
        }),
      });

      if (!res.body) throw new Error("No stream body");

      const reader = res.body.getReader();
      readerRef.current = reader;
      const decoder = new TextDecoder();

      while (true) {
        if (abortRef.current?.signal.aborted) break; // se hai premuto Stop [web:347]
        const { value, done } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });

        setMessages((prev: any[]) =>
          prev.map((m) => (m.id === aiId ? { ...m, text: (m.text || "") + chunk } : m))
        );
      }
    } catch (e: any) {
      if (e?.name === "AbortError") {
        return;
      }
      setMessages((prev: any[]) =>
        prev.map((m) => (m.id === aiId ? { ...m, text: "Error: cannot reach the backend." } : m))
      );
    } finally {
      abortRef.current = null;
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#171717] text-white">
      {/* Top bar */}
      <div className="sticky top-0 z-10 border-b border-white/10 bg-[#171717]/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-md bg-white/5 ring-1 ring-white/10" />
            <div className="leading-tight">
              <div className="text-sm font-semibold tracking-wide">void.ai _beta _V1.3</div>
              <div className="text-xs text-white/60">Private chat • local LLM</div>
            </div>
          </div>

          <div className="hidden sm:block text-xs text-white/60">
            API: <span className="text-white/90">{API_BASE}</span>
          </div>

          <a
            className="rounded-md border border-[#FF570A]/40 bg-[#FF570A]/10 px-3 py-2 text-xs font-semibold text-[#FF570A] hover:bg-[#FF570A]/15"
            href="#chat"
          >
            Open chat
          </a>
        </div>
      </div>

      {/* Hero */}
      <div className="mx-auto max-w-6xl px-4 pt-10 pb-6">
        <div className="relative overflow-hidden rounded-xl border border-white/10 bg-gradient-to-b from-white/5 to-transparent p-6 sm:p-10">
          <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[#FF570A]/15 blur-3xl" />
          <div className="absolute -left-24 -bottom-24 h-72 w-72 rounded-full bg-fuchsia-400/10 blur-3xl" />

          <div className="relative">
            <div className="inline-flex items-center gap-2 rounded-md border border-[#FF570A]/30 bg-[#FF570A]/10 px-3 py-1 text-xs font-semibold text-[#FF570A]">
              VOID_MODE
              <span className="text-white/50">•</span>
              Local first
            </div>

            <h1 className="mt-4 text-balance text-3xl font-semibold tracking-tight sm:text-5xl">
              Private and Uncensored AI.
            </h1>

            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-white/70 sm:text-base">
              Local Demo: Ollama (dolphin-mistral).
            </p>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <a
                href="#chat"
                className="inline-flex items-center justify-center rounded-md bg-[#FF570A] px-4 py-3 text-sm font-semibold text-black hover:brightness-110"
              >
                Go to chat
              </a>

              {/*<div className="rounded-md border border-white/10 bg-white/5 px-4 py-3 text-xs text-white/70">
                OPEN SOURCE
              </div>*/}
            </div>
          </div>
        </div>
      </div>

      {/* Chat card */}
      <div id="chat" className="mx-auto max-w-6xl px-4 pb-12">
        <div className="rounded-xl border border-white/10 bg-white/5">
          {/* Chat header */}
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div className="text-sm font-semibold">Chat</div>
            <button
              className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70 hover:bg-white/10"
              onClick={clearChat}
              disabled={loading}
            >
              Clear
            </button>
          </div>

          {/* Messages */}
          <div className="h-[55vh] overflow-y-auto px-4 py-4">
            {messages.map((m, i) => (
              <div
                key={i}
                className={`mb-3 flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={[
                    "max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
                    m.role === "user"
                      ? "bg-[#FF570A] text-black"
                      : "bg-[#0f0f0f] text-white border border-white/10",
                  ].join(" ")}
                >
                  {m.text}
                </div>
              </div>
            ))}

            {loading && (
              <div className="mb-3 flex justify-start">
                <div className="max-w-[85%] rounded-2xl border border-white/10 bg-[#0f0f0f] px-4 py-3 text-sm text-white/70">
                  Thinking...
                </div>
              </div>
            )}

            <div ref={endRef} />
          </div>

          {/* Input */}
          <div className="border-t border-white/10 p-4">
            <div className="flex gap-2">
              <input
                className="flex-1 rounded-md border border-white/10 bg-[#0f0f0f] px-4 py-3 text-sm text-white placeholder:text-white/40 outline-none focus:border-[#FF570A]/60"
                placeholder="Write here..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") send();
                }}
                disabled={loading}
              />
              <button
                className="rounded-xl border bg-[#FF570A] px-4 py-3 text-sm text-black disabled:opacity-50"
                onClick={send}
                disabled={loading || !input.trim()}
              >
                Send
              </button>
              <button
                className="rounded-xl border border-zinc-700 px-4 py-3 text-sm text-zinc-200 disabled:opacity-50"
                onClick={stop}
                disabled={!loading}
              >
                Stop
              </button>
            </div>

            <div className="mt-2 text-xs text-white/50">
              No account • Dev • “NEXT_PUBLIC_API_BASE” is pubblic (only URL, no secret). [web:69]
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}