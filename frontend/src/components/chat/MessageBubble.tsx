"use client";

import { AlertCircle, Copy, RotateCcw } from "lucide-react";
import type { Msg } from "../types";

interface ChatMessageProps {
  msg: Msg;
  index: number;
  messagesLength: number;
  isThinking: boolean;
  onCopy: (text: string) => void;
  onRegenerate: () => void;
}

export default function ChatMessage({
  msg,
  index,
  messagesLength,
  isThinking,
  onCopy,
  onRegenerate,
}: ChatMessageProps) {
  const isUser = msg.role === "user";
  const isLastMessage = index === messagesLength - 1;
  const isWelcomeScreen = messagesLength === 1 && !isUser;

  return (
    <div className={`wpMsg ${isUser ? "wpMsg--user" : "wpMsg--ai"}`}>
      <div className="wpBubble">
        {msg.text}

        {msg.interrupted && (
          <span className="msgStatus stopped">
            <AlertCircle
              size={14}
              style={{ verticalAlign: "middle", marginRight: 4 }}
            />{" "}
            Stopped.
          </span>
        )}
        {!msg.interrupted && isThinking && (
          <span className="msgStatus thinking">Thinking...</span>
        )}
      </div>

      {/* ACTIONS — shown when not thinking */}
      {!isThinking && (
        <div
          className={`wpMsgActions ${isUser ? "right" : "left"} visible`}
        >
          {isUser && (
            <button
              className="wpActionBtn"
              onClick={() => onCopy(msg.text)}
              title="Copy"
            >
              <Copy size={16} />
            </button>
          )}

          {!isUser && (
            <>
              {isLastMessage &&
                !isWelcomeScreen &&
                !msg.text.toLowerCase().includes("continue") &&
                !msg.text.toLowerCase().includes("error") &&
                !msg.text.toLowerCase().includes("too many requests") && (
                  <button
                    className="wpActionBtn"
                    onClick={onRegenerate}
                    title="Regenerate"
                  >
                    <RotateCcw size={16} />
                  </button>
                )}
              <button
                className="wpActionBtn"
                onClick={() => onCopy(msg.text)}
                title="Copy"
              >
                <Copy size={16} />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
