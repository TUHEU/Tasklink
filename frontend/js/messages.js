/* Chat: conversation list (message.html) and a live thread (message.html?to=ID).
   New messages arrive by asking the server every few seconds while the page is open. */
const $ = (id) => document.getElementById(id);
const to = new URLSearchParams(location.search).get("to");
const POLL_MS = 3000;

const dayKey = (s) => new Date(String(s).replace(" ", "T") + "Z").toDateString();
const clock = (s) => { const d = new Date(String(s).replace(" ", "T") + "Z"); return isNaN(d) ? "" : d.toLocaleTimeString(lang === "fr" ? "fr-FR" : "en-GB", { hour: "2-digit", minute: "2-digit" }); };
const dayLabel = (s) => { const d = new Date(String(s).replace(" ", "T") + "Z"); return isNaN(d) ? "" : d.toLocaleDateString(lang === "fr" ? "fr-FR" : "en-GB", { weekday: "long", day: "numeric", month: "long" }); };
const shortWhen = (s) => {
  const d = new Date(String(s).replace(" ", "T") + "Z");
  if (isNaN(d)) return "";
  return d.toDateString() === new Date().toDateString() ? clock(s)
    : d.toLocaleDateString(lang === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "short" });
};

/* Same-site links (like a meeting point) become clickable; everything else stays plain text. */
function linkify(text) {
  return esc(text).replace(/https?:\/\/[^\s<]+/g, (u) => {
    try {
      const url = new URL(u.replace(/&amp;/g, "&"));
      if (url.origin === location.origin) {
        const label = url.pathname.endsWith("/route.html") ? t("Meet · 3D map") + " →" : url.pathname + url.search;
        return `<a href="${esc(url.pathname + url.search)}">${esc(label)}</a>`;
      }
    } catch (e) {}
    return u;
  });
}

/* ---------------- conversation list ---------------- */
function preview(c) {
  const text = (c.last || "").split("\n")[0];
  const what = c.last_kind === "image" ? "📷 " + t("Photo") : c.last_kind === "pdf" ? "📄 " + (c.last_name || "PDF") : "";
  return what && text ? what + " · " + text : what || text;
}
async function showList() {
  $("listView").hidden = false;
  const list = $("list");
  try {
    const items = await api("/api/chat/conversations");
    list.innerHTML = items.map((c) => `<a class="card convo ${c.unread ? "unread" : ""}" href="message.html?to=${esc(c.user.id)}">
        ${avatarHtml(c.user.full_name, c.user.profile_photo)}
        <div class="who"><b>${esc(c.user.full_name)}</b><span class="last">${c.mine ? esc(t("You:")) + " " : ""}${esc(preview(c))}</span></div>
        <span class="when">${esc(shortWhen(c.created))}</span>
        ${c.unread ? `<span class="dot">${esc(c.unread)}</span>` : ""}</a>`).join("")
      || `<div class="empty-state">No conversations yet. Open a profile and tap Message.</div>`;
  } catch (err) { list.innerHTML = `<p class="msg">${esc(t(err.message))}</p>`; }
}

$("findForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const { id } = await api("/api/chat/find", "POST", { email: e.target.email.value });
    location.href = "message.html?to=" + id;
  } catch (err) { showError($("findMsg"), err); }
});

/* ---------------- one conversation ---------------- */
let lastId = 0, lastDay = "", timer = null, busy = false;
const log = $("log");

/* A picture (tap to enlarge) or a PDF card with Open / Download. Written on one line: bubbles keep line breaks. */
function attachmentHtml(a) {
  if (!a) return "";
  const url = "/api/chat/file/" + encodeURIComponent(a.file);
  if (a.kind === "image") {
    return `<button type="button" class="pic" data-img="${esc(url)}" aria-label="${esc(a.name)}"><img loading="lazy" src="${esc(url)}" alt="${esc(a.name)}"></button>`;
  }
  return `<div class="doc"><span class="pdf-ico">PDF</span><span class="nm">${esc(a.name)}<small>${esc(fileSize(a.size))}</small></span></div>`
    + `<div class="doc-links"><a href="${esc(url)}" target="_blank" rel="noopener">${esc(t("Open"))}</a><a href="${esc(url)}?download=1">${esc(t("Download"))}</a></div>`;
}

function addMessages(msgs) {
  const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 120;
  let html = "";
  for (const m of msgs) {
    const day = dayKey(m.created);
    if (day !== lastDay) { lastDay = day; html += `<div class="day-sep">${esc(dayLabel(m.created))}</div>`; }
    html += `<div class="msg-b ${m.mine ? "mine" : ""} ${m.attachment ? "has-file" : ""}">${attachmentHtml(m.attachment)}`
      + `${m.content ? (m.attachment ? `<span class="txt">${linkify(m.content)}</span>` : linkify(m.content)) : ""}<time>${esc(clock(m.created))}</time></div>`;
    lastId = Math.max(lastId, m.id);
  }
  if (!html) return;
  log.querySelector(".empty-state")?.remove();
  log.insertAdjacentHTML("beforeend", html);
  if (nearBottom || msgs.some((m) => m.mine)) log.scrollTop = log.scrollHeight;
}

async function poll(first) {
  if (busy) return;
  busy = true;
  try {
    const data = await api(`/api/chat/${encodeURIComponent(to)}?after=${lastId}`);
    if (first) {
      $("peerName").textContent = data.user.full_name;
      $("peerCity").textContent = t(data.user.city);
      renderAvatar($("peerAvatar"), data.user);
      $("peerAvatar").className = "avatar avatar-sm";
      $("peerAvatar").style.background = colorFor(data.user.full_name);
      $("peerAvatar").href = "provider.html?id=" + encodeURIComponent(data.user.id);
      if (!data.messages.length) log.innerHTML = `<div class="empty-state" style="margin:auto">${esc(t("Say hello 👋"))}</div>`;
    }
    addMessages(data.messages);
    if (window.refreshUnread && (first || data.messages.some((m) => !m.mine))) window.refreshUnread();   // update the red dot
    if (first) log.scrollTop = log.scrollHeight;
    $("msg").textContent = "";
  } catch (err) {
    if (first) { $("msg").textContent = t(err.message); stop(); }
  }
  busy = false;
}
function start() { stop(); timer = setInterval(() => { if (!document.hidden) poll(false); }, POLL_MS); }
function stop() { clearInterval(timer); }
document.addEventListener("visibilitychange", () => { if (!document.hidden && to) poll(false); });

/* ---- attachments: one picture (JPG / PNG / WEBP, 10 MB) or one PDF (20 MB) per message ---- */
const MAX_IMAGE = 10 * 1024 * 1024, MAX_PDF = 20 * 1024 * 1024;
let pending = null, pendingUrl = "";
const isPdfFile = (f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);

/* Big phone photos are reduced before sending (faster on mobile data); small ones stay untouched. */
const shrink = (file) => new Promise((resolve) => {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 1.5 * 1024 * 1024) return resolve(file);
  const img = new Image(), url = URL.createObjectURL(file);
  img.onload = () => {
    const k = Math.min(1, 1800 / Math.max(img.width, img.height)), c = document.createElement("canvas");
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
    c.toBlob((b) => { URL.revokeObjectURL(url); resolve(b ? new File([b], "photo.jpg", { type: "image/jpeg" }) : file); }, "image/jpeg", 0.85);
  };
  img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
  img.src = url;
});

function setPending(file) {
  if (pendingUrl) { URL.revokeObjectURL(pendingUrl); pendingUrl = ""; }
  pending = file;
  const chip = $("fileChip");
  if (!file) { chip.hidden = true; chip.innerHTML = ""; return; }
  const isPdf = isPdfFile(file);
  if (!isPdf) pendingUrl = URL.createObjectURL(file);
  chip.innerHTML = (isPdf ? `<span class="pdf-ico">PDF</span>` : `<img src="${pendingUrl}" alt="">`)
    + `<span class="nm">${esc(file.name)}<small>${esc(fileSize(file.size))}</small></span>`
    + `<button type="button" id="chipX" aria-label="${esc(t("Remove"))}">×</button>`;
  chip.hidden = false;
  $("chipX").onclick = () => setPending(null);
}

function pickFile(file) {
  $("msg").textContent = "";
  if (!file) return;
  const isPdf = isPdfFile(file);
  const isImg = /^image\/(jpeg|png|webp)$/.test(file.type);
  if (!isPdf && !isImg) return showError($("msg"), new Error("This file type is not allowed"));
  if (isPdf && file.size > MAX_PDF) return showError($("msg"), new Error("PDF files must be smaller than 20 MB"));
  if (isImg && file.size > 40 * 1024 * 1024) return showError($("msg"), new Error("Pictures must be smaller than 10 MB"));
  setPending(file);
}

function showThread() {
  $("threadView").hidden = false;
  $("meetLink").href = "route.html?with=" + encodeURIComponent(to);
  const box = $("composer").content;
  const grow = () => { box.style.height = "auto"; box.style.height = Math.min(box.scrollHeight, 120) + "px"; };
  box.addEventListener("input", grow);
  box.addEventListener("keydown", (e) => {                 // Enter sends, Shift+Enter = new line
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("composer").requestSubmit(); }
  });

  $("attachBtn").onclick = () => $("fileInput").click();
  $("fileInput").addEventListener("change", () => { pickFile($("fileInput").files[0]); $("fileInput").value = ""; });
  box.addEventListener("paste", (e) => {                   // paste a screenshot straight into the chat
    const f = [...(e.clipboardData?.files || [])][0];
    if (f) { e.preventDefault(); pickFile(f); }
  });

  const viewDlg = $("viewDlg");
  log.addEventListener("click", (e) => {
    const b = e.target.closest("[data-img]");
    if (!b) return;
    $("viewBody").innerHTML = `<img src="${esc(b.dataset.img)}" alt="">`;
    viewDlg.showModal();
  });
  $("viewClose").onclick = () => viewDlg.close();
  viewDlg.addEventListener("click", (e) => { if (e.target === viewDlg) viewDlg.close(); });
  viewDlg.addEventListener("close", () => { $("viewBody").innerHTML = ""; });

  $("composer").addEventListener("submit", async (e) => {
    e.preventDefault();
    const content = box.value.trim();
    if (!content && !pending) return;
    $("sendBtn").disabled = true; $("attachBtn").disabled = true;
    try {
      if (pending) {
        const file = isPdfFile(pending) ? pending : await shrink(pending);
        if (!isPdfFile(file) && file.size > MAX_IMAGE) throw new Error("Pictures must be smaller than 10 MB");
        const fd = new FormData();
        fd.append("file", file, file.name);
        fd.append("content", content);
        await postForm("/api/chat/" + encodeURIComponent(to) + "/attachment", fd);
        setPending(null);
      } else {
        await api("/api/chat/" + encodeURIComponent(to), "POST", { content });
      }
      box.value = ""; grow();
      await poll(false);
      $("msg").textContent = "";
    } catch (err) { showError($("msg"), err); }
    $("sendBtn").disabled = false; $("attachBtn").disabled = false;
    box.focus();
  });
  poll(true).then(start);
}

if (to && /^\d+$/.test(to)) showThread(); else showList();
