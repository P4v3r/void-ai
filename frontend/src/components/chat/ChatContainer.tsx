"use client";

import { useEffect, useRef } from "react";
import type { Msg } from "../types";
import ChatMessage from "./MessageBubble";

interface ChatContainerProps {
  messages: Msg[];
  status: "idle" | "thinking" | "stopped";
  loading: boolean;
  onCopy: (text: string) => void;
  onRegenerate: () => void;
  scrollBoxRef?: React.RefObject<HTMLDivElement | null>;
  bottomRef?: React.RefObject<HTMLDivElement | null>;
}

export default function ChatContainer({
  messages,
  status,
  loading,
  onCopy,
  onRegenerate,
  scrollBoxRef: externalScrollRef,
  bottomRef: externalBottomRef,
}: ChatContainerProps) {
  // If no refs are passed, create internal ones
  const internalScrollRef = useRef<HTMLDivElement>(null);
  const internalBottomRef = useRef<HTMLDivElement>(null);
  
  const scrollBoxRef = externalScrollRef || internalScrollRef;
  const bottomRef = externalBottomRef || internalBottomRef;

  return (
    <div className="wpChatContainer" ref={scrollBoxRef as any}>
      {messages.map((m, index) => {
        const isLastMessage = index === messages.length - 1;
        const isThinking =
          status === "thinking" &&
          isLastMessage &&
          m.text === "" &&
          !m.interrupted;

        return (
          <ChatMessage
            key={m.id}
            msg={m}
            index={index}
            messagesLength={messages.length}
            isThinking={isThinking}
            onCopy={onCopy}
            onRegenerate={onRegenerate}
          />
        );
      })}
      <div ref={bottomRef as any} />
    </div>
  );
}
