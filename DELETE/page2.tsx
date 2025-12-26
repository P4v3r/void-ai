return (
  <div className={`wpShell ${theme}`}>
    <style jsx global>{`
      :root {
        --wp-bg: #f0f0f1;
        --wp-panel: #ffffff;
        --wp-text: #1d2327;
        --wp-muted: #50575e;
        --wp-border: #dcdcde;
        --wp-border-focus: #2271b1;
        --wp-btn-bg: #f6f7f7;
        --wp-btn-text: #2c3338;
        --wp-primary: #2271b1;
        --wp-primary-hover: #135e96;
        --wp-danger: #d63638;
        --wp-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        
        /* Chat specific */
        --msg-user-bg: #f0f6fc;
        --msg-user-border: #cce4f6;
        --msg-ai-bg: #ffffff;
        --msg-ai-border: #dcdcde;
      }

      /* Nuove classi per lo stato uniforme */
      .msgStatus {
        display: block;
        margin-top: 8px;
        font-size: 0.9em;
        font-style: italic;
        opacity: 0.9;
        font-weight: 500;
      }
      .msgStatus.thinking {
        color: var(--wp-muted);
      }
      .msgStatus.stopped {
        color: var(--wp-danger); /* Rosso, ma con stile uguale al thinking */
      }

      .wpShell.dark {
        --wp-bg: #101517;
        --wp-panel: #1d2327;
        --wp-text: #f0f0f1;
        --wp-muted: #a7aaad;
        --wp-border: #3c434a;
        --wp-border-focus: #72aee6;
        --wp-btn-bg: #2c3338;
        --wp-btn-text: #c3c4c7;
        --wp-primary: #72aee6;
        --wp-primary-hover: #9ec2e6;
        --wp-danger: #e65054;
        --wp-shadow: 0 4px 10px rgba(0, 0, 0, 0.4);

        /* Chat specific dark */
        --msg-user-bg: #2a3035;
        --msg-user-border: #4f5860;
        --msg-ai-bg: #181d20;
        --msg-ai-border: #3c434a;
      }

      * { box-sizing: border-box; }

      .wpShell {
        height: 100vh;
        display: flex;
        flex-direction: column;
        background: var(--wp-bg);
        color: var(--wp-text);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen-Sans, Ubuntu, Cantarell, "Helvetica Neue", sans-serif;
        font-size: 15px;
        transition: background 0.2s, color 0.2s;
      }

      /* TOP BAR */
      .wpTopbar {
        flex: 0 0 56px;
        background: #1d2327;
        color: #fff;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 20px;
        font-size: 14px;
        z-index: 10;
      }

      .wpBrand {
        font-weight: 700;
        font-size: 16px;
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .wpMeta {
        display: flex;
        align-items: center;
        gap: 16px;
      }

      .wpMetaItem {
        color: #a7aaad;
        font-size: 13px;
      }
      .wpMetaItem strong { color: #fff; font-weight: 500; }

      /* MAIN LAYOUT */
      .wpMain {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        position: relative;
      }

      .wpChatContainer {
        flex: 1;
        overflow-y: auto;
        padding: 20px;
        display: flex;
        flex-direction: column;
        gap: 20px;
        max-width: 900px;
        margin: 0 auto;
        width: 100%;
      }

      /* MESSAGES */
      .wpMsg {
        display: flex;
        flex-direction: column;
        max-width: 85%;
      }
      .wpMsg--user { align-self: flex-end; align-items: flex-end; }
      .wpMsg--ai { align-self: flex-start; align-items: flex-start; }

      .wpBubble {
        padding: 14px 18px;
        border-radius: 4px;
        line-height: 1.6;
        font-size: 15px;
        white-space: pre-wrap;
        box-shadow: 0 1px 2px rgba(0,0,0,0.05);
      }

      .wpMsg--user .wpBubble {
        background: var(--msg-user-bg);
        border: 1px solid var(--msg-user-border);
        color: var(--wp-text);
      }

      .wpMsg--ai .wpBubble {
        background: var(--msg-ai-bg);
        border: 1px solid var(--msg-ai-border);
        color: var(--wp-text);
      }

      .wpRoleName {
        font-size: 11px;
        text-transform: uppercase;
        color: var(--wp-muted);
        margin-bottom: 4px;
        letter-spacing: 0.5px;
      }

      /* COMPOSER (BOTTOM FIXED) */
      .wpComposerArea {
        flex: 0 0 auto;
        background: var(--wp-panel);
        border-top: 1px solid var(--wp-border);
        padding: 20px;
        display: flex;
        justify-content: center;
      }

      .wpComposerBox {
        width: 100%;
        max-width: 900px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .wpTextarea {
        width: 100%;
        min-height: 120px;
        padding: 16px;
        border: 1px solid var(--wp-border);
        border-radius: 4px;
        font-family: inherit;
        font-size: 16px;
        background: var(--wp-bg);
        color: var(--wp-text);
        resize: none;
        outline: none;
      }
      .wpTextarea:focus {
        border-color: var(--wp-border-focus);
        box-shadow: 0 0 0 1px var(--wp-border-focus);
      }

      .wpControls {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .wpHelper {
        font-size: 13px;
        color: var(--wp-muted);
      }

      /* BUTTONS */
      .wpBtn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 8px 16px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        background: var(--wp-btn-bg);
        color: var(--wp-btn-text);
        border: 1px solid var(--wp-border);
        border-radius: 3px;
        transition: all 0.15s ease;
      }
      .wpBtn:hover:not(:disabled) {
        border-color: var(--wp-muted);
        background: var(--wp-bg);
      }
      .wpBtn:disabled {
        opacity: 0.5;
        cursor: default;
      }

      .wpBtn.primary {
        background: var(--wp-primary);
        color: #fff;
        border-color: var(--wp-primary);
      }
      .wpBtn.primary:hover:not(:disabled) {
        background: var(--wp-primary-hover);
        border-color: var(--wp-primary-hover);
      }

      .wpBtn.danger {
        color: var(--wp-danger);
        border-color: var(--wp-danger);
      }
      .wpBtn.danger:hover:not(:disabled) {
        background: var(--wp-danger);
        color: #fff;
      }

      /* THEME TOGGLE (Bottom Left Fixed) */
      .wpThemeToggle {
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 100;
        width: 44px;
        height: 44px;
        border-radius: 50%;
        background: var(--wp-panel);
        border: 1px solid var(--wp-border);
        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        color: var(--wp-text);
        font-size: 20px;
      }
      .wpThemeToggle:hover {
        transform: scale(1.05);
        border-color: var(--wp-border-focus);
      }

      /* MODAL */
      .wpModalBackdrop {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.6);
        z-index: 200;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
      }
      .wpModal {
        background: var(--wp-panel);
        width: 100%;
        max-width: 600px;
        border-radius: 4px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.2);
        display: flex;
        flex-direction: column;
        max-height: 90vh;
      }
      .wpModalHead {
        padding: 20px;
        border-bottom: 1px solid var(--wp-border);
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .wpModalTitle { font-size: 18px; font-weight: 600; }
      .wpModalContent { padding: 20px; overflow-y: auto; }
      .wpSection { margin-bottom: 24px; padding-bottom: 24px; border-bottom: 1px solid var(--wp-border); }
      .wpSection:last-child { border: none; margin: 0; padding: 0; }
      .wpLabel { display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px; }
      
      .wpPlanBtn {
        width: 100%;
        text-align: left;
        padding: 12px;
        border: 1px solid var(--wp-border);
        background: var(--wp-bg);
        margin-bottom: 8px;
        border-radius: 4px;
        cursor: pointer;
      }
      .wpPlanBtn.active {
        border-color: var(--wp-primary);
        background: rgba(34, 113, 177, 0.05);
      }
    `}</style>

    {/* --- TOP BAR (MODIFIED) --- */}
    <div className="wpTopbar">
      <div className="wpBrand">
        <span>VOID / AI</span>
      </div>
      <div>
        <span>Private & Uncensored</span>
      </div>
      <div className="wpMeta">
        <div className="wpMetaItem">Session: <strong>{shortId(clientId)}</strong></div>
        
        {/* MOSTRA FREE CREDITS SOLO SE NON C'È UN TOKEN PRO ATTIVO */}
        {!proToken && (
          <div className="wpMetaItem">Free: <strong>{freeLeft}</strong></div>
        )}
        
        <div className="wpMetaItem"><strong>{proStatusLine()}</strong></div>
        <button className="wpBtn" onClick={() => setWalletOpen(true)}>Credits</button>
      </div>
    </div>

    {/* Main Layout */}
    <div className="wpMain">
      
      {/* --- MESSAGES AREA (MODIFICATA) --- */}
      <div className="wpChatContainer" ref={scrollBoxRef as any}>
        {messages.map((m, index) => {
          const isUser = m.role === "user";
          const isLastMessage = index === messages.length - 1;
          
          return (
            <div key={m.id} className={`wpMsg ${isUser ? "wpMsg--user" : "wpMsg--ai"}`}>
              <div className="wpRoleName">{isUser ? "You" : "Assistant"}</div>
              
              <div className="wpBubble">
                {m.text}
                
                {/* LOGICA STATO MESSAGGIO */}
                
                {/* 1. Se il messaggio è stato interrotto (Stops e rimane) */}
                {m.interrupted && (
                  <span className="msgStatus stopped">Stopped.</span>
                )}

                {/* 2. Se sta pensando (solo sull'ultimo messaggio, se non è già interrotto) */}
                {!m.interrupted && m.text === "" && status === "thinking" && isLastMessage && (
                  <span className="msgStatus thinking">Thinking...</span>
                )}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef as any} />
      </div>

      {/* Composer Area (Fixed Bottom) */}
      <div className="wpComposerArea">
        <div className="wpComposerBox">
          <textarea
            className="wpTextarea"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            disabled={loading || clearing}
            placeholder="Type your message..."
          />
          <div className="wpControls">
            <div className="wpHelper">Enter to send, Shift+Enter for new line</div>
            <div style={{ display: "flex", gap: "10px" }}>
              <button 
                className="wpBtn danger" 
                onClick={() => void clearChat()} 
                disabled={loading || clearing}
              >
                Clear Chat
              </button>
              <button 
                className="wpBtn" 
                onClick={() => stop()} 
                disabled={!loading}
              >
                Stop
              </button>
              <button 
                className="wpBtn primary" 
                onClick={() => void send()} 
                disabled={loading || clearing}
              >
                Send Message
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    {/* Theme Toggle Button (Bottom Left) */}
    <button 
      className="wpThemeToggle" 
      onClick={() => setTheme(prev => prev === "light" ? "dark" : "light")}
      title="Toggle Theme"
    >
      {theme === "light" ? "☾" : "☀"}
    </button>

    {/* Modal (Credits/Wallet) */}
    {walletOpen && (
      <div className="wpModalBackdrop" onMouseDown={() => setWalletOpen(false)}>
        <div className="wpModal" onMouseDown={e => e.stopPropagation()}>
          <div className="wpModalHead">
            <span className="wpModalTitle">Credits & Access</span>
            <button className="wpBtn" onClick={() => setWalletOpen(false)}>Close</button>
          </div>
          <div className="wpModalContent">
            
            <div className="wpSection">
              <span className="wpLabel">Pro Token (Existing User)</span>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <input 
                  className="wpTextarea" 
                  style={{ minHeight: '40px', padding: '8px 12px' }}
                  value={tokenDraft}
                  onChange={e => setTokenDraft(e.target.value)}
                  placeholder="Paste token here..."
                />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="wpBtn primary" onClick={() => void activateToken(tokenDraft)}>Load Token</button>
                <button className="wpBtn danger" onClick={() => {
                   setTokenDraft("");
                   void activateToken("");
                   setUiMsg("Token removed.");
                }}>Unlink</button>
              </div>
              {uiMsg && <div style={{ fontSize: 13, marginTop: 8, color: 'var(--wp-primary)' }}>{uiMsg}</div>}
            </div>

            <div className="wpSection">
              <span className="wpLabel">Purchase Credits (BTC)</span>
              {PLANS.map(p => (
                <div 
                  key={p.id} 
                  className={`wpPlanBtn ${planId === p.id ? 'active' : ''}`}
                  onClick={() => setPlanId(p.id)}
                >
                  <div style={{ fontWeight: 600 }}>{p.title} - ${p.priceUsd}</div>
                  <div style={{ fontSize: 13, color: 'var(--wp-muted)' }}>{p.credits.toLocaleString()} credits {p.note && `(${p.note})`}</div>
                </div>
              ))}
              
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button 
                  className="wpBtn primary" 
                  onClick={() => void createInvoice()}
                  disabled={billingState === "creating"}
                >
                  Create Invoice
                </button>
                <button 
                  className="wpBtn" 
                  onClick={() => void claimTokenOnce(invoiceId)}
                  disabled={!invoiceId}
                >
                  Check Payment
                </button>
              </div>

              {invoiceId && (
                <div style={{ marginTop: 12, padding: 12, background: 'var(--wp-bg)', borderRadius: 4, fontSize: 13 }}>
                  <div><strong>Invoice ID:</strong> {shortId(invoiceId)}</div>
                  {checkoutLink && (
                    <div style={{ marginTop: 4 }}>
                      <a href={checkoutLink} target="_blank" rel="noreferrer" style={{ color: 'var(--wp-primary)' }}>Open Payment Link ↗</a>
                    </div>
                  )}
                  {billingMsg && <div style={{ marginTop: 8, color: 'var(--wp-muted)', fontStyle: 'italic' }}>{billingMsg}</div>}
                </div>
              )}
            </div>

          </div>
        </div>
      </div>
    )}
  </div>
);