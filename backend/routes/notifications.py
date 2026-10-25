"""The bell: list of notifications, unread counter, mark as read."""
from flask import Blueprint, request, session, jsonify
from database import query
from helpers import whole
from routes.auth import login_required

bp = Blueprint("notifications", __name__)
COLS = "id, kind, ref_name, note, link, is_read, created"


@bp.get("/api/notifications")
@login_required
def list_notifications():
    rows = query(f"SELECT {COLS} FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 60", (session["uid"],))
    for r in rows:
        r["is_read"] = bool(r["is_read"])
    return jsonify(rows)


@bp.get("/api/notifications/unread")
@login_required
def unread():
    """Small answer polled every few seconds by every page: counter + newest unread one (for the pop-up)."""
    me = session["uid"]
    count = query("SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND is_read=0", (me,), one=True)["n"]
    latest = query(f"SELECT {COLS} FROM notifications WHERE user_id=? AND is_read=0 ORDER BY id DESC LIMIT 1",
                   (me,), one=True)
    admin = query("SELECT is_admin FROM users WHERE id=?", (me,), one=True)
    return jsonify(count=count, latest=latest, is_admin=bool(admin and admin["is_admin"]))


@bp.post("/api/notifications/read")
@login_required
def mark_read():
    """Mark one notification (id) or all of them as read."""
    nid = (request.get_json(silent=True) or {}).get("id")
    if nid is None:
        query("UPDATE notifications SET is_read=1 WHERE user_id=?", (session["uid"],), commit=True)
    else:
        n = whole(nid, 1)
        if n is not None:
            query("UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?", (n, session["uid"]), commit=True)
    return jsonify(ok=True)
