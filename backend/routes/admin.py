"""Administrator tools: review reports, block / unblock accounts. The reporter is notified of the decision."""
from flask import Blueprint, request, session, jsonify
from database import query
from helpers import body, fail, text
from notify import notify
from routes.auth import admin_required

bp = Blueprint("admin", __name__)
STATUSES = ("pending", "accepted", "rejected")


@bp.get("/api/admin/summary")
@admin_required
def summary():
    counts = {s: 0 for s in STATUSES}
    for r in query("SELECT COALESCE(status,'pending') AS status, COUNT(*) AS n FROM reports GROUP BY 1"):
        counts[r["status"]] = r["n"]
    counts["blocked"] = query("SELECT COUNT(*) AS n FROM users WHERE blocked=1", one=True)["n"]
    return jsonify(counts)


@bp.get("/api/admin/reports")
@admin_required
def list_reports():
    status = request.args.get("status", "pending")
    sql = """SELECT r.id, r.reason, r.created, COALESCE(r.status,'pending') AS status, r.admin_note, r.reviewed_at,
                    a.id AS reporter_id, a.full_name AS reporter, a.profile_photo AS reporter_photo,
                    b.id AS reported_id, b.full_name AS reported, b.profile_photo AS reported_photo,
                    b.city AS reported_city, b.email AS reported_email, b.phone AS reported_phone,
                    b.bio AS reported_bio, b.blocked AS reported_blocked, b.is_admin AS reported_admin,
                    (SELECT COUNT(*) FROM reports x WHERE x.reported_id = r.reported_id) AS total_against
             FROM reports r
             JOIN users a ON a.id = r.reporter_id
             JOIN users b ON b.id = r.reported_id"""
    args = ()
    if status in STATUSES:
        sql += " WHERE COALESCE(r.status,'pending') = ?"
        args = (status,)
    rows = query(sql + " ORDER BY r.id DESC LIMIT 200", args)
    for r in rows:
        r["reported_blocked"] = bool(r["reported_blocked"])
        r["reported_admin"] = bool(r["reported_admin"])
    return jsonify(rows)


@bp.post("/api/admin/reports/<int:report_id>/decision")
@admin_required
def decide(report_id):
    """accept = block the reported account (all its pending reports are closed); reject = no action."""
    d = body()
    decision, note = text(d, "decision"), text(d, "note")[:500]
    if decision not in ("accept", "reject"):
        return fail("Choose accept or reject")
    rep = query("SELECT * FROM reports WHERE id=?", (report_id,), one=True)
    if not rep:
        return fail("Not found", 404)
    if (rep["status"] or "pending") != "pending":
        return fail("This report has already been reviewed")
    target = query("SELECT id, full_name, is_admin FROM users WHERE id=?", (rep["reported_id"],), one=True)
    if not target:
        return fail("User not found", 404)
    me = session["uid"]

    if decision == "accept":
        if target["is_admin"]:
            return fail("An administrator account cannot be blocked")
        query("UPDATE users SET blocked=1 WHERE id=?", (target["id"],), commit=True)
        pending = query("SELECT id, reporter_id FROM reports WHERE reported_id=? AND COALESCE(status,'pending')='pending'",
                        (target["id"],))
        for p in pending:                                   # the block settles every open report on this account
            query("""UPDATE reports SET status='accepted', admin_note=?, reviewed_by=?, reviewed_at=CURRENT_TIMESTAMP
                     WHERE id=?""", (note, me, p["id"]), commit=True)
            notify(p["reporter_id"], "report_accepted", target["full_name"], note)
    else:
        query("""UPDATE reports SET status='rejected', admin_note=?, reviewed_by=?, reviewed_at=CURRENT_TIMESTAMP
                 WHERE id=?""", (note, me, report_id), commit=True)
        notify(rep["reporter_id"], "report_rejected", target["full_name"], note)
    return jsonify(ok=True)


@bp.get("/api/admin/blocked")
@admin_required
def blocked_users():
    return jsonify(query("""SELECT id, full_name, email, phone, city, profile_photo FROM users
                            WHERE blocked=1 ORDER BY full_name"""))


@bp.post("/api/admin/users/<int:user_id>/unblock")
@admin_required
def unblock(user_id):
    if not query("SELECT id FROM users WHERE id=?", (user_id,), one=True):
        return fail("User not found", 404)
    query("UPDATE users SET blocked=0 WHERE id=?", (user_id,), commit=True)
    return jsonify(ok=True)
