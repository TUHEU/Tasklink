import time, sqlite3
from functools import wraps
from flask import Blueprint, session, jsonify
from werkzeug.security import generate_password_hash, check_password_hash
from database import query
from helpers import (body, fail, text, clean_name, valid_name, valid_email, clean_phone,
                     password_problem, CITIES)

bp = Blueprint("auth", __name__)
attempts = {}          # email -> times of recent wrong passwords (kept in memory)
WINDOW, MAX_TRIES = 600, 5


def login_required(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if "uid" not in session:
            return jsonify(error="Please log in"), 401
        u = query("SELECT blocked FROM users WHERE id=?", (session["uid"],), one=True)
        if not u:                                   # the account no longer exists
            session.clear()
            return jsonify(error="Please log in"), 401
        if u["blocked"]:                            # an administrator blocked this account
            session.clear()
            return jsonify(error="This account has been blocked by an administrator", blocked=True), 401
        return f(*args, **kwargs)
    return wrapper


def admin_required(f):
    """Only administrators (users.is_admin = 1)."""
    @wraps(f)
    @login_required
    def wrapper(*args, **kwargs):
        u = query("SELECT is_admin FROM users WHERE id=?", (session["uid"],), one=True)
        if not u or not u["is_admin"]:
            return jsonify(error="Not allowed"), 403
        return f(*args, **kwargs)
    return wrapper


def is_admin():
    u = query("SELECT is_admin FROM users WHERE id=?", (session.get("uid"),), one=True)
    return bool(u and u["is_admin"])


@bp.post("/api/register")
def register():
    d = body()
    name, phone = clean_name(text(d, "full_name")), text(d, "phone")
    email, city = text(d, "email"), text(d, "city")
    password = d.get("password")
    if not (name and phone and email and city) or not isinstance(password, str) or not password:
        return fail("Please complete all required fields")
    if email != email.lower():
        return fail("Use lowercase letters only in the email address")
    if len(password) > 128 or len(name) > 80:
        return fail("Text is too long")
    if not valid_name(name):
        return fail("Enter your real full name (letters only, at least 2 characters)")
    if not valid_email(email):
        return fail("Enter a valid email address")
    phone = clean_phone(phone)
    if not phone:
        return fail("Enter a valid phone number")
    if city not in CITIES:
        return fail("Choose a city from the list")
    problem = password_problem(password, email, name)
    if problem:
        return fail(problem)
    if query("SELECT id FROM users WHERE email=?", (email,), one=True):
        return fail("This email is already in use")
    try:
        uid = query("INSERT INTO users (full_name, phone, email, city, password) VALUES (?,?,?,?,?)",
                    (name, phone, email, city, generate_password_hash(password)), commit=True)
    except sqlite3.IntegrityError:          # two sign-ups with the same email at the same time
        return fail("This email is already in use")
    session.clear()
    session.permanent = True
    session["uid"] = uid
    return jsonify(ok=True)


@bp.post("/api/login")
def login():
    d = body()
    key, password = text(d, "email").lower(), d.get("password")
    if not key or not isinstance(password, str) or not password:
        return fail("Wrong email or password", 401)
    now = time.time()
    recent = [t for t in attempts.get(key, []) if now - t < WINDOW]
    if len(recent) >= MAX_TRIES:
        attempts[key] = recent
        return fail("Too many attempts. Try again in 10 minutes.", 429)
    user = query("SELECT id, password, blocked, is_admin FROM users WHERE email=?", (key,), one=True)
    if not user or not check_password_hash(user["password"], password):
        attempts[key] = recent + [now]
        return fail("Wrong email or password", 401)
    attempts.pop(key, None)
    if user["blocked"]:                             # only said after a correct password
        return fail("This account has been blocked by an administrator", 403)
    session.clear()
    session.permanent = True
    session["uid"] = user["id"]
    return jsonify(ok=True, is_admin=bool(user["is_admin"]))


@bp.post("/api/logout")
def logout():
    session.clear()
    return jsonify(ok=True)
