import os, uuid
from flask import Blueprint, request, session, jsonify, send_from_directory
from database import query
from helpers import fail, inspect_upload, FILE_TYPES
from routes.auth import login_required

bp = Blueprint("portfolio", __name__)
UPLOADS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "uploads")
MAX_FILE = 30 * 1024 * 1024


@bp.post("/api/portfolio")
@login_required
def upload():
    f = request.files.get("file")
    ext, kind, size, err = inspect_upload(f, set(FILE_TYPES))
    if err == "EMPTY":
        return fail("The file is empty")
    if err:
        return fail("Use a JPG, PNG, WEBP, MP4, WEBM or MOV file")
    if size > MAX_FILE:
        return fail("File too large (max 30 MB)", 413)
    os.makedirs(UPLOADS, exist_ok=True)
    name = uuid.uuid4().hex + "." + ext                 # random name, never the user's
    f.save(os.path.join(UPLOADS, name))
    query("INSERT INTO portfolio (user_id, filename, kind, caption) VALUES (?,?,?,?)",
          (session["uid"], name, kind, request.form.get("caption", "").strip()[:150]), commit=True)
    return jsonify(ok=True)


@bp.get("/api/portfolio/<int:user_id>")
@login_required
def list_items(user_id):
    return jsonify(query(
        "SELECT id, filename, kind, caption, created FROM portfolio WHERE user_id=? ORDER BY id DESC",
        (user_id,)))


@bp.get("/uploads/<name>")
@login_required
def serve(name):
    return send_from_directory(UPLOADS, name)


@bp.delete("/api/portfolio/<int:item_id>")
@login_required
def delete_item(item_id):
    item = query("SELECT filename FROM portfolio WHERE id=? AND user_id=?", (item_id, session["uid"]), one=True)
    if not item:
        return fail("Not allowed", 404)
    query("DELETE FROM portfolio WHERE id=?", (item_id,), commit=True)
    try:
        os.remove(os.path.join(UPLOADS, item["filename"]))
    except OSError:
        pass
    return jsonify(ok=True)
