from flask import Blueprint, session, jsonify
from database import query
from helpers import body, fail, text
from routes.auth import login_required

bp = Blueprint("messages", __name__)


@bp.get("/api/messages")
@login_required
def inbox():
    uid = session["uid"]
    rows = query(
        """SELECT m.id, m.content, m.created, m.sender_id, m.receiver_id,
                  a.full_name AS sender, b.full_name AS receiver
           FROM messages m
           JOIN users a ON a.id = m.sender_id
           JOIN users b ON b.id = m.receiver_id
           WHERE m.sender_id=? OR m.receiver_id=?
           ORDER BY m.id DESC""", (uid, uid))
    for r in rows:
        r["mine"] = r["sender_id"] == uid
    return jsonify(rows)


@bp.post("/api/messages")
@login_required
def send():
    d = body()
    content = text(d, "content")
    if not content:
        return fail("Write a message first")
    if len(content) > 2000:
        return fail("Text is too long")
    if d.get("to_id"):
        try:
            to = query("SELECT id FROM users WHERE id=? AND blocked=0", (int(d["to_id"]),), one=True)
        except (TypeError, ValueError):
            to = None
    else:
        to = query("SELECT id FROM users WHERE email=? AND blocked=0", (text(d, "to_email").lower(),), one=True)
    if not to:
        return fail("No user found", 404)
    if to["id"] == session["uid"]:
        return fail("You cannot message yourself")
    query("INSERT INTO messages (sender_id, receiver_id, content) VALUES (?,?,?)",
          (session["uid"], to["id"], content), commit=True)
    return jsonify(ok=True)
