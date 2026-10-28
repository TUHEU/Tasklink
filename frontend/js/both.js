/* "Do both" page: services, open missions, post a mission, my missions */
const list = document.getElementById("list");
const mine = document.getElementById("mine");
const addMsg = document.getElementById("addMsg");
const STATUS = { open: "Open", in_progress: "In progress", done: "Done" };
const BADGE = { open: "open", in_progress: "progress", done: "done" };

const serviceCard = (s) => `<div class="card">
  <div class="card-head">
    <a href="provider.html?id=${esc(s.user_id)}" aria-label="${esc(s.provider)}">${avatarHtml(s.provider, s.photo)}</a>
    <div class="who"><b>${esc(s.title)}</b> ${s.kind === "training" ? `<span class="badge">Training</span>` : ""}
      <div class="meta">${esc(s.provider)}${s.rating ? ` · <span class="stars">★</span> ${esc(s.rating)}` : ""}</div></div>
  </div>
  <div class="chips"><span class="chip">${esc(t(s.category))}</span><span class="chip loc">${esc(t(s.city))}</span></div>
  <div class="price-pill">From ${esc(money(s.price))} FCFA</div>
  <a class="link" href="provider.html?id=${esc(s.user_id)}">View profile and call</a></div>`;

const missionCard = (m) => `<div class="card">
  <div class="card-head">
    <a href="provider.html?id=${esc(m.user_id)}" aria-label="${esc(m.author)}">${avatarHtml(m.author, m.author_photo)}</a>
    <div class="who"><b>${esc(m.title)}</b>
      <div class="meta"><a href="provider.html?id=${esc(m.user_id)}">${esc(m.author)}</a> · ${esc(t(m.city))}</div></div>
  </div>
  <div class="price-pill">Budget: ${esc(money(m.budget))} FCFA</div>
  <p>${esc(m.description)}</p>
  <button class="orange" data-apply="${m.id}" ${m.applied ? "disabled" : ""}>${m.applied ? "Applied" : "Apply"}</button></div>`;

const myMissionCard = (m) => `<div class="card">
  <div class="card-head"><div class="who"><b>${esc(m.title)}</b>
    <div class="meta">Budget: ${esc(money(m.budget))} FCFA</div></div>
    <span class="badge ${BADGE[m.status] || ""}">${esc(t(STATUS[m.status] || m.status))}</span></div>
  ${m.status === "open" ? (m.applicants.length
      ? `<div class="meta">Applicants</div>` + m.applicants.map((a) => `<div class="row-actions">
          <a class="link" href="provider.html?id=${a.id}">${esc(a.full_name)}</a>
          <button class="btn-sm" data-accept="${m.id}" data-user="${a.id}">Accept</button></div>`).join("")
      : `<p class="meta">No applicants yet.</p>`) : ""}
  ${m.status !== "open" && m.worker ? `<p class="meta">Worker: <a class="link" href="provider.html?id=${m.worker_id}">${esc(m.worker)}</a></p>` : ""}
  ${m.status === "in_progress" ? `<button class="green" data-done="${m.id}">Mark as done</button>` : ""}
  ${m.status === "done" && !m.reviewed ? `<button data-review="${m.id}">Rate the worker</button>` : ""}</div>`;

async function load() {
  const q = encodeURIComponent(document.getElementById("q").value);
  try {
    const [items, svc] = await Promise.all([api(`/api/missions?q=${q}`), api(`/api/services?q=${q}&category=`)]);
    document.getElementById("svc").innerHTML = svc.map(serviceCard).join("")
      || `<div class="empty-state">No services found.</div>`;
    list.innerHTML = items.map(missionCard).join("")
      || `<div class="empty-state">No open missions yet. Post the first one below.</div>`;
  } catch (err) {
    list.innerHTML = `<p class="msg">${esc(t(err.message))}</p>`;
  }
  loadMine();
}

async function loadMine() {
  try {
    const items = await api("/api/my-missions");
    mine.innerHTML = items.map(myMissionCard).join("")
      || `<div class="empty-state">You have not posted any mission yet.</div>`;
  } catch (err) {
    mine.innerHTML = `<p class="msg">${esc(t(err.message))}</p>`;
  }
}

document.addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const d = btn.dataset;
  try {
    if (d.apply) await api(`/api/missions/${d.apply}/apply`, "POST");
    else if (d.accept) await api(`/api/missions/${d.accept}/accept`, "POST", { user_id: Number(d.user) });
    else if (d.done) await api(`/api/missions/${d.done}/complete`, "POST");
    else if (d.review) {
      const rating = Number(prompt(t("Rating from 1 to 5")));
      if (!rating) return;
      await api(`/api/missions/${d.review}/review`, "POST", { rating, comment: prompt(t("Comment (optional)")) || "" });
    } else return;
    load();
  } catch (err) { alert(t(err.message)); }
});

document.getElementById("searchForm").addEventListener("submit", (e) => { e.preventDefault(); load(); });
document.getElementById("add").addEventListener("submit", async (e) => {
  e.preventDefault();
  addMsg.textContent = "";
  try {
    await api("/api/missions", "POST", formData(e.target));
    e.target.reset();
    showOk(addMsg, "Mission posted!");
    load();
  } catch (err) { showError(addMsg, err); }
});
load();
