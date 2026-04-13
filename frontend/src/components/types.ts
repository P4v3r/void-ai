"use client";

import type { ReactNode } from "react";

/* ─────────────────────────────────────────────
 *  TYPE DEFINITIONS (Shared across components)
 * ───────────────────────────────────────────── */

export type Role = "user" | "ai";

export type Msg = {
  id: string;
  role: Role;
  text: string;
  interrupted?: boolean;
};

export type ChatMeta = {
  id: string;
  title: string;
  updatedAt: number;
  pinned?: boolean;
};

export type ProStatus = "off" | "checking" | "active" | "invalid" | "exhausted";
export type BillingState =
  | "idle"
  | "creating"
  | "waiting"
  | "claiming"
  | "done"
  | "error";

export type PlanConfig = {
  id: string;
  title: string;
  credits: number;
  priceUsd: number;
  note?: string;
};

/* ─────────────────────────────────────────────
 *  CONSTANTS
 * ───────────────────────────────────────────── */

export const LS = {
  clientId: "void_client_id",
  proToken: "void_pro_token",
  invoiceId: "void_invoice_id",
  checkoutLink: "void_checkout_link",
  planId: "void_plan_id",
} as const;

export const PLANS: PlanConfig[] = [
  { id: "starter", title: "Starter", credits: 500, priceUsd: 2, note: "Quick test." },
  { id: "plus", title: "Plus", credits: 5_000, priceUsd: 10, note: "Best value." },
  { id: "max", title: "Max", credits: 20_000, priceUsd: 25, note: "Heavy usage." },
];



export function shortId(id: string): string {
  return id ? `${id.slice(0, 8)}…` : "—";
}
