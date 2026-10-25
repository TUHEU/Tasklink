"""One-to-one chat: conversation list, a thread you can poll for new messages, unread counter,
and attachments (pictures and PDF documents)."""
import os, re, uuid
from flask import Blueprint, request, session, jsonify, send_from_directory
from database import query
from helpers import body, fail, text, whole, inspect_upload, CHAT_TYPES
from routes.auth import login_required

bp = Blueprint("chat", __name__)
PARTNER = "id, full_name, profile_photo, city"
CHAT_UPLOADS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "uploads", "chat")
MAX_IMAGE = 10 * 1024 * 1024
MAX_PDF = 20 * 1024 * 1024
FILE_NAME_RE = re.compile(r"^[0-9a-f]{32}\.(jpg|jpeg|png|webp|pdf)$")
MIMES = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp", "pdf": "application/pdf"}


def partner_of(uid):
    """The other person (None if the account does not exist or was blocked by an administrator)."""
    return query(f"SELECT {PARTNER} FROM users WHERE id=? AND blocked=0", (uid,), one=True)


def attachment(row):
    """Turn the att_* columns into one small object (or None) and remove them from the row."""
    f = {"kind": row.pop("att_kind", ""), "name": row.pop("att_name", ""),
         "size": row.pop("att_size", 0), "file": row.pop("att_file", "")}
    return f if f["file"] else None


@bp.get("/api/chat/conversations")
@login_required
def conversations():
    me = session["uid"]
    rows = query(
        """SELECT m.id, m.content, m.created, m.sender_id, m.att_kind, m.att_name,
                  CASE WHEN m.sender_id=? THEN m.receiver_id ELSE m.sender_id END AS other_id
           FROM messages m WHERE m.sender_id=? OR m.receiver_id=? ORDER BY m.id DESC""", (me, me, me))
    unread = {r["sender_id"]: r["n"] for r in query(
        "SELECT sender_id, COUNT(*) AS n FROM messages WHERE receiver_id=? AND is_read=0 GROUP BY sender_id", (me,))}
    seen, out = set(), []
    for r in rows:                                  # newest first: first row per person = last message
        if r["other_id"] in seen:
            continue
        seen.add(r["other_id"])
        p = partner_of(r["other_id"])
        if not p:
            continue
        out.append({"user": p, "last": r["content"], "last_kind": r["att_kind"] or "", "last_name": r["att_name"] or "",
                    "created": r["created"], "mine": r["sender_id"] == me, "unread": unread.get(r["other_id"], 0)})
    return jsonify(out)


@bp.get("/api/chat/unread")
@login_required
def unread_count():
    n = query("SELECT COUNT(*) AS n FROM messages WHERE receiver_id=? AND is_read=0", (session["uid"],), one=True)["n"]
    return jsonify(count=n)


@bp.get("/api/chat/<int:other>")
@login_required
def thread(other):
    """Messages with one person. ?after=ID returns only newer ones (used for live refresh)."""
    me = session["uid"]
    p = partner_of(other)
    if not p or other == me:
        return fail("User not found", 404)
    after = whole(request.args.get("after", 0), 0) or 0
    rows = query(
        """SELECT id, sender_id, content, created, att_file, att_name, att_kind, att_size FROM messages
           WHERE id > ? AND ((sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?))
           ORDER BY id ASC LIMIT 300""", (after, me, other, other, me))
    for r in rows:
        r["mine"] = r.pop("sender_id") == me
        r["attachment"] = attachment(r)
    query("UPDATE messages SET is_read=1 WHERE receiver_id=? AND sender_id=? AND is_read=0", (me, other), commit=True)
    return jsonify(user=p, messages=rows)


@bp.post("/api/chat/<int:other>")
@login_required
def send(other):
    me = session["uid"]
    content = text(body(), "content")
    if other == me:
        return fail("You cannot message yourself")
    if not partner_of(other):
        return fail("No user found", 404)
    if not content:
        return fail("Write a message first")
    if len(content) > 2000:
        return fail("Text is too long")
    mid = query("INSERT INTO messages (sender_id, receiver_id, content) VALUES (?,?,?)",
                (me, other, content), commit=True)
    return jsonify(ok=True, id=mid)


# ---------------------------------------------------------------- attachments (pictures and PDF)
@bp.post("/api/chat/<int:other>/attachment")
@login_required
def send_attachment(other):
    """Send one picture (JPG, PNG, WEBP; 10 MB max) or one PDF (20 MB max), with an optional text."""
    me = session["uid"]
    if other == me:
        return fail("You cannot message yourself")
    if not partner_of(other):
        return fail("No user found", 404)
    f = request.files.get("file")
    ext, kind, size, err = inspect_upload(f, set(CHAT_TYPES), CHAT_TYPES)
    if err == "EMPTY":
        return fail("The file is empty")
    if err:
        return fail("Send a JPG, PNG, WEBP picture or a PDF")
    if kind == "image" and size > MAX_IMAGE:
        return fail("Pictures must be smaller than 10 MB")
    if kind == "pdf" and size > MAX_PDF:
        return fail("PDF files must be smaller than 20 MB")
    caption = (request.form.get("content") or "").strip()
    if len(caption) > 2000:
        return fail("Text is too long")
    original = re.sub(r"[\x00-\x1f\\/]", "", os.path.basename(f.filename or ""))[:100] or ("file." + ext)
    os.makedirs(CHAT_UPLOADS, exist_ok=True)
    stored = uuid.uuid4().hex + "." + ext                  # random name, never the user's
    f.save(os.path.join(CHAT_UPLOADS, stored))
    mid = query("""INSERT INTO messages (sender_id, receiver_id, content, att_file, att_name, att_kind, att_size)
                   VALUES (?,?,?,?,?,?,?)""", (me, other, caption, stored, original, kind, size), commit=True)
    return jsonify(ok=True, id=mid)


@bp.get("/api/chat/file/<name>")
@login_required
def chat_file(name):
    """Only the sender and the receiver of the message can open its attachment."""
    if not FILE_NAME_RE.match(name):
        return fail("Not found", 404)
    me = session["uid"]
    row = query("SELECT att_name FROM messages WHERE att_file=? AND (sender_id=? OR receiver_id=?)",
                (name, me, me), one=True)
    if not row:
        return fail("Not found", 404)
    ext = name.rsplit(".", 1)[1]
    download = request.args.get("download") == "1"
    return send_from_directory(CHAT_UPLOADS, name, mimetype=MIMES[ext], as_attachment=download,
                               download_name=row["att_name"] if download else None)


@bp.post("/api/chat/find")
@login_required
def find_by_email():
    """Start a chat with someone you know only by e-mail."""
    u = query("SELECT id FROM users WHERE email=? AND blocked=0", (text(body(), "email").lower(),), one=True)
    if not u:
        return fail("No user found", 404)
    if u["id"] == session["uid"]:
        return fail("You cannot message yourself")
    return jsonify(id=u["id"])
