/* Login and registration forms */
document.getElementById("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = document.getElementById("msg"), btn = e.target.querySelector("button[type=submit]");
  msg.textContent = "";
  btn.disabled = true;
  try {
    const r = await api(e.target.dataset.url, "POST", formData(e.target));
    location.href = r && r.is_admin ? "admin.html" : e.target.dataset.next;     // administrators land on their panel
  } catch (err) {
    showError(msg, err);
    btn.disabled = false;
  }
});

/* Sent back here because an administrator blocked the account */
if (new URLSearchParams(location.search).get("blocked")) {
  document.getElementById("msg").textContent = t("This account has been blocked by an administrator");
}
