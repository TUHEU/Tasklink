"""Notifications shown in the bell (top of every page)."""
from database import query


def notify(user_id, kind, ref_name="", note="", link=""):
    """Add a notification for one user. The browser builds the sentence (French / English) from `kind`."""
    query("INSERT INTO notifications (user_id, kind, ref_name, note, link) VALUES (?,?,?,?,?)",
          (user_id, kind, (ref_name or "")[:120], (note or "")[:500], link), commit=True)


def notify_admins(kind, ref_name="", note="", link="admin.html"):
    for a in query("SELECT id FROM users WHERE is_admin=1 AND blocked=0"):
        notify(a["id"], kind, ref_name, note, link)
