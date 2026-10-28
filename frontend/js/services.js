/* Services page: smart search + offer a service */
const list = document.getElementById("list");
const addMsg = document.getElementById("addMsg");

const serviceCard = (s) => `<div class="card">
  <div class="card-head">
    <a href="provider.html?id=${esc(s.user_id)}" aria-label="${esc(s.provider)}">${avatarHtml(s.provider, s.photo)}</a>
    <div class="who"><b>${esc(s.title)}</b> ${s.kind === "training" ? `<span class="badge">Training</span>` : ""}
      <div class="meta">${esc(s.provider)}${s.rating ? ` · <span class="stars">★</span> ${esc(s.rating)}` : ""}</div></div>
  </div>
  <div class="chips"><span class="chip">${esc(t(s.category))}</span><span class="chip loc">${esc(t(s.city))}</span></div>
  <div class="price-pill">From ${esc(money(s.price))} FCFA</div>
  <p>${esc(s.description)}</p>
  <a class="link" href="provider.html?id=${esc(s.user_id)}">View profile and call</a></div>`;

async function load() {
  const q = encodeURIComponent(document.getElementById("q").value);
  const c = encodeURIComponent(document.getElementById("category").value);
  try {
    const items = await api(`/api/services?q=${q}&category=${c}`);
    list.innerHTML = items.map(serviceCard).join("")
      || `<div class="empty-state">No services found. Add the first one below.</div>`;
  } catch (err) {
    list.innerHTML = `<p class="msg">${esc(t(err.message))}</p>`;
  }
}

document.getElementById("q").value = new URLSearchParams(location.search).get("q") || "";
document.getElementById("searchForm").addEventListener("submit", (e) => { e.preventDefault(); load(); });
document.getElementById("category").addEventListener("change", load);
document.getElementById("add").addEventListener("submit", async (e) => {
  e.preventDefault();
  addMsg.textContent = "";
  try {
    await api("/api/services", "POST", formData(e.target));
    e.target.reset();
    showOk(addMsg, "Service added!");
    load();
  } catch (err) { showError(addMsg, err); }
});
load();
