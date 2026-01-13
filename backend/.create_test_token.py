import sqlite3
import hashlib
import secrets
import time

# Configurazione
DB_PATH = "void.db"
CREDITS_DA_DARE = 50000

def generate_token():
    # Genera token come fa il sistema reale
    raw_token = "void_" + secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
    return raw_token, token_hash

if __name__ == "__main__":
    # 1. Genera Token
    token, token_hash = generate_token()
    
    # 2. Connessione DB
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    # 3. Inserisci nel DB
    now = int(time.time())
    try:
        c.execute("INSERT INTO pro_tokens(token_hash, credits_left, created_at) VALUES (?, ?, ?)", 
                 (token_hash, CREDITS_DA_DARE, now))
        conn.commit()
        print(f"✅ SUCCESSO!")
        print(f"Token Generato: {token}")
        print(f"Crediti: {CREDITS_DA_DARE}")
        print("\nCopia questo token e incollalo nel sito (Settings -> Load Token)")
    except Exception as e:
        print(f"Errore: {e}")
    finally:
        conn.close()