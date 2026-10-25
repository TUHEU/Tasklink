"""TaskLink - Flask application setup.

Run with:  python app.py   (then open http://127.0.0.1:5000)
"""
import os, secrets, logging
from datetime import timedelta
from flask import Flask, request, jsonify
from werkzeug.exceptions import HTTPException

from models import init_db
from routes import auth, users, services, missions, messages, portfolio, chat, admin, notifications

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND = os.path.join(BASE_DIR, "..", "frontend")


def load_secret_key():
    """Stable secret key so logins survive a restart (7-day sessions).
    Priority: SECRET_KEY env variable, then backend/.secret_key (created on first run)."""
    if os.environ.get("SECRET_KEY"):
        return os.environ["SECRET_KEY"]
    path = os.path.join(BASE_DIR, ".secret_key")
    try:
        with open(path) as f:
            key = f.read().strip()
        if key:
            return key
    except OSError:
        pass
    key = secrets.token_hex(32)
    try:
        with open(path, "w") as f:
            f.write(key)
    except OSError:
        pass  # read-only folder: fall back to a key valid for this run only
    return key


app = Flask(__name__, static_folder=FRONTEND, static_url_path="")
app.secret_key = load_secret_key()
app.config.update(
    MAX_CONTENT_LENGTH=31 * 1024 * 1024,      # 30 MB file + form overhead
    SEND_FILE_MAX_AGE_DEFAULT=0,              # always re-check CSS/JS so edits show up
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SECURE=os.environ.get("COOKIE_SECURE") == "1",
)
app.permanent_session_lifetime = timedelta(days=7)

for module in (auth, users, services, missions, messages, portfolio, chat, admin, notifications):
    app.register_blueprint(module.bp)


@app.route("/")
def index():
    return app.send_static_file("index.html")


@app.after_request
def security_headers(resp):
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("Referrer-Policy", "same-origin")
    return resp


def wants_json():
    return request.path.startswith(("/api/", "/uploads/"))


@app.errorhandler(HTTPException)
def http_error(e):
    if not wants_json():
        return e
    messages_ = {413: "File too large (max 30 MB)", 403: "Not allowed", 404: "Not found", 405: "Method not allowed",
                 415: "Please send JSON data"}
    return jsonify(error=messages_.get(e.code, e.description or "Something went wrong")), e.code


@app.errorhandler(Exception)
def server_error(e):
    logging.exception("Unhandled error")
    if wants_json():
        return jsonify(error="Something went wrong"), 500
    return "Something went wrong", 500


# Create the tables (and upgrade an older database) whenever the app starts.
init_db()

if __name__ == "__main__":
    app.run(debug=os.environ.get("FLASK_DEBUG") == "1")
