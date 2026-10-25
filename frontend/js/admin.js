/* Admin panel: examine reports, accept (= block the account) or reject, unblock accounts.
   The person who reported gets a notification with the decision. */
const $ = (id) => document.getElementById(id);
let tab = "pending";

const person = (name, photo, id, label) => `<div class="who">
  <small>${esc(t(label))}</small>
  <div class="card-head" style="margin:0">${avatarHtml(name, photo)}<b><a href="provider.html?id=${esc(id)}">${esc(name)}</a></b></div></div>`;

async function counters() {
  const c = await api("/api/admin/summary");
  $("counters").innerHTML = `<div class="warn"><b>${esc(c.pending)}</b><span>${esc(t("Pending"))}</span></div>
    <div><b>${esc(c.accepted)}</b><span>${esc(t("Accepted"))}</span></div>
    <div><b>${esc(c.rejected)}</b><span>${esc(t("Rejected"))}</span></div>
    <div class="bad"><b>${esc(c.blocked)}</b><span>${esc(t("Blocked users"))}</span></div>`;
}

function reportCard(r) {
  const done = r.status !== "pending";
  const verdict = done ? `<p class="verdict"><span class="badge ${r.status === "accepted" ? "no" : "open"}">${esc(t(r.status === "accepted" ? "Blocked" : "Rejected"))}</span>
      ${r.reviewed_at ? `<span class="meta"> · ${esc(fmtDate(r.reviewed_at))}</span>` : ""}
      ${r.admin_note ? `<br><span class="meta">${esc(noteExtra({ kind: "x", note: r.admin_note }))}</span>` : ""}</p>` : "";
  return `<div class="card report" data-id="${esc(r.id)}">
    <div class="pair">${person(r.reporter, r.reporter_photo, r.reporter_id, "Reported by")}<span class="arrow">→</span>${person(r.reported, r.reported_photo, r.reported_id, "Reported profile")}</div>
    <div class="reason"><b>${esc(t("Reason"))}:</b> ${esc(r.reason)}</div>
    <div class="facts"><span>${esc(fmtDate(r.created))}</span><span>${esc(r.total_against)} ${esc(t(r.total_against > 1 ? "reports on this profile" : "report on this profile"))}</span>
      <span>${esc(t("E-mail"))}: ${esc(r.reported_email)}</span><span>${esc(t("Phone"))}: ${esc(r.reported_phone)}</span>
      ${r.reported_blocked ? `<span class="badge no">${esc(t("Blocked"))}</span>` : ""}</div>
    ${done ? verdict : `<label>${esc(t("Admin message (optional)"))}
        <textarea maxlength="500" data-note placeholder="${esc(t("Visible by the person who reported."))}"></textarea></label>
      <div class="row-actions" style="margin-top:10px">
        <button type="button" class="danger" data-do="accept">${esc(t("Accept and block"))}</button>
        <button type="button" class="ghost" data-do="reject">${esc(t("Reject"))}</button></div>`}
  </div>`;
}

function blockedCard(u) {
  return `<div class="card report"><div class="pair">${person(u.full_name, u.profile_photo, u.id, "Blocked")}</div>
    <div class="facts" style="margin-top:8px"><span>${esc(t("E-mail"))}: ${esc(u.email)}</span><span>${esc(t("Phone"))}: ${esc(u.phone)}</span><span>${esc(t(u.city))}</span></div>
    <div class="row-actions"><button type="button" class="ghost" data-unblock="${esc(u.id)}">${esc(t("Unblock"))}</button></div></div>`;
}

async function load() {
  const list = $("list");
  list.innerHTML = `<div class="empty-state">${esc(t("Loading…"))}</div>`;
  try {
    await counters();
    if (tab === "blocked") {
      const users = await api("/api/admin/blocked");
      list.innerHTML = users.map(blockedCard).join("") || `<div class="empty-state">${esc(t("No blocked users."))}</div>`;
    } else {
      const rows = await api("/api/admin/reports?status=" + tab);
      list.innerHTML = rows.map(reportCard).join("") || `<div class="empty-state">${esc(t("No reports here."))}</div>`;
    }
  } catch (err) { list.innerHTML = ""; showError($("msg"), err); }
}

$("tabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-tab]");
  if (!b) return;
  tab = b.dataset.tab;
  document.querySelectorAll("#tabs button").forEach((x) => x.classList.toggle("on", x === b));
  $("msg").textContent = "";
  load();
});

$("list").addEventListener("click", async (e) => {
  const act = e.target.closest("[data-do]"), unb = e.target.closest("[data-unblock]");
  try {
    if (act) {
      const card = act.closest(".report"), accept = act.dataset.do === "accept";
      if (!confirm(t(accept ? "Block this account? The person will no longer be able to log in, and the reporter will be notified."
                            : "Reject this report? The reporter will be notified."))) return;
      card.querySelectorAll("button").forEach((b) => { b.disabled = true; });
      await api(`/api/admin/reports/${card.dataset.id}/decision`, "POST",
                { decision: act.dataset.do, note: card.querySelector("[data-note]").value });
      showOk($("msg"), "Decision saved. The reporter has been notified.");
      load();
    } else if (unb) {
      if (!confirm(t("Unblock this account?"))) return;
      await api(`/api/admin/users/${unb.dataset.unblock}/unblock`, "POST", {});
      showOk($("msg"), "Account unblocked");
      load();
    }
  } catch (err) { showError($("msg"), err); load(); }
});

/* Only administrators may stay here */
api("/api/me").then((me) => { if (!me.is_admin) location.replace("home.html"); else load(); })
  .catch(() => location.replace("login.html"));
