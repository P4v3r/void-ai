"use client";

import { Copy, CheckCircle2, Clock, AlertTriangle } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import type { PlanConfig } from "../types";

interface PaymentDetailsModalProps {
  planId: string;
  paymentMethod: "btc" | "xmr";
  plans: PlanConfig[];
  onClose: () => void;
  onCopy: (text: string) => void;
  onTokenReceived: (token: string) => void;
  apiUrl: string;
}

export default function PaymentDetailsModal({
  planId,
  paymentMethod,
  plans,
  onClose,
  onCopy,
  onTokenReceived,
  apiUrl,
}: PaymentDetailsModalProps) {
  const currentPlan = plans.find((p) => p.id === planId) || plans[0];

  // Guard: no plans configured
  if (!currentPlan) {
    return (
      <div className="wpModalBackdrop" onMouseDown={onClose}>
        <div className="wpModal wpPaymentDetailsModal" onMouseDown={(e) => e.stopPropagation()}>
          <div className="wpModalHead">
            <span className="wpModalTitle">Payment Details</span>
            <button className="wpBtn" onClick={onClose}>Close</button>
          </div>
          <div className="wpModalContent">
            <div style={{ textAlign: "center", padding: 30 }}>
              <div style={{ marginBottom: 10, color: "var(--wp-muted)" }}>
                <AlertTriangle size={28} />
              </div>
              <p style={{ fontSize: 16, fontWeight: 600 }}>No plans configured.</p>
              <p style={{ color: "var(--wp-muted)", marginTop: 8, fontSize: 13 }}>
                Please contact the admin.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const priceUsd = currentPlan.priceUsd;

  const [state, setState] = useState<"creating" | "waiting" | "done" | "error">("creating");
  const [errorMsg, setErrorMsg] = useState("");

  // Prevent double-click race conditions
  const creatingRef = useRef(false);

  // Payment data (from backend)
  const [payAddress, setPayAddress] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [payCurrency, setPayCurrency] = useState("");
  const [paymentUrl, setPaymentUrl] = useState("");
  const [orderId, setOrderId] = useState("");

  // Polling
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    createPayment();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createPayment(attempt: number = 0) {
    // Guard against race conditions
    if (creatingRef.current) return;
    creatingRef.current = true;

    try {
      const res = await fetch(`${apiUrl}/create-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan_id: planId,
          pay_currency: paymentMethod,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const detail = err.detail || `HTTP ${res.status}`;

        // Retry on 502 (transient gateway error) up to 3 times
        if (res.status === 502 && attempt < 3) {
          await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
          creatingRef.current = false;
          await createPayment(attempt + 1);
          return;
        }

        throw new Error(detail);
      }

      const data = await res.json();
      setPayAddress(data.pay_address || "");
      setPayAmount(data.pay_amount ? String(data.pay_amount) : "");
      setPayCurrency(data.pay_currency || paymentMethod.toUpperCase());
      setPaymentUrl(data.payment_url || "");
      setOrderId(data.order_id || "");
      setState("waiting");

      // Start polling for payment completion
      if (data.order_id) {
        pollRef.current = setInterval(() => checkPayment(data.order_id), 10000); // every 10s
      }
    } catch (e: any) {
      setErrorMsg(e.message || "Failed to create payment");
      setState("error");
    } finally {
      creatingRef.current = false;
    }
  }

  async function checkPayment(oid: string) {
    try {
      const res = await fetch(`${apiUrl}/pro/pending-payment/${oid}`);
      if (!res.ok) return;
      const data = await res.json();

      if (data.status === "completed") {
        setState("done");
        if (pollRef.current) clearInterval(pollRef.current);

        if (data.token) {
          onTokenReceived(data.token);
        }
      }
    } catch {
      // ignore polling errors
    }
  }

  // Generate crypto-specific payment URI
  const payUri = payAddress
    ? paymentMethod === "btc"
      ? `bitcoin:${payAddress}?amount=${payAmount}`
      : `monero:${payAddress}?tx_amount=${payAmount}`
    : "";

  const qrData = payUri;

  const decimalPlaces = paymentMethod === "btc" ? 8 : 12;

  // ─── RENDER ───

  if (state === "creating") {
    return (
      <div className="wpModalBackdrop" onMouseDown={onClose}>
        <div className="wpModal wpPaymentDetailsModal" onMouseDown={(e) => e.stopPropagation()}>
          <div className="wpModalHead">
            <span className="wpModalTitle">Payment Details</span>
            <button className="wpBtn" onClick={onClose}>Close</button>
          </div>
          <div className="wpModalContent">
            <div style={{ textAlign: "center", padding: 30 }}>
              <div style={{ fontSize: 18, marginBottom: 10 }}>Creating payment…</div>
              <div style={{ color: "var(--wp-muted)", fontSize: 13 }}>
                Connecting to payment gateway
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="wpModalBackdrop" onMouseDown={onClose}>
        <div className="wpModal wpPaymentDetailsModal" onMouseDown={(e) => e.stopPropagation()}>
          <div className="wpModalHead">
            <span className="wpModalTitle">Payment Details</span>
            <button className="wpBtn" onClick={onClose}>Close</button>
          </div>
          <div className="wpModalContent">
            <div style={{ textAlign: "center", padding: 20 }}>
              <p><strong>Unable to create payment.</strong></p>
              <p style={{ color: "var(--wp-muted)", marginTop: 8, fontSize: 13 }}>
                {errorMsg}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (state === "done") {
    return (
      <div className="wpModalBackdrop" onMouseDown={onClose}>
        <div className="wpModal wpPaymentDetailsModal" onMouseDown={(e) => e.stopPropagation()}>
          <div className="wpModalHead">
            <span className="wpModalTitle">Payment Details</span>
            <button className="wpBtn" onClick={onClose}>Close</button>
          </div>
          <div className="wpModalContent">
            <div style={{ textAlign: "center", padding: 30 }}>
              <div style={{ marginBottom: 10, color: "var(--wp-primary)" }}>
                <CheckCircle2 size={36} />
              </div>
              <p style={{ fontSize: 18, fontWeight: 600 }}>Payment confirmed!</p>
              <p style={{ color: "var(--wp-muted)", marginTop: 8, fontSize: 13 }}>
                Your credits have been activated.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // state === "waiting"
  return (
    <div className="wpModalBackdrop" onMouseDown={onClose}>
      <div className="wpModal wpPaymentDetailsModal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="wpModalHead">
          <span className="wpModalTitle">Payment Details</span>
          <button className="wpBtn" onClick={onClose}>Close</button>
        </div>
        <div className="wpModalContent">
          <div style={{ textAlign: "center", marginBottom: 20 }}>
            <h3 style={{ margin: 0 }}>{currentPlan.title} Plan</h3>
            <div style={{ fontSize: "20px", fontWeight: 700, color: "var(--wp-primary)" }}>
              ${priceUsd}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 20, alignItems: "center" }}>
            {/* Amount */}
            <div style={{ textAlign: "center" }}>
              <div
                className="wpCopyAmountBtn"
                onClick={() => onCopy(payAmount)}
                title="Click to copy amount"
              >
                <div className="wpCopyLabel">Send exactly:</div>
                <div className="wpCopyValue">
                  <span className="amount">{payAmount}</span>
                  <span className="currency">{payCurrency}</span>
                  <Copy size={16} />
                </div>
              </div>
            </div>

            {/* QR Code */}
            {qrData && (
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrData)}`}
                alt="Payment QR"
                style={{
                  borderRadius: "8px",
                  border: "1px solid var(--wp-border)",
                  padding: 10,
                  background: "white",
                }}
              />
            )}

            {/* Wallet Address */}
            {payAddress && (
              <div style={{ width: "100%", display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  className="wpInput"
                  readOnly
                  value={payAddress}
                  style={{ fontFamily: "monospace", fontSize: "11px", flex: 1 }}
                />
                <button className="wpBtn" onClick={() => onCopy(payAddress)}>
                  <Copy size={16} />
                </button>
              </div>
            )}

            {/* Open payment link (for BTCPay checkout page) */}
            {paymentUrl && paymentUrl.startsWith("http") && (
              <a
                href={paymentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="wpBtn primary"
                style={{ width: "100%", textAlign: "center", textDecoration: "none" }}
              >
                Open Payment Page
              </a>
            )}

            {/* Waiting indicator */}
            <div style={{ textAlign: "center", fontSize: 13, color: "var(--wp-muted)" }}>
              <Clock size={16} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />
              Waiting for payment confirmation…
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
