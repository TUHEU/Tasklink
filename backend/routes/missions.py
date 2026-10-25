from flask import Blueprint, request, session, jsonify
from database import query
from helpers import body, fail, text, whole
from routes.auth import login_required
from search import keywords, related, score

bp = Blueprint("missions", __name__)


def own_mission(mid):
    return query("SELECT * FROM missions WHERE id=? AND user_id=?", (mid, session["uid"]), one=True)


@bp.get("/api/missions")
@login_required
def list_missions():
    words = keywords(request.args.get("q", ""))
    extra = related(words)
    rows = query(
        """SELECT m.*, u.full_name AS author, u.profile_photo AS author_photo,
           EXISTS(SELECT 1 FROM applications a WHERE a.mission_id=m.id AND a.user_id=?) AS applied
           FROM missions m JOIN users u ON u.id = m.user_id
           WHERE m.status='open' AND m.user_id != ? AND u.blocked = 0
           ORDER BY m.id DESC""", (session["uid"], session["uid"]))
    for r in rows:
        r["applied"] = bool(r["applied"])
    if words:
        scored = [(score(words, r["title"], r["description"], extra=extra), r) for r in rows]
        rows = [r for s, r in sorted(scored, key=lambda x: -x[0]) if s > 0]
    return jsonify(rows)


@bp.get("/api/my-missions")
@login_required
def my_missions():
    missions = query("SELECT * FROM missions WHERE user_id=? ORDER BY id DESC", (session["uid"],))
    for m in missions:
        m["applicants"] = query(
            "SELECT u.id, u.full_name FROM applications a JOIN users u ON u.id=a.user_id WHERE a.mission_id=? AND u.blocked=0",
            (m["id"],))
        m["reviewed"] = bool(query("SELECT id FROM reviews WHERE mission_id=?", (m["id"],), one=True))
        worker = query("SELECT full_name FROM users WHERE id=?", (m["worker_id"],), one=True) \
            if m["worker_id"] else None
        m["worker"] = worker["full_name"] if worker else None
    return jsonify(missions)


@bp.post("/api/missions")
@login_required
def add_mission():
    d = body()
    title, description = text(d, "title"), text(d, "description")
    budget = whole(d.get("budget"))
    if not title or not description:
        return fail("Please complete all required fields")
    if len(title) > 120 or len(description) > 2000:
        return fail("Text is too long")
    if budget is None:
        return fail("Enter a valid budget")
    me = query("SELECT city FROM users WHERE id=?", (session["uid"],), one=True)
    query("INSERT INTO missions (user_id, title, description, budget, city) VALUES (?,?,?,?,?)",
          (session["uid"], title, description, budget, me["city"]), commit=True)
    return jsonify(ok=True)


@bp.post("/api/missions/<int:mid>/apply")
@login_required
def apply(mid):
    m = query("SELECT user_id, status FROM missions WHERE id=?", (mid,), one=True)
    if not m or m["status"] != "open" or m["user_id"] == session["uid"]:
        return fail("You cannot apply to this mission")
    query("INSERT OR IGNORE INTO applications (mission_id, user_id) VALUES (?,?)",
          (mid, session["uid"]), commit=True)
    return jsonify(ok=True)


@bp.post("/api/missions/<int:mid>/accept")
@login_required
def accept(mid):
    worker = whole(body().get("user_id"), 1)
    mission = own_mission(mid)
    if (worker is None or not mission or mission["status"] != "open" or not query(
            "SELECT id FROM applications WHERE mission_id=? AND user_id=?", (mid, worker), one=True)):
        return fail("Not allowed")
    query("UPDATE missions SET status='in_progress', worker_id=? WHERE id=?", (worker, mid), commit=True)
    return jsonify(ok=True)


@bp.post("/api/missions/<int:mid>/complete")
@login_required
def complete(mid):
    m = own_mission(mid)
    if not m or m["status"] != "in_progress":
        return fail("Not allowed")
    query("UPDATE missions SET status='done' WHERE id=?", (mid,), commit=True)
    return jsonify(ok=True)


@bp.post("/api/missions/<int:mid>/review")
@login_required
def review(mid):
    d = body()
    m = own_mission(mid)
    rating = whole(d.get("rating"), 1, 5)
    if (not m or m["status"] != "done" or not m["worker_id"] or rating is None
            or query("SELECT id FROM reviews WHERE mission_id=?", (mid,), one=True)):
        return fail("Not allowed")
    query("INSERT INTO reviews (mission_id, reviewer_id, worker_id, rating, comment) VALUES (?,?,?,?,?)",
          (mid, session["uid"], m["worker_id"], rating, text(d, "comment")[:500]), commit=True)
    return jsonify(ok=True)
