/* "My meeting place": pick a spot on the 3D map (search, tap, or GPS) and choose whether to share it */
const $ = (id) => document.getElementById(id);
let map, marker, picked = null, tilted = true;
const way = { mode: "foot", origin: null, on: false, token: 0 };   // the path from your position to the pin

const setPick = (lat, lng, { fly = false, label } = {}) => {
  picked = { lat, lng };
  if (!marker) {
    marker = TLMAP.pin(map, "meet", "📍", [lng, lat], true);
    marker.on("dragend", async () => { const p = marker.getLngLat(); await setPick(p.lat, p.lng, { label: true }); });
  } else marker.setLngLat([lng, lat]);
  if (fly) map.flyTo({ center: [lng, lat], zoom: 16.5, pitch: tilted ? 60 : 0, speed: 1.2 });
  $("pathCard").hidden = false;
  updateGmaps();
  if (way.on) { clearTimeout(way.timer); way.timer = setTimeout(drawPath, 350); }   // follow the pin while it moves
  if (label) TLMAP.reverse(lat, lng).then((name) => { if (name && !$("form").label.dataset.touched) $("form").label.value = name; });
};

async function init() {
  const me = await api("/api/me");
  const start = me.lat != null ? [me.lng, me.lat] : TLMAP.CENTERS[me.city] || TLMAP.CENTERS.Other;
  try {
    map = await TLMAP.createMap($("map"), { center: start, zoom: me.lat != null ? 16 : 13 });
  } catch (e) { $("mapStatus").textContent = t(e.message); return; }
  $("mapStatus").hidden = true;

  const f = $("form");
  if (me.lat != null) {
    setPick(me.lat, me.lng);
    f.label.value = me.location_label || "";
    f.share.checked = !!me.share_location;
    $("remove").hidden = false;
  }
  f.label.addEventListener("input", () => { f.label.dataset.touched = "1"; });
  map.on("click", (e) => { setPick(e.lngLat.lat, e.lngLat.lng, { label: true }); });
}

$("tilt").onclick = () => {
  tilted = !tilted;
  $("tilt").classList.toggle("on", tilted);
  if (map) map.easeTo({ pitch: tilted ? 60 : 0, bearing: tilted ? -17 : 0, duration: 700 });
};

$("gps").onclick = () => {
  if (!navigator.geolocation) return showError($("msg"), new Error("Could not get your position"));
  navigator.geolocation.getCurrentPosition(
    (p) => { if (map) { setPick(p.coords.latitude, p.coords.longitude, { fly: true, label: true }); $("msg").textContent = ""; } },
    () => showError($("msg"), new Error("Could not get your position")),
    { enableHighAccuracy: true, timeout: 12000 });
};

$("searchForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = $("q").value.trim(), box = $("results");
  if (!q) return;
  box.hidden = false;
  box.innerHTML = `<li class="meta" style="padding:10px 14px">${esc(t("Loading…"))}</li>`;
  try {
    const found = await TLMAP.search(q);
    box.innerHTML = found.length
      ? found.map((r, i) => `<li><button type="button" data-i="${i}">${esc(r.name)}</button></li>`).join("")
      : `<li class="meta" style="padding:10px 14px">${esc(t("No place found"))}</li>`;
    box.onclick = (ev) => {
      const b = ev.target.closest("[data-i]");
      if (!b || !map) return;
      const r = found[b.dataset.i];
      $("form").label.value = r.name.split(",").slice(0, 3).join(",").trim();
      $("form").label.dataset.touched = "1";
      setPick(r.lat, r.lng, { fly: true });
      box.hidden = true;
    };
  } catch (err) { box.innerHTML = `<li class="msg" style="padding:10px 14px">${esc(t(err.message))}</li>`; }
});

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("msg"), btn = $("save");
  msg.textContent = "";
  if (!picked) return showError(msg, new Error("Choose a place on the map"));
  btn.disabled = true;
  try {
    await api("/api/me/location", "PUT", { ...picked, label: e.target.label.value, share: e.target.share.checked });
    $("remove").hidden = false;
    showOk(msg, "Place saved");
  } catch (err) { showError(msg, err); }
  btn.disabled = false;
});

$("remove").onclick = async () => {
  try {
    await api("/api/me/location", "PUT", { clear: true });
    if (marker) { marker.remove(); marker = null; }
    picked = null; $("form").reset(); $("remove").hidden = true;
    way.on = false; way.token++; $("pathCard").hidden = true; $("legs").innerHTML = "";
    if (way.pin) { way.pin.remove(); way.pin = null; }
    TLMAP.clearLine(map, "route-a");
    showOk($("msg"), "Place removed");
  } catch (err) { showError($("msg"), err); }
};

init().catch((err) => showError($("msg"), err));


/* ---------------- path from where you are to the place you set ---------------- */
function updateGmaps() {
  if (!picked) return;
  const mode = { foot: "walking", bike: "bicycling", car: "driving" }[way.mode];
  const from = way.origin ? `&origin=${way.origin.lat},${way.origin.lng}` : "";
  $("gmaps").href = `https://www.google.com/maps/dir/?api=1${from}&destination=${picked.lat},${picked.lng}&travelmode=${mode}`;
}

function getOrigin() {                                     // your position is only used in this browser, never saved
  return new Promise((ok, bad) => {
    if (!navigator.geolocation) return bad(new Error("Could not get your position"));
    navigator.geolocation.getCurrentPosition(
      (p) => ok({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => bad(new Error("Could not get your position")),
      { enableHighAccuracy: true, timeout: 12000 });
  });
}

async function drawPath() {
  if (!picked || !map) return showError($("pathMsg"), new Error("Choose a place on the map"));
  const token = ++way.token, legs = $("legs");
  $("pathMsg").textContent = "";
  $("pathBtn").disabled = true;
  try {
    if (!way.origin) {
      legs.innerHTML = `<div class="empty-state">${esc(t("Getting your position…"))}</div>`;
      way.origin = await getOrigin();
    }
    way.on = true;
    updateGmaps();
    legs.innerHTML = `<div class="empty-state">${esc(t("Loading…"))}</div>`;
    const r = await TLMAP.route(way.mode, way.origin, picked);
    if (token !== way.token) return;                       // a newer request replaced this one
    if (!way.pin) way.pin = TLMAP.pin(map, "me", esc(t("You")), [way.origin.lng, way.origin.lat], false);
    else way.pin.setLngLat([way.origin.lng, way.origin.lat]);
    TLMAP.setLine(map, "route-a", r.coords, "#315efb");
    legs.innerHTML = `<div class="card leg" style="margin:10px 0 0">
        <h3>${esc(t("Your position"))} → ${esc($("form").label.value || t("Place"))}</h3>
        <div class="figs">${esc(TLMAP.km(r.distance))} · ${esc(TLMAP.dur(r.duration))}</div>
        <details open><summary>${esc(t("Directions"))}</summary><ol>${r.steps.map((s) =>
          `<li>${esc(s.text)} <small>${s.distance > 0 ? "· " + esc(TLMAP.km(s.distance)) : ""}</small></li>`).join("")}</ol></details></div>`;
    const b = new maplibregl.LngLatBounds();
    r.coords.forEach((c) => b.extend(c));
    map.fitBounds(b, { padding: { top: 70, bottom: 60, left: 50, right: 50 }, maxZoom: 17, pitch: tilted ? 55 : 0, bearing: tilted ? -17 : 0, duration: 1200 });
  } catch (err) {
    if (token !== way.token) return;
    legs.innerHTML = "";
    way.on = false;
    showError($("pathMsg"), err);
  }
  $("pathBtn").disabled = false;
}

$("pathBtn").onclick = () => { way.origin = null; drawPath(); };   // ask for a fresh position each time you press it
$("modes").addEventListener("click", (e) => {
  const b = e.target.closest("[data-mode]");
  if (!b || b.dataset.mode === way.mode) return;
  way.mode = b.dataset.mode;
  document.querySelectorAll("#modes button").forEach((x) => x.classList.toggle("on", x === b));
  updateGmaps();
  if (way.on) drawPath();
});
