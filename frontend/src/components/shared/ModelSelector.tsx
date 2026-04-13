"use client";

import { ChevronDown } from "lucide-react";

interface ModelSelectorProps {
  models: string[];
  selectedModel: string;
  onSelect: (model: string) => void;
  isOpen: boolean;
  onToggle: () => void;
}

export default function ModelSelector({
  models,
  selectedModel,
  onSelect,
  isOpen,
  onToggle,
}: ModelSelectorProps) {
  const hasModels = models.length > 0;
  const displayModel = hasModels ? selectedModel : "No models available";

  return (
    <div className="wpBrandContainer">
      <div className="wpModelTrigger" onClick={onToggle}>
        <div className="wpModelInfo">
          <div className="wpModelName">{displayModel}</div>
        </div>
        <ChevronDown
          size={14}
          style={{
            transition: "transform 0.2s",
            transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
          }}
        />
      </div>

      {isOpen && (
        <div className="wpModelDropdown" onClick={(e) => e.stopPropagation()}>
          {hasModels ? (
            models.map((m) => (
              <div
                key={m}
                className={`wpModelItem ${m === selectedModel ? "active" : ""}`}
                onClick={() => {
                  onSelect(m);
                  onToggle();
                }}
              >
                <div className="wpModelNameInMenu">{m}</div>
              </div>
            ))
          ) : (
            <div className="wpModelItem" style={{ opacity: 0.5, cursor: "default" }}>
              <div className="wpModelNameInMenu">No models available</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
