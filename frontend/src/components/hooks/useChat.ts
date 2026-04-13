"use client";

import { useRef, useCallback } from "react";
import type { Msg } from "../types";

/** Generate a browser fingerprint for identity tracking. */
export const generateBrowserData = async (): Promise<string> => {
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
};

/** Copy text to clipboard, returns true if successful. */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Chat streaming logic — manages AbortController and stream reader refs. */
export function useChat() {
  const messagesRef = useRef<Msg[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const genIdRef = useRef<string | null>(null);
  const autoScrollRef = useRef<boolean>(true);

  const cleanupStreamRefs = useCallback(() => {
    abortRef.current = null;
    readerRef.current = null;
  }, []);

  const stop = useCallback(() => {
    try {
      abortRef.current?.abort();
    } catch {}
    const r = readerRef.current;
    if (r) r.cancel().catch(() => {});
    cleanupStreamRefs();
  }, [cleanupStreamRefs]);

  return {
    messagesRef,
    abortRef,
    readerRef,
    genIdRef,
    autoScrollRef,
    stop,
    cleanupStreamRefs,
    generateBrowserData,
    copyToClipboard,
  };
}
