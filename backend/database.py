import os, sqlite3

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tasklink.db")


def get_db():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def query(sql, args=(), one=False, commit=False):
    """Run one SQL statement. Returns rows (list of dicts), one row, or the new id when commit=True."""
    conn = get_db()
    try:
        cur = conn.execute(sql, args)
        if commit:
            conn.commit()
            return cur.lastrowid
        rows = [dict(r) for r in cur.fetchall()]
        return (rows[0] if rows else None) if one else rows
    finally:
        conn.close()
