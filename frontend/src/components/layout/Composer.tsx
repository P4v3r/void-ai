"use client";

import { Trash2, Square, Send } from "lucide-react";

interface ComposerProps {
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onClearChat: () => void;
  loading: boolean;
  clearing: boolean;
}

export default function Composer({
  input,
  onInputChange,
  onSend,
  onStop,
  onClearChat,
  loading,
  clearing,
}: ComposerProps) {
  return (
    <div className="wpComposerArea">
      <div className="wpComposerBox">
        <textarea
          className="wpTextarea"
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          disabled={loading || clearing}
          placeholder="Type your message..."
        />
        <div className="wpControls">
          <div className="wpHelper">
            Enter to send. Shift + Enter for new line.
          </div>
          <div className="wpBtnGroup">
            <button
              className="wpBtn danger"
              onClick={onClearChat}
              disabled={loading || clearing}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <Trash2 size={16} /> Clear chat
              </span>
            </button>
            <button
              className="wpBtn"
              onClick={onStop}
              disabled={!loading}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <Square size={16} /> Stop
              </span>
            </button>
            <button
              className="wpBtn primary"
              onClick={() => void onSend()}
              disabled={loading || clearing}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <Send size={16} /> Send
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
