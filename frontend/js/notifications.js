/* Notifications page: decisions of the administrator on your reports (and new reports, for administrators). */
const $ = (id) => document.getElementById(id);
const ICON = { report_accepted: ["✅", "ok"], report_rejected: ["ℹ️", "no"], report_new: ["🚩", "no"] };

async function load() {
  const list = $("list");
  try {
    const items = await api("/api/notifications");
    list.innerHTML = items.map((n) => {
      const [ico, cls] = ICON[n.kind] || ["🔔", ""];
      const inner = `<span class="ico" aria-hidden="true">${ico}</span>
        <div><b>${esc(noteText(n))}</b>${n.note ? `<p>${esc(noteExtra(n))}</p>` : ""}<time>${esc(fmtDate(n.created))}</time></div>`;
      const klass = `card note ${cls} ${n.is_read ? "" : "unread"}`;
      return n.link ? `<a class="${klass}" href="${esc(n.link)}">${inner}</a>` : `<div class="${klass}">${inner}</div>`;
    }).join("") || `<div class="empty-state">No notifications yet.</div>`;
    if (items.some((n) => !n.is_read)) {          // they are now seen: clear the bell
      await api("/api/notifications/read", "POST", {});
      if (window.refreshNotes) window.refreshNotes();
    }
  } catch (err) { list.innerHTML = `<p class="msg">${esc(t(err.message))}</p>`; }
}

$("readAll").onclick = async () => {
  try { await api("/api/notifications/read", "POST", {}); document.querySelectorAll(".note.unread").forEach((el) => el.classList.remove("unread")); if (window.refreshNotes) window.refreshNotes(); }
  catch (err) {}
};
load();
