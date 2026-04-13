"use client";

import { Settings, Menu } from "lucide-react";
import type { ChatMeta, ProStatus } from "../types";
import ModelSelector from "../shared/ModelSelector";

interface TopBarProps {
  clientId: string;
  proStatus: ProStatus;
  proLeft: number | null;
  proToken: string;
  models: string[];
  selectedModel: string;
  onModelSelect: (model: string) => void;
  modelDropdownOpen: boolean;
  onModelDropdownToggle: () => void;
  onSettingsOpen: () => void;
  onMobileMenuOpen: () => void;
  proStatusLine: () => string;
}

export default function TopBar({
  clientId,
  proStatus,
  proLeft,
  proToken,
  models,
  selectedModel,
  onModelSelect,
  modelDropdownOpen,
  onModelDropdownToggle,
  onSettingsOpen,
  onMobileMenuOpen,
  proStatusLine,
}: TopBarProps) {
  return (
    <div className="wpTopbar">
      {/* Mobile Menu */}
      <div className="mobileMenuBtn" onClick={onMobileMenuOpen}>
        <Menu size={22} />
      </div>

      {/* Model Selector */}
      <ModelSelector
        models={models}
        selectedModel={selectedModel}
        onSelect={onModelSelect}
        isOpen={modelDropdownOpen}
        onToggle={onModelDropdownToggle}
      />

      {/* Right side: credits on mobile, all meta on desktop */}
      <div className="wpMeta">
        {proStatusLine() && (
          <div className="wpMetaItem">
            <strong>{proStatusLine()}</strong>
          </div>
        )}
      </div>

      {/* Credits on mobile (always visible) */}
      {proStatusLine() && (
        <div className="wpMobileCredits">
          <strong>{proStatusLine()}</strong>
        </div>
      )}

      {/* Settings (always visible, even on mobile) */}
      <button
        className="wpBtn wpBtnIcon"
        onClick={onSettingsOpen}
        title="Settings"
      >
        <Settings size={18} />
      </button>
    </div>
  );
}
