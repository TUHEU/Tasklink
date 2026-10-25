"""Make an existing account an administrator (or remove the rights).

    python make_admin.py someone@example.com           # promote
    python make_admin.py someone@example.com --remove  # demote
"""
import sys
from database import get_db
from models import init_db

if len(sys.argv) < 2:
    sys.exit(__doc__)
init_db()
email, remove = sys.argv[1].strip().lower(), "--remove" in sys.argv
conn = get_db()
cur = conn.execute("UPDATE users SET is_admin=? WHERE email=?", (0 if remove else 1, email))
conn.commit()
conn.close()
print(("Administrator rights removed from " if remove else "Administrator rights given to ") + email
      if cur.rowcount else "No account with the e-mail " + email)
