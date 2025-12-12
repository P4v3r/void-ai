"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Msg = { role: "user" | "ai"; text: string };

export default function Page() {
  const API_BASE = useMemo(
    () => process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000",
    []
  );

  const [messages, setMessages] = useState<Msg[]>([
    { role: "ai", text: "Ciao. Scrivi qualcosa e premi Invio." },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    setMessages((m) => [...m, { role: "user", text }]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });

      const data = await res.json();
      const answer =
        (typeof data?.text === "string" && data.text) ||
        "Risposta non valida (controlla il backend).";

      setMessages((m) => [...m, { role: "ai", text: answer }]);
    } catch {
      setMessages((m) => [
        ...m,
        { role: "ai", text: "Errore: backend non raggiungibile." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") send();
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-zinc-800" />
            <div>
              <div className="text-sm font-semibold">void.ai</div>
              <div className="text-xs text-zinc-400">Dev chat (locale)</div>
            </div>
          </div>

          <div className="text-xs text-zinc-400">
            API: <span className="text-zinc-200">{API_BASE}</span>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="mx-auto max-w-3xl px-4 py-6 pb-28">
        {messages.map((m, i) => (
          <div
            key={i}
            className={`mb-3 flex ${
              m.role === "user" ? "justify-end" : "justify-start"
            }`}
          >
            <div
              className={[
                "max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
                m.role === "user"
                  ? "bg-indigo-600 text-white"
                  : "bg-zinc-900 text-zinc-100 border border-zinc-800",
              ].join(" ")}
            >
              {m.text}
            </div>
          </div>
        ))}

        {loading && (
          <div className="mb-3 flex justify-start">
            <div className="max-w-[85%] rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-300">
              Sta pensando…
            </div>
          </div>
        )}

        <div ref={endRef} />
      </div>

      {/* Input bar */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-zinc-800 bg-zinc-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl gap-2 px-4 py-3">
          <input
            className="flex-1 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm outline-none placeholder:text-zinc-500 focus:border-zinc-600"
            placeholder="Scrivi un messaggio…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={loading}
          />
          <button
            className="rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
            onClick={send}
            disabled={loading || !input.trim()}
          >
            Invia
          </button>
        </div>

        <div className="mx-auto max-w-3xl px-4 pb-3 text-xs text-zinc-500">
          Nessun account • Dev mode
        </div>
      </div>
    </div>
  );
}
