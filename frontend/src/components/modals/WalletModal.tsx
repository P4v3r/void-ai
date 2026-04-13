"use client";

import { Trash2, Zap } from "lucide-react";
import type { PlanConfig } from "../types";

interface WalletModalProps {
  tokenDraft: string;
  onTokenDraftChange: (value: string) => void;
  onActivateToken: (draft: string) => void;
  paymentMethod: "btc" | "xmr";
  onPaymentMethodChange: (method: "btc" | "xmr") => void;
  planId: string;
  plans: PlanConfig[];
  onPlanIdChange: (id: string) => void;
  uiMsg: string;
  onOpenPaymentDetails: () => void;
  onClose: () => void;
  onClearToken: () => void;
  onCreateInvoice?: () => void;
}

export default function WalletModal({
  tokenDraft,
  onTokenDraftChange,
  onActivateToken,
  paymentMethod,
  onPaymentMethodChange,
  planId,
  plans,
  onPlanIdChange,
  uiMsg,
  onOpenPaymentDetails,
  onClose,
  onClearToken,
  onCreateInvoice,
}: WalletModalProps) {
  return (
    <div className="wpModalBackdrop" onMouseDown={onClose}>
      <div className="wpModal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="wpModalHead">
          <span className="wpModalTitle">Wallet &amp; Access</span>
          <button className="wpBtn" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="wpModalContent">
          {/* 1. Existing Token */}
          <div className="wpSection">
            <span className="wpLabel">Existing Token</span>
            <div className="tokenInputRow">
              <input
                className="wpInput"
                value={tokenDraft}
                onChange={(e) => onTokenDraftChange(e.target.value)}
                placeholder="Paste token here..."
              />
            </div>
            <div className="wpBtnGroup">
              <button className="wpBtn primary" onClick={() => onActivateToken(tokenDraft)}>Load</button>
              <button
                className="wpBtn danger"
                onClick={() => { onClearToken(); onActivateToken(""); }}
              >
                <Trash2 size={14} />
              </button>
            </div>
            {uiMsg && <div className="uiMsg">{uiMsg}</div>}
          </div>

          {/* 2. Purchase Section */}
          <div className="wpSection">
            <span className="wpLabel">Purchase Credits</span>
            <div className="wpPaymentToggle">
              <div
                className={`wpPaymentOption ${paymentMethod === "btc" ? "active" : ""}`}
                onClick={() => onPaymentMethodChange("btc")}
              >
                Bitcoin (BTC)
              </div>
              <div
                className={`wpPaymentOption ${paymentMethod === "xmr" ? "active" : ""}`}
                onClick={() => onPaymentMethodChange("xmr")}
              >
                Monero (XMR)
              </div>
            </div>

            {/* Plan Selection */}
            <div className="wpPlansRow" style={{ marginBottom: "20px" }}>
              {plans.map((p) => (
                <div
                  key={p.id}
                  className={`wpPlanBtn ${planId === p.id ? "active" : ""}`}
                  onClick={() => onPlanIdChange(p.id)}
                >
                  <div className="wpPlanPrice">${p.priceUsd}</div>
                  <div className="wpPlanTitle">{p.title}</div>
                  <div className="wpPlanCredits">{p.credits.toLocaleString()} credits</div>
                </div>
              ))}
            </div>

            {/* Payment Buttons */}
            {plans.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 20 }}>
              {/* Auto-pay BTCPay — BTC only, hidden if not configured */}
              {onCreateInvoice && paymentMethod === "btc" && (
                <button className="wpBtn" onClick={onCreateInvoice} style={{ width: "100%" }}>
                  <Zap size={16} style={{ marginRight: 8 }} /> Auto-pay with BTCPay
                </button>
              )}
              <button className="wpBtn primary" onClick={onOpenPaymentDetails} style={{ width: "100%" }}>
                Pay with {paymentMethod === "btc" ? "Bitcoin" : "Monero"}
              </button>
            </div>
              )}
          </div>
        </div>
      </div>
    </div>
  );
}
