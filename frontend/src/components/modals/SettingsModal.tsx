"use client";

import { Sun, Moon, Download, Upload, Trash2, RotateCcw, Server } from "lucide-react";
import { useRef, useState } from "react";

interface SettingsModalProps {
  theme: "light" | "dark";
  onThemeChange: (theme: "light" | "dark") => void;
  onClose: () => void;
  apiUrl: string;
  defaultApi: string;
  onApiUrlChange: (url: string) => void;
  onExportChats: () => void;
  onImportChats: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClearAllData: () => void;
  // AI URL (self-hosted only)
  showAiUrlField?: boolean;
  aiUrl?: string;
  defaultAiUrl?: string;
  onAiUrlChange?: (url: string) => void;
  onAiUrlSave?: () => void;
  aiUrlMessage?: string;
  showAdvancedSettings?: boolean;
}

export default function SettingsModal({
  theme,
  onThemeChange,
  onClose,
  apiUrl,
  defaultApi,
  onApiUrlChange,
  onExportChats,
  onImportChats,
  onClearAllData,
  showAiUrlField = false,
  aiUrl = "",
  defaultAiUrl = "",
  onAiUrlChange,
  onAiUrlSave,
  aiUrlMessage = "",
  showAdvancedSettings = true,
}: SettingsModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [localApiUrl, setLocalApiUrl] = useState(apiUrl);

  const handleSetUrl = () => {
    onApiUrlChange(localApiUrl);
  };

  return (
    <div className="wpModalBackdrop" onMouseDown={onClose}>
      <div className="wpModal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="wpModalHead">
          <span className="wpModalTitle">Settings</span>
          <button className="wpBtn" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="wpModalContent">
          {/* 1. THEME */}
          <div className="wpSection">
            <span className="wpLabel">Appearance</span>
            <div className="wpThemeToggleInModal">
              <div
                className={`wpThemeOption ${theme === "light" ? "active" : ""}`}
                onClick={() => onThemeChange("light")}
              >
                <Sun size={16} style={{ marginRight: 8 }} /> Light Mode
              </div>
              <div
                className={`wpThemeOption ${theme === "dark" ? "active" : ""}`}
                onClick={() => onThemeChange("dark")}
              >
                <Moon size={16} style={{ marginRight: 8 }} /> Dark Mode
              </div>
            </div>
          </div>

          {/* 2. DATA MANAGEMENT */}
          <div className="wpSection">
            <span className="wpLabel">Data Management</span>
            <p
              style={{
                fontSize: "13px",
                color: "var(--wp-muted)",
                marginBottom: "12px",
              }}
            >
              Save your chats locally. You can restore them later if you clear
              your browser cache.
            </p>
            <div
              style={{ display: "flex", gap: "10px", marginBottom: "15px" }}
            >
              <button
                className="wpBtn primary"
                onClick={onExportChats}
                style={{ flex: 1 }}
              >
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <Download size={16} /> Export Chats (.json)
                </span>
              </button>
              <input
                type="file"
                ref={fileInputRef}
                style={{ display: "none" }}
                accept=".json"
                onChange={onImportChats}
              />
              <button
                className="wpBtn"
                onClick={() => fileInputRef.current?.click()}
                style={{ flex: 1 }}
              >
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <Upload size={16} /> Import Chats (.json)
                </span>
              </button>
            </div>

            <button
              className="wpBtn danger"
              style={{ width: "100%", marginTop: 10 }}
              onClick={onClearAllData}
            >
              <span
                style={{ display: "flex", alignItems: "center", gap: 6 }}
              >
                <Trash2 size={16} /> Clear All Data
              </span>
            </button>
          </div>

          {/* 3. ADVANCED SETTINGS */}
          {showAiUrlField && showAdvancedSettings && onAiUrlChange && onAiUrlSave && (
            <div className="wpSection">
              <span className="wpLabel">Advanced Settings</span>
              <p
                style={{
                  fontSize: "12px",
                  color: "var(--wp-muted)",
                  marginBottom: "16px",
                }}
              >
                Configure API and AI server URLs.
              </p>

              {/* AI Backend URL */}
              <div style={{ marginBottom: "16px" }}>
                <span className="wpLabel" style={{ fontSize: "12px", marginBottom: "6px" }}>
                  AI Backend URL
                </span>
                <p style={{ fontSize: "11px", color: "var(--wp-muted)", marginBottom: "8px", marginTop: 0 }}>
                  URL of your Ollama or compatible AI server.
                </p>
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <input
                    className="wpInput"
                    value={aiUrl}
                    onChange={(e) => onAiUrlChange(e.target.value)}
                    placeholder={defaultAiUrl}
                    style={{ width: "100%", fontWeight: aiUrl ? "600" : "400" }}
                  />
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="wpBtn primary" onClick={onAiUrlSave} style={{ flex: 1 }}>Set URL</button>
                  <button
                    className="wpBtn"
                    onClick={() => { onAiUrlChange(""); }}
                    title="Restore default"
                    style={{ flex: "0 0 auto" }}
                  >
                    <RotateCcw size={16} />
                  </button>
                </div>
                {aiUrlMessage && (
                  <div style={{ marginTop: 6, fontSize: "12px", color: aiUrlMessage.startsWith("✓") ? "var(--wp-success, #22c55e)" : "var(--wp-error, #ef4444)" }}>
                    {aiUrlMessage}
                  </div>
                )}
              </div>

              {/* Backend API URL */}
              <div>
                <span className="wpLabel" style={{ fontSize: "12px", marginBottom: "6px" }}>Backend API URL</span>
                <p style={{ fontSize: "11px", color: "var(--wp-muted)", marginBottom: "8px", marginTop: 0 }}>
                  Change backend URL if it runs on a different host.
                </p>
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <input
                    className="wpInput"
                    value={localApiUrl === defaultApi ? "" : localApiUrl}
                    onChange={(e) => setLocalApiUrl(e.target.value)}
                    placeholder={defaultApi}
                    style={{ width: "100%", fontWeight: localApiUrl === defaultApi ? "400" : "600" }}
                  />
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="wpBtn primary" onClick={handleSetUrl} style={{ flex: 1 }}>Set URL</button>
                  <button
                    className="wpBtn"
                    onClick={() => { setLocalApiUrl(defaultApi); onApiUrlChange(defaultApi); }}
                    title="Restore default"
                    style={{ flex: "0 0 auto" }}
                  >
                    <RotateCcw size={16} />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
