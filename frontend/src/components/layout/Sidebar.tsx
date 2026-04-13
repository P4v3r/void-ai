"use client";

import type { ChatMeta } from "../types";
import { Trash2, Pin, Pencil, Copy, File as FileIcon, FileText, MoreHorizontal, Info, Pencil as NewChatIcon, Wallet } from "lucide-react";

export interface SidebarProps {
  chatId: string | null;
  chatList: ChatMeta[];
  activeMenuId: string | null;
  mobileSidebarOpen: boolean;
  onNewChat: () => void;
  onLoadChat: (id: string) => void;
  onDeleteChat: (id: string, e: React.MouseEvent) => void;
  onTogglePin: (id: string) => void;
  onRenameChat: (id: string, title: string) => void;
  onDuplicateChat: (id: string) => void;
  onDownloadChat: (id: string, format: "json" | "txt") => void;
  onInfoOpen: () => void;
  showGetCredits?: boolean;
  onGetCredits?: () => void;
  onActiveMenuChange: (id: string | null) => void;
  onMobileClose: () => void;
}

export default function Sidebar({
  chatId,
  chatList,
  activeMenuId,
  mobileSidebarOpen,
  onNewChat,
  onLoadChat,
  onDeleteChat,
  onTogglePin,
  onRenameChat,
  onDuplicateChat,
  onDownloadChat,
  onInfoOpen,
  showGetCredits = true,
  onGetCredits,
  onActiveMenuChange,
  onMobileClose,
}: SidebarProps) {
  return (
    <>
      {/* MOBILE OVERLAY */}
      {mobileSidebarOpen && (
        <div className="wpSidebarOverlay" onClick={onMobileClose} />
      )}

      {/* SIDEBAR (on the right) */}
      <div className={`wpSidebar ${mobileSidebarOpen ? "isOpen" : ""}`}>
        <div className="wpSidebarHeader">
          <div className="wpLogoContainer">
            <div className="wpMainLogo">
              VOID<span className="logoDot">.</span>AI
            </div>
          </div>
          <button
            className="wpBtn wpBtnIcon"
            onClick={onInfoOpen}
            title="Info / About"
          >
            <Info size={18} />
          </button>
        </div>

        <div className="wpSidebarActions">
          <div
            className="wpThemeCircle"
            onClick={onNewChat}
            aria-label="New Chat"
            title="New Chat"
          >
            <NewChatIcon size={16} />
            <span>New Chat</span>
          </div>
        </div>

        <div className="wpChatList">
          {!chatId && <div className="wpChatItem active">New Chat</div>}

          {chatList.map((chat) => (
            <div
              key={chat.id}
              className={`wpChatItem ${chatId === chat.id ? "active" : ""} ${chat.pinned ? "pinned" : ""}`}
              onClick={() => onLoadChat(chat.id)}
            >
              {chat.pinned && (
                <Pin size={12} className="pinIcon" fill="currentColor" />
              )}

              <span className="chatTitle">{chat.title}</span>

              {/* MORE BTN */}
              <div className="chatMenuContainer">
                <button
                  className="moreBtn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onActiveMenuChange(
                      activeMenuId === chat.id ? null : chat.id
                    );
                  }}
                >
                  <MoreHorizontal size={16} />
                </button>

                {activeMenuId === chat.id && (
                  <div className="chatMenu" onClick={(e) => e.stopPropagation()}>
                    <div
                      className="chatMenuItem"
                      onClick={() => onTogglePin(chat.id)}
                    >
                      <Pin size={14} style={{ marginRight: 8 }} />{" "}
                      {chat.pinned ? "Unpin" : "Pin"}
                    </div>
                    <div
                      className="chatMenuItem"
                      onClick={() => onRenameChat(chat.id, chat.title)}
                    >
                      <Pencil size={14} style={{ marginRight: 8 }} /> Rename
                    </div>
                    <div
                      className="chatMenuItem"
                      onClick={() => onDuplicateChat(chat.id)}
                    >
                      <Copy size={14} style={{ marginRight: 8 }} /> Duplicate
                    </div>

                    <div className="chatMenuDivider" />
                    <div
                      className="chatMenuItem"
                      onClick={() => onDownloadChat(chat.id, "json")}
                    >
                      <FileIcon size={14} style={{ marginRight: 8 }} /> Export
                      chat (.json)
                    </div>
                    <div
                      className="chatMenuItem"
                      onClick={() => onDownloadChat(chat.id, "txt")}
                    >
                      <FileText size={14} style={{ marginRight: 8 }} /> Plain
                      Text (.txt)
                    </div>

                    <div className="chatMenuDivider" />
                    <div
                      className="chatMenuItem danger"
                      onClick={(e) => onDeleteChat(chat.id, e)}
                    >
                      <Trash2 size={14} style={{ marginRight: 8 }} /> Delete
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* SIDEBAR BOTTOM: Get Credits (payments mode only) */}
        {showGetCredits && onGetCredits && (
          <div className="wpThemeToggleInSidebar">
            <div className="wpGetCreditsBtn" onClick={onGetCredits}>
              <Wallet size={16} />
              <span>Get Credits</span>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
