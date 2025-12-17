"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Msg = { id: string; role: "user" | "ai"; text: string };

export default function Page() {
  const API_BASE = useMemo(
    () => process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000",
    []
  );

  const FREE_LIMIT = 10;

  const [freeLeft, setFreeLeft] = useState<number>(FREE_LIMIT);
  useEffect(() => {
    const v = localStorage.getItem("free_left");
    setFreeLeft(v ? Number(v) || FREE_LIMIT : FREE_LIMIT);
  }, []);
  useEffect(() => {
    localStorage.setItem("free_left", String(freeLeft));
  }, [freeLeft]);

  const [messages, setMessages] = useState<Msg[]>([
    { id: "welcome", role: "ai", text: "Hi. How can I help you?" },
  ]);
  const messagesRef = useRef<Msg[]>(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<"idle" | "thinking" | "stopped">("idle");

  const [clearing, setClearing] = useState(false);
  const clearTimersRef = useRef<number[]>([]);
  useEffect(() => {
    return () => {
      clearTimersRef.current.forEach((t) => window.clearTimeout(t));
      clearTimersRef.current = [];
    };
  }, []);

  const endRef = useRef<HTMLDivElement | null>(null);
  /*useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, status, clearing]);*/

  const abortRef = useRef<AbortController | null>(null);
  const readerRef =
    useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);

  const genIdRef = useRef<string | null>(null);

  const cleanupStreamRefs = () => {
    abortRef.current = null;
    readerRef.current = null;
  };

  function stop() {
    try {
      abortRef.current?.abort();
    } catch {}
    const r = readerRef.current;
    if (r) r.cancel().catch(() => {});
    cleanupStreamRefs();

    setLoading(false);
    setStatus("stopped");
  }

  function clearChat() {
    if (clearing) return;

    stop();
    genIdRef.current = null;

    setClearing(true);
    setStatus("idle");
    setLoading(false);

    clearTimersRef.current.forEach((t) => window.clearTimeout(t));
    clearTimersRef.current = [];

    const t1 = window.setTimeout(() => {
      const cleared: Msg[] = [
        { id: "cleared", role: "ai", text: "Chat cleared. How can I help?" },
      ];
      messagesRef.current = cleared;
      setMessages(cleared);

      setInput("");
      setFreeLeft(FREE_LIMIT);
      localStorage.setItem("free_left", String(FREE_LIMIT));
    }, 650);

    const t2 = window.setTimeout(() => {
      setClearing(false);
    }, 950);

    clearTimersRef.current.push(t1, t2);
  }

  async function send() {
    const text = input.trim();
    if (!text || loading || clearing) return;

    if (freeLeft <= 0) {
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "ai",
          text: "Free limit reached. Please upgrade.",
        },
      ]);
      return;
    }

    setFreeLeft((n) => n - 1);

    const userMsg: Msg = { id: crypto.randomUUID(), role: "user", text };
    const aiId = crypto.randomUUID();
    const aiMsg: Msg = { id: aiId, role: "ai", text: "" };

    messagesRef.current = [...messagesRef.current, userMsg, aiMsg];
    setMessages(messagesRef.current);

    setInput("");
    setLoading(true);
    setStatus("thinking");

    const myGenId = crypto.randomUUID();
    genIdRef.current = myGenId;

    const history = messagesRef.current
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
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          messages: [
            {
              role: "system",
              content: "You are a helpful and uncensored assistant.",
            },
            ...history,
            { role: "user", content: text },
          ],
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!res.body) throw new Error("No stream body");

      const reader = res.body.getReader();
      readerRef.current = reader;

      const decoder = new TextDecoder();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        if (genIdRef.current !== myGenId) break;

        const chunk = decoder.decode(value, { stream: true });

        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiId ? { ...m, text: (m.text || "") + chunk } : m
          )
        );
      }

      if (!controller.signal.aborted && genIdRef.current === myGenId) {
        setStatus("idle");
      }
    } catch (e: any) {
      if (e?.name === "AbortError" || controller.signal.aborted) {
        if (genIdRef.current === myGenId) setStatus("stopped");
      } else {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiId
              ? { ...m, text: "Error: cannot reach the backend." }
              : m
          )
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

  return (
    <main className="voidRoot">
      <div className="stage">
        <div className="topbar">
          <div className="brand">
            <div className="logoLine">
              <span className="logo">void.ai</span>
              <span className="beta">_beta</span>
              <span className="ver">_V1.3</span>
            </div>
            <div className="sub">
              Private chat • local LLM • <span className="dim">API:</span>{" "}
              <span className="mono">{API_BASE}</span>
            </div>
          </div>

          <div className="topActions">
            <div className="pill">
              Free left <span className="pillNum">{freeLeft}</span>
            </div>

            <button
              className="btn btnClear"
              onClick={clearChat}
              disabled={clearing}
              title="Clear chat"
            >
              Clear
            </button>
          </div>
        </div>

        <section className="hero">
          <div className="heroTitle">VOID_MODE</div>
          <div className="heroSub">Local first. Private and uncensored AI.</div>
        </section>

        <section className="card">
          <div className="cardHead">
            <div className="cardTitle">Chat</div>
            <div className="statusRow">
              {status !== "idle" && (
                <div className={`statusChip ${status}`}>
                  {status === "thinking" ? "Thinking…" : "Stopped"}
                </div>
              )}
            </div>
          </div>

          <div className={`chatPane ${clearing ? "sucking" : ""}`}>
            <div className={`hole ${clearing ? "on" : ""}`} aria-hidden="true">
              <div className="disk" />
              <div className="core" />
              <div className="lens" />
            </div>

            <div className="msgList">
              {messages.map((m, i) => (
                <div
                  key={m.id}
                  className={`msgRow ${m.role}`}
                  style={{ ["--i" as any]: i }}
                >
                  <div className="bubble">
                    <div className="bubbleText">{m.text}</div>
                  </div>
                </div>
              ))}
              <div ref={endRef} />
            </div>
          </div>

          <div className="composer">
            <input
              className="input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") send();
              }}
              disabled={loading || clearing}
              placeholder="Type a message…"
            />

            <button
              className="btn"
              onClick={send}
              disabled={loading || clearing || !input.trim()}
            >
              Send
            </button>

            <button
              className="btn btnGhost"
              onClick={stop}
              disabled={clearing || (!loading && status !== "thinking")}
            >
              Stop
            </button>
          </div>

          <div className="foot">
            No account • Dev • “NEXT_PUBLIC_API_BASE” è pubblico (solo URL, no
            secret).
          </div>
        </section>
      </div>

      <style jsx>{`
        .voidRoot {
          min-height: 100vh;
          padding: calc(16px + env(safe-area-inset-top)) 18px 26px 18px;
          color: rgba(255, 255, 255, 0.92);
          background: radial-gradient(
              1200px 800px at 20% 10%,
              rgba(124, 58, 237, 0.22),
              transparent 60%
            ),
            radial-gradient(
              900px 600px at 80% 20%,
              rgba(56, 189, 248, 0.14),
              transparent 55%
            ),
            radial-gradient(
              700px 500px at 50% 90%,
              rgba(244, 63, 94, 0.08),
              transparent 60%
            ),
            radial-gradient(
              1200px 900px at 50% 50%,
              rgba(0, 0, 0, 0.95),
              rgba(0, 0, 0, 1)
            );
          position: relative;
          overflow-x: hidden; /* non taglia in alto, ma evita scroll orizzontale */
        }

        /* Stars sotto al contenuto */
        .voidRoot:before,
        .voidRoot:after {
          content: "";
          position: absolute;
          inset: -40px;
          pointer-events: none;
          z-index: 0; /* KEY: dietro */
          opacity: 0.18;
          background-image: radial-gradient(
              1px 1px at 10% 20%,
              rgba(255, 255, 255, 0.9),
              transparent 55%
            ),
            radial-gradient(
              1px 1px at 30% 80%,
              rgba(255, 255, 255, 0.7),
              transparent 55%
            ),
            radial-gradient(
              1px 1px at 60% 40%,
              rgba(255, 255, 255, 0.8),
              transparent 55%
            ),
            radial-gradient(
              1px 1px at 80% 70%,
              rgba(255, 255, 255, 0.65),
              transparent 55%
            ),
            radial-gradient(
              1px 1px at 90% 15%,
              rgba(255, 255, 255, 0.85),
              transparent 55%
            );
          background-size: 520px 520px;
          filter: blur(0.2px);
        }
        .voidRoot:after {
          opacity: 0.1;
          transform: scale(1.15);
          background-size: 760px 760px;
        }

        .stage {
          position: relative;
          z-index: 1; /* KEY: contenuto sopra */
          max-width: 980px;
          margin: 0 auto;
        }

        /* Topbar */
        .topbar {
          display: flex;
          justify-content: space-between;
          align-items: center; /* KEY: niente tagli */
          flex-wrap: wrap; /* KEY: su mobile va a capo */
          gap: 12px;
          padding: 6px 0 10px 0;
        }

        .brand .logoLine {
          display: flex;
          align-items: baseline;
          gap: 8px;
          line-height: 1.15;
        }
        .logo {
          font-weight: 900;
          letter-spacing: 0.3px;
          font-size: 18px;
        }
        .beta,
        .ver {
          font-size: 12px;
          opacity: 0.65;
        }
        .sub {
          margin-top: 4px;
          font-size: 12px;
          opacity: 0.8;
          line-height: 1.25;
        }
        .dim {
          opacity: 0.7;
        }
        .mono {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
            "Liberation Mono", "Courier New", monospace;
          opacity: 0.95;
        }

        .topActions {
          display: flex;
          gap: 10px;
          align-items: center;
          margin-left: auto; /* tiene i bottoni a destra */
        }

        .pill {
          border: 1px solid rgba(255, 255, 255, 0.14);
          background: rgba(255, 255, 255, 0.05);
          padding: 8px 10px;
          border-radius: 999px;
          font-size: 12px;
          backdrop-filter: blur(10px);
          white-space: nowrap;
        }
        .pillNum {
          margin-left: 6px;
          font-weight: 900;
        }

        /* Hero */
        .hero {
          padding: 10px 2px 14px 2px;
        }
        .heroTitle {
          font-weight: 950;
          letter-spacing: 0.6px;
          font-size: 22px;
        }
        .heroSub {
          margin-top: 4px;
          font-size: 13px;
          opacity: 0.8;
        }

        /* Card */
        .card {
          border-radius: 18px;
          border: 1px solid rgba(255, 255, 255, 0.13);
          background: linear-gradient(
            180deg,
            rgba(255, 255, 255, 0.06),
            rgba(255, 255, 255, 0.03)
          );
          box-shadow: 0 30px 90px rgba(0, 0, 0, 0.55);
          backdrop-filter: blur(14px);
          overflow: hidden;
        }
        .cardHead {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 14px 14px 10px 14px;
        }
        .cardTitle {
          font-weight: 800;
          opacity: 0.95;
        }
        .statusRow {
          display: flex;
          justify-content: flex-end;
        }
        .statusChip {
          font-size: 12px;
          padding: 6px 10px;
          border-radius: 999px;
          border: 1px solid rgba(255, 255, 255, 0.14);
          background: rgba(0, 0, 0, 0.28);
          letter-spacing: 0.2px;
          white-space: nowrap;
        }
        .statusChip.thinking {
          box-shadow: 0 0 0 1px rgba(124, 58, 237, 0.2),
            0 0 24px rgba(124, 58, 237, 0.18);
        }
        .statusChip.stopped {
          box-shadow: 0 0 0 1px rgba(244, 63, 94, 0.18),
            0 0 22px rgba(244, 63, 94, 0.12);
        }

        /* Chat pane */
        .chatPane {
          position: relative;
          height: 460px;
          margin: 0 14px;
          border-radius: 16px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: radial-gradient(
              900px 360px at 50% 0%,
              rgba(124, 58, 237, 0.12),
              transparent 60%
            ),
            radial-gradient(
              700px 300px at 70% 80%,
              rgba(56, 189, 248, 0.09),
              transparent 60%
            ),
            rgba(0, 0, 0, 0.34);
          overflow: hidden;
        }
        .msgList {
          position: absolute;
          inset: 0;
          overflow-y: auto;
          padding: 14px 12px 18px 12px;
        }

        .msgRow {
          display: flex;
          margin-bottom: 10px;
          transform-origin: 50% 50%;
        }
        .msgRow.user {
          justify-content: flex-end;
        }
        .msgRow.ai {
          justify-content: flex-start;
        }

        .bubble {
          max-width: min(740px, 86%);
          padding: 10px 12px;
          border-radius: 14px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          background: rgba(255, 255, 255, 0.06);
          box-shadow: 0 14px 45px rgba(0, 0, 0, 0.35);
        }
        .msgRow.user .bubble {
          background: linear-gradient(
            180deg,
            rgba(255, 255, 255, 0.08),
            rgba(255, 255, 255, 0.04)
          );
          border: 1px solid rgba(255, 255, 255, 0.16);
        }
        .bubbleText {
          white-space: pre-wrap;
          line-height: 1.35;
          font-size: 14px;
          color: rgba(255, 255, 255, 0.92);
        }

        /* Composer */
        .composer {
          display: flex;
          gap: 10px;
          padding: 12px 14px 14px 14px;
        }
        .input {
          flex: 1;
          padding: 11px 12px;
          border-radius: 14px;
          border: 1px solid rgba(255, 255, 255, 0.14);
          background: rgba(0, 0, 0, 0.35);
          color: rgba(255, 255, 255, 0.92);
          outline: none;
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.04);
        }
        .input::placeholder {
          color: rgba(255, 255, 255, 0.42);
        }

        .btn {
          padding: 11px 14px;
          border-radius: 14px;
          border: 1px solid rgba(255, 255, 255, 0.16);
          background: rgba(255, 255, 255, 0.06);
          color: rgba(255, 255, 255, 0.92);
          cursor: pointer;
          backdrop-filter: blur(10px);
          transition: transform 120ms ease, background 120ms ease,
            border-color 120ms ease, box-shadow 120ms ease;
          white-space: nowrap;
        }
        .btn:hover:not(:disabled) {
          transform: translateY(-1px);
          background: rgba(255, 255, 255, 0.09);
          border-color: rgba(255, 255, 255, 0.26);
        }
        .btn:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
        .btnGhost {
          background: rgba(0, 0, 0, 0.28);
        }

        /* Clear: più visibile */
        .btnClear {
          background: radial-gradient(
              140px 90px at 50% 20%,
              rgba(124, 58, 237, 0.28),
              transparent 62%
            ),
            radial-gradient(
              120px 80px at 50% 90%,
              rgba(56, 189, 248, 0.18),
              transparent 60%
            ),
            rgba(0, 0, 0, 0.42);
          border-color: rgba(255, 255, 255, 0.22);
          box-shadow: 0 10px 40px rgba(0, 0, 0, 0.35),
            0 0 28px rgba(124, 58, 237, 0.18);
        }

        .foot {
          padding: 0 14px 14px 14px;
          font-size: 12px;
          opacity: 0.72;
        }

        /* Black hole overlay */
        .hole {
          position: absolute;
          inset: 0;
          display: grid;
          place-items: center;
          pointer-events: none;
          opacity: 0;
          transform: scale(0.98);
          transition: opacity 180ms ease, transform 180ms ease;
        }
        .hole.on {
          opacity: 1;
          transform: scale(1);
        }
        .core {
          width: 140px;
          height: 140px;
          border-radius: 999px;
          background: radial-gradient(
            circle at 50% 50%,
            rgba(0, 0, 0, 1) 0%,
            rgba(0, 0, 0, 1) 55%,
            rgba(0, 0, 0, 0.2) 62%,
            transparent 72%
          );
          box-shadow: 0 0 40px rgba(0, 0, 0, 0.85),
            0 0 120px rgba(124, 58, 237, 0.12);
          filter: saturate(1.2);
        }
        .disk {
          position: absolute;
          width: 260px;
          height: 180px;
          border-radius: 999px;
          background: conic-gradient(
            from 180deg,
            rgba(56, 189, 248, 0) 0deg,
            rgba(56, 189, 248, 0.35) 50deg,
            rgba(124, 58, 237, 0.28) 140deg,
            rgba(244, 63, 94, 0.22) 220deg,
            rgba(56, 189, 248, 0.15) 300deg,
            rgba(56, 189, 248, 0) 360deg
          );
          filter: blur(1px);
          opacity: 0.7;
          animation: spin 780ms linear infinite;
          transform: rotateX(62deg);
        }
        .lens {
          position: absolute;
          width: 340px;
          height: 340px;
          border-radius: 999px;
          background: radial-gradient(
            circle at 50% 50%,
            rgba(255, 255, 255, 0.06),
            transparent 58%
          );
          opacity: 0.6;
        }
        @keyframes spin {
          from {
            transform: rotateX(62deg) rotate(0deg);
          }
          to {
            transform: rotateX(62deg) rotate(360deg);
          }
        }

        /* Suction animation */
        .chatPane.sucking .msgRow {
          animation: suck 620ms cubic-bezier(0.22, 0.9, 0.18, 1) forwards;
          animation-delay: calc(var(--i) * 10ms);
        }
        @keyframes suck {
          0% {
            opacity: 1;
            transform: scale(1);
            filter: blur(0px);
          }
          55% {
            opacity: 0.9;
            transform: scale(0.82);
            filter: blur(0.2px);
          }
          100% {
            opacity: 0;
            transform: scale(0.05);
            filter: blur(2px);
          }
        }
        .chatPane.sucking .msgList {
          animation: warp 620ms cubic-bezier(0.22, 0.9, 0.18, 1) forwards;
        }
        @keyframes warp {
          0% {
            transform: scale(1);
            filter: blur(0px);
          }
          100% {
            transform: scale(0.98);
            filter: blur(0.35px);
          }
        }

        /* Mobile: Clear sempre visibile */
        @media (max-width: 560px) {
          .topActions {
            width: 100%;
            justify-content: space-between;
          }
          .pill {
            flex: 1;
            display: flex;
            justify-content: center;
          }
        }
      `}</style>
    </main>
  );
}
