"""Create or reset the administrator account to the default e-mail and password.
Usage (from the backend folder):  python reset_admin.py [email] [password]
Change the password from the site after logging in."""
import sys
from werkzeug.security import generate_password_hash
from database import query
from models import init_db, DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD

init_db()
email = (sys.argv[1] if len(sys.argv) > 1 else DEFAULT_ADMIN_EMAIL).strip().lower()
password = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_ADMIN_PASSWORD
hashed = generate_password_hash(password)
if query("SELECT id FROM users WHERE email=?", (email,), one=True):
    query("UPDATE users SET password=?, is_admin=1, blocked=0 WHERE email=?", (hashed, email), commit=True)
else:
    query("INSERT INTO users (full_name, phone, email, city, password, is_admin) VALUES (?,?,?,?,?,1)",
          ("TaskLink Admin", "000000000", email, "Yaoundé", hashed), commit=True)
print(f"Administrator ready\n  e-mail:    {email}\n  password:  {password}")
