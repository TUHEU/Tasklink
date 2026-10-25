import os, secrets
from werkzeug.security import generate_password_hash
from database import get_db

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL, phone TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE, city TEXT NOT NULL, password TEXT NOT NULL,
    bio TEXT DEFAULT '', skills TEXT DEFAULT '', profile_photo TEXT DEFAULT '',
    lat REAL, lng REAL, location_label TEXT DEFAULT '', share_location INTEGER DEFAULT 0,
    is_admin INTEGER DEFAULT 0, blocked INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
    title TEXT NOT NULL, category TEXT, description TEXT, price INTEGER, city TEXT,
    kind TEXT DEFAULT 'service'
);
CREATE TABLE IF NOT EXISTS missions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
    title TEXT NOT NULL, description TEXT, budget INTEGER, city TEXT,
    status TEXT DEFAULT 'open', worker_id INTEGER
);
CREATE TABLE IF NOT EXISTS portfolio (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
    filename TEXT NOT NULL, kind TEXT NOT NULL, caption TEXT DEFAULT '',
    created TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT, mission_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL, UNIQUE (mission_id, user_id)
);
CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT, mission_id INTEGER,
    reviewer_id INTEGER NOT NULL, worker_id INTEGER NOT NULL,
    rating INTEGER NOT NULL, comment TEXT DEFAULT '',
    created TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT, reporter_id INTEGER NOT NULL,
    reported_id INTEGER NOT NULL, reason TEXT NOT NULL,
    created TEXT DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'pending', admin_note TEXT DEFAULT '',
    reviewed_by INTEGER, reviewed_at TEXT
);
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, sender_id INTEGER NOT NULL,
    receiver_id INTEGER NOT NULL, content TEXT NOT NULL,
    created TEXT DEFAULT CURRENT_TIMESTAMP, is_read INTEGER DEFAULT 0,
    att_file TEXT DEFAULT '', att_name TEXT DEFAULT '', att_kind TEXT DEFAULT '', att_size INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
    kind TEXT NOT NULL, ref_name TEXT DEFAULT '', note TEXT DEFAULT '', link TEXT DEFAULT '',
    is_read INTEGER DEFAULT 0, created TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_services_user ON services(user_id);
CREATE INDEX IF NOT EXISTS idx_missions_user ON missions(user_id);
CREATE INDEX IF NOT EXISTS idx_portfolio_user ON portfolio(user_id);
CREATE INDEX IF NOT EXISTS idx_reviews_worker ON reviews(worker_id);
CREATE INDEX IF NOT EXISTS idx_messages_users ON messages(sender_id, receiver_id);
"""

# Created after the upgrades below, because an old database must be rebuilt first.
# A mission review is unique per mission; a direct review is unique per (reviewer, provider).
LATE_INDEXES = """
CREATE INDEX IF NOT EXISTS idx_reviews_worker ON reviews(worker_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_mission ON reviews(mission_id) WHERE mission_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_direct ON reviews(reviewer_id, worker_id) WHERE mission_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_messages_unread ON messages(receiver_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, reported_id);
"""

# Columns added after the first version: (table, column, definition)
UPGRADES = [
    ("users", "profile_photo", "TEXT DEFAULT ''"),
    ("services", "kind", "TEXT DEFAULT 'service'"),
    ("users", "lat", "REAL"),
    ("users", "lng", "REAL"),
    ("users", "location_label", "TEXT DEFAULT ''"),
    ("users", "share_location", "INTEGER DEFAULT 0"),
    ("messages", "is_read", "INTEGER DEFAULT 0"),
    ("users", "is_admin", "INTEGER DEFAULT 0"),
    ("users", "blocked", "INTEGER DEFAULT 0"),
    ("reports", "status", "TEXT DEFAULT 'pending'"),
    ("reports", "admin_note", "TEXT DEFAULT ''"),
    ("reports", "reviewed_by", "INTEGER"),
    ("reports", "reviewed_at", "TEXT"),
    ("messages", "att_file", "TEXT DEFAULT ''"),
    ("messages", "att_name", "TEXT DEFAULT ''"),
    ("messages", "att_kind", "TEXT DEFAULT ''"),
    ("messages", "att_size", "INTEGER DEFAULT 0"),
]


def upgrade_reviews(conn):
    """Old databases: reviews.mission_id was NOT NULL + UNIQUE, so a review could only follow a mission.
    Rebuild the table so a client can also review a provider directly (data is kept)."""
    cols = {r[1]: r for r in conn.execute("PRAGMA table_info(reviews)")}
    if "created" in cols and not cols["mission_id"][3]:
        return
    conn.executescript("""
        DROP TABLE IF EXISTS reviews_new;
        CREATE TABLE reviews_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT, mission_id INTEGER,
            reviewer_id INTEGER NOT NULL, worker_id INTEGER NOT NULL,
            rating INTEGER NOT NULL, comment TEXT DEFAULT '',
            created TEXT DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO reviews_new (id, mission_id, reviewer_id, worker_id, rating, comment)
            SELECT id, mission_id, reviewer_id, worker_id, rating, comment FROM reviews;
        DROP TABLE reviews;
        ALTER TABLE reviews_new RENAME TO reviews;
    """)


def init_db():
    """Create missing tables and add missing columns to an older database."""
    conn = get_db()
    try:
        conn.executescript(SCHEMA)
        for table, column, definition in UPGRADES:
            existing = [r[1] for r in conn.execute(f"PRAGMA table_info({table})")]
            if column not in existing:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
                if (table, column) == ("messages", "is_read"):      # old messages count as already read
                    conn.execute("UPDATE messages SET is_read=1")
        upgrade_reviews(conn)
        conn.executescript(LATE_INDEXES)
        seed_admin(conn)
        conn.commit()
    finally:
        conn.close()


def seed_admin(conn):
    """Make sure at least one administrator exists.

    - ADMIN_EMAIL / ADMIN_PASSWORD (environment variables) choose the account.
    - Without them, admin@tasklink.cm is created with a random password that is printed
      once in the console and saved in backend/admin_credentials.txt (delete it after reading).
    - To promote an existing user instead:  python make_admin.py their@email.com
    """
    if conn.execute("SELECT 1 FROM users WHERE is_admin=1 LIMIT 1").fetchone():
        return
    email = (os.environ.get("ADMIN_EMAIL") or "admin@tasklink.cm").strip().lower()
    password = os.environ.get("ADMIN_PASSWORD")
    existing = conn.execute("SELECT id FROM users WHERE email=?", (email,)).fetchone()
    if existing:                                    # that e-mail already has an account: promote it
        conn.execute("UPDATE users SET is_admin=1, blocked=0 WHERE id=?", (existing[0],))
        return
    generated = not password
    if generated:
        password = secrets.token_urlsafe(9)
    conn.execute(
        "INSERT INTO users (full_name, phone, email, city, password, is_admin) VALUES (?,?,?,?,?,1)",
        ("TaskLink Admin", "000000000", email, "Yaound\u00e9", generate_password_hash(password)))
    if generated:
        try:
            with open(os.path.join(BASE_DIR, "admin_credentials.txt"), "w", encoding="utf-8") as f:
                f.write(f"TaskLink administrator\nE-mail: {email}\nPassword: {password}\n"
                        "Delete this file once you have saved the password somewhere safe.\n")
        except OSError:
            pass
        print(f"\n*** TaskLink administrator created ***\n    e-mail:    {email}\n    password:  {password}\n"
              "    (also saved in backend/admin_credentials.txt)\n")
