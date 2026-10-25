from flask import Blueprint, request, session, jsonify
from database import query
from helpers import body, fail, text, whole, CATEGORIES
from routes.auth import login_required
from search import keywords, related, score

bp = Blueprint("services", __name__)


@bp.get("/api/services")
@login_required
def list_services():
    words = keywords(request.args.get("q", ""))
    extra = related(words)
    category = request.args.get("category", "").strip()
    sql = """SELECT s.*, u.full_name AS provider, u.profile_photo AS photo,
                    u.skills AS skills, u.bio AS bio,
                    (SELECT ROUND(AVG(rating), 1) FROM reviews r WHERE r.worker_id = s.user_id) AS rating
             FROM services s JOIN users u ON u.id = s.user_id
             WHERE u.blocked = 0"""             # blocked accounts are hidden
    args = ()
    if category:
        sql += " AND s.category = ?"            # exact match (no LIKE wildcards)
        args = (category,)
    rows = query(sql + " ORDER BY s.id DESC", args)
    for r in rows:
        r["score"] = score(words, r["title"], r["description"], r["category"], r["skills"], r["bio"],
                           extra=extra) if words else 0
        del r["skills"], r["bio"]
    if words:
        rows = sorted([r for r in rows if r["score"] > 0], key=lambda r: r["score"], reverse=True)
    return jsonify(rows)


@bp.post("/api/services")
@login_required
def add_service():
    d = body()
    title, description, category = text(d, "title"), text(d, "description"), text(d, "category")
    price = whole(d.get("price"))
    if not title or not description:
        return fail("Please complete all required fields")
    if len(title) > 120 or len(description) > 2000:
        return fail("Text is too long")
    if category not in CATEGORIES:
        return fail("Choose a category from the list")
    if price is None:
        return fail("Enter a valid price")
    me = query("SELECT city FROM users WHERE id=?", (session["uid"],), one=True)
    kind = "training" if d.get("kind") == "training" else "service"
    query("INSERT INTO services (user_id, title, category, description, price, city, kind) VALUES (?,?,?,?,?,?,?)",
          (session["uid"], title, category, description, price, me["city"], kind), commit=True)
    return jsonify(ok=True)
