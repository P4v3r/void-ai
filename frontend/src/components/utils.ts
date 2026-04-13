"use client";

export function readLS(key: string): string {
  try {
    if (typeof window === "undefined") return "";
    return (localStorage.getItem(key) || "").trim();
  } catch {
    return "";
  }
}

export function writeLS(key: string, value: string): void {
  try {
    if (typeof window === "undefined") return;
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* noop */
  }
}

export function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function normalizeBase(url: string): string {
  return url.replace(/\/+$/, "");
}
