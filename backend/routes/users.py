import os, uuid
from flask import Blueprint, session, jsonify
from database import query
from helpers import body, fail, text, whole, inspect_upload, clean_name, valid_name, CITIES
from routes.auth import login_required, is_admin
from notify import notify_admins
from flask import request

bp = Blueprint("users", __name__)
UPLOADS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "uploads")
PHOTO_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}
MAX_PHOTO = 5 * 1024 * 1024


@bp.get("/api/me")
@login_required
def get_me():
    me = query("""SELECT id, full_name, phone, email, city, bio, skills, profile_photo,
                         lat, lng, location_label, share_location, is_admin FROM users WHERE id=?""",
               (session["uid"],), one=True)
    if not me:                                  # account no longer exists
        session.clear()
        return fail("Please log in", 401)
    return jsonify(me)


@bp.put("/api/me")
@login_required
def update_me():
    d = body()
    name, city = clean_name(text(d, "full_name")), text(d, "city")
    bio, skills = text(d, "bio"), text(d, "skills")
    if not name or not city:
        return fail("Name and city are required")
    if not valid_name(name):
        return fail("Enter your real full name (letters only, at least 2 characters)")
    if city not in CITIES:
        return fail("Choose a city from the list")
    if len(name) > 80 or len(bio) > 500 or len(skills) > 200:
        return fail("Text is too long")
    query("UPDATE users SET full_name=?, city=?, bio=?, skills=? WHERE id=?",
          (name, city, bio, skills, session["uid"]), commit=True)
    return jsonify(ok=True)


@bp.post("/api/profile-photo")
@login_required
def upload_profile_photo():
    ext, kind, size, err = inspect_upload(request.files.get("file"), PHOTO_EXTENSIONS)
    if err == "EMPTY":
        return fail("The file is empty")
    if err:
        return fail("Choose a JPG, PNG or WEBP profile picture")
    if size > MAX_PHOTO:
        return fail("Profile pictures must be smaller than 5 MB")
    os.makedirs(UPLOADS, exist_ok=True)
    name = uuid.uuid4().hex + "." + ext                 # random name, never the user's
    request.files["file"].save(os.path.join(UPLOADS, name))
    old = query("SELECT profile_photo FROM users WHERE id=?", (session["uid"],), one=True)
    query("UPDATE users SET profile_photo=? WHERE id=?", (name, session["uid"]), commit=True)
    if old and old.get("profile_photo"):
        try:
            os.remove(os.path.join(UPLOADS, os.path.basename(old["profile_photo"])))
        except OSError:
            pass
    return jsonify(ok=True, profile_photo=name)


@bp.get("/api/users/<int:user_id>")
@login_required
def get_user(user_id):
    user = query("SELECT id, full_name, phone, city, bio, skills, profile_photo, blocked FROM users WHERE id=?",
                 (user_id,), one=True)
    if not user or (user["blocked"] and not is_admin()):      # blocked accounts disappear (admins can still see them)
        return fail("User not found", 404)
    user["blocked"] = bool(user["blocked"])
    user["rating"] = query("SELECT ROUND(AVG(rating), 1) AS avg, COUNT(*) AS n FROM reviews WHERE worker_id=?",
                           (user_id,), one=True)
    user["reviews"] = query(
        """SELECT r.id, r.rating, r.comment, r.created, r.reviewer_id, u.full_name AS reviewer,
                  u.profile_photo AS reviewer_photo, (r.mission_id IS NOT NULL) AS verified
           FROM reviews r JOIN users u ON u.id = r.reviewer_id
           WHERE r.worker_id=? ORDER BY r.id DESC LIMIT 50""", (user_id,))
    for r in user["reviews"]:
        r["verified"] = bool(r["verified"])           # True = written after a completed mission
        r["mine"] = r["reviewer_id"] == session["uid"]
        del r["reviewer_id"]
    counts = {row["rating"]: row["n"] for row in query(
        "SELECT rating, COUNT(*) AS n FROM reviews WHERE worker_id=? GROUP BY rating", (user_id,))}
    user["distribution"] = {str(i): counts.get(i, 0) for i in range(1, 6)}
    user["services"] = query(
        "SELECT id, title, category, description, price, kind FROM services WHERE user_id=? ORDER BY id DESC",
        (user_id,))
    return jsonify(user)


@bp.post("/api/report")
@login_required
def report():
    d = body()
    reason = text(d, "reason")
    try:
        target = int(d.get("user_id"))
    except (TypeError, ValueError):
        return fail("Choose a profile and provide a reason")
    if not reason:
        return fail("Choose a profile and provide a reason")
    other = query("SELECT id, full_name, is_admin, blocked FROM users WHERE id=?", (target,), one=True)
    if target == session["uid"] or not other or other["is_admin"] or other["blocked"]:
        return fail("Not allowed")
    if query("SELECT 1 FROM reports WHERE reporter_id=? AND reported_id=? AND COALESCE(status,'pending')='pending'",
             (session["uid"], target), one=True):
        return fail("You already reported this profile. An administrator is reviewing it.")
    query("INSERT INTO reports (reporter_id, reported_id, reason) VALUES (?,?,?)",
          (session["uid"], target, reason[:500]), commit=True)
    notify_admins("report_new", other["full_name"], reason[:200])
    return jsonify(ok=True)


# ---------------------------------------------------------------- reviews on a profile
@bp.post("/api/users/<int:user_id>/reviews")
@login_required
def leave_review(user_id):
    """Rate a provider and say what you think of their skill. One review per person; sending again edits it."""
    d = body()
    rating = whole(d.get("rating"), 1, 5)
    comment = text(d, "comment")
    if user_id == session["uid"]:
        return fail("You cannot review yourself")
    if not query("SELECT id FROM users WHERE id=?", (user_id,), one=True):
        return fail("User not found", 404)
    if rating is None:
        return fail("Choose a rating from 1 to 5")
    if len(comment) < 5:
        return fail("Write a short comment about their skill (at least 5 characters)")
    if len(comment) > 500:
        return fail("Text is too long")
    mine = query("SELECT id FROM reviews WHERE reviewer_id=? AND worker_id=? AND mission_id IS NULL",
                 (session["uid"], user_id), one=True)
    if mine:
        query("UPDATE reviews SET rating=?, comment=?, created=CURRENT_TIMESTAMP WHERE id=?",
              (rating, comment, mine["id"]), commit=True)
    else:
        query("INSERT INTO reviews (reviewer_id, worker_id, rating, comment) VALUES (?,?,?,?)",
              (session["uid"], user_id, rating, comment), commit=True)
    return jsonify(ok=True)


@bp.delete("/api/users/<int:user_id>/reviews")
@login_required
def delete_review(user_id):
    query("DELETE FROM reviews WHERE reviewer_id=? AND worker_id=? AND mission_id IS NULL",
          (session["uid"], user_id), commit=True)
    return jsonify(ok=True)


# ---------------------------------------------------------------- meeting location
def _coord(v, lo, hi):
    try:
        if isinstance(v, bool):
            raise ValueError
        n = float(v)
    except (TypeError, ValueError):
        return None
    return round(n, 6) if lo <= n <= hi and n == n else None


@bp.put("/api/me/location")
@login_required
def set_location():
    """Save (or clear) the place where you are happy to meet people. Nobody sees it unless share is on."""
    d = body()
    if d.get("clear"):
        query("UPDATE users SET lat=NULL, lng=NULL, location_label='', share_location=0 WHERE id=?",
              (session["uid"],), commit=True)
        return jsonify(ok=True)
    lat, lng = _coord(d.get("lat"), -90, 90), _coord(d.get("lng"), -180, 180)
    if lat is None or lng is None:
        return fail("Choose a place on the map")
    label = text(d, "label")[:120]
    query("UPDATE users SET lat=?, lng=?, location_label=?, share_location=? WHERE id=?",
          (lat, lng, label, 1 if d.get("share") else 0, session["uid"]), commit=True)
    return jsonify(ok=True)


@bp.get("/api/location/<int:user_id>")
@login_required
def get_location(user_id):
    """A person's meeting place, for the route map. Only if they chose to share it AND you have chatted."""
    me = session["uid"]
    u = query("SELECT id, full_name, profile_photo, lat, lng, location_label, share_location, city, blocked FROM users WHERE id=?",
              (user_id,), one=True)
    if not u or u["blocked"]:
        return fail("User not found", 404)
    if user_id != me:
        if not u["share_location"] or u["lat"] is None:
            return fail("This person has not shared a meeting place yet", 404)
        talked = query("""SELECT 1 FROM messages WHERE (sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?)
                          LIMIT 1""", (me, user_id, user_id, me), one=True)
        if not talked:
            return fail("Send a message first, then you can see the route", 403)
    return jsonify(id=u["id"], full_name=u["full_name"], profile_photo=u["profile_photo"], city=u["city"],
                   lat=u["lat"], lng=u["lng"], label=u["location_label"])
