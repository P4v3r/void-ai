"""Database helpers for SQLite."""

import sqlite3

from config.settings import settings


def get_db() -> sqlite3.Connection:
    """Get a new database connection with row factory enabled."""
    conn = sqlite3.connect(settings.db_path, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    """Initialize the database schema. Creates all tables if they don't exist
    and migrates old schemas when needed."""
    conn = get_db()
    c = conn.cursor()

    # Pro tokens table
    c.execute("""
        CREATE TABLE IF NOT EXISTS pro_tokens (
            token_hash TEXT PRIMARY KEY,
            credits_left INTEGER NOT NULL,
            created_at INTEGER NOT NULL
        )
    """)

    # Invoices table
    c.execute("""
        CREATE TABLE IF NOT EXISTS invoices (
            invoice_id TEXT,
            order_id TEXT UNIQUE,
            credits INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at INTEGER NOT NULL
        )
    """)

    # ─── Migrations for existing databases ───

    # Add order_id column to invoices (added in payment refactor)
    try:
        c.execute("ALTER TABLE invoices ADD COLUMN order_id TEXT")
        conn.commit()
        print("Migration: added order_id to invoices table")
    except sqlite3.OperationalError:
        pass  # Column already exists

    # Remove claims table (no longer needed — tokens now issued directly
    # from webhook handler)
    try:
        c.execute("DROP TABLE IF EXISTS claims")
        conn.commit()
        print("Migration: removed obsolete claims table")
    except sqlite3.OperationalError:
        pass

    conn.commit()
    conn.close()
