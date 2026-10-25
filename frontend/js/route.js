/* Route page: you and another person on a 3D OpenStreetMap, with walking / bike / car directions.
   Optional meeting point: tap the map, drag the pin, or use "Meet halfway". */
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const withId = params.get("with");

const state = { me: null, them: null, themName: "", meet: null, meetLabel: "", mode: "foot", tilted: true, token: 0 };
const themName = () => (state.them && state.them.full_name) || state.themName || "";
const target = () => state.meet || state.them;                  // the place we are heading to
let map, pins = {}, legs = [], flying = false, raf = 0;

const problem = (html) => { $("problem").hidden = false; $("problem").innerHTML = html; };

async function init() {
  if (!/^\d+$/.test(withId || "")) return location.replace("message.html");
  $("chatLink").href = "message.html?to=" + withId;
  const [me, them] = await Promise.all([api("/api/me"), api("/api/location/" + withId).catch((e) => e)]);
  const user = await api("/api/users/" + withId).catch(() => null);
  if (user) {
    $("title").textContent = user.full_name;
    $("sub").textContent = t("Meet on the map");
    $("who").style.display = ""; renderAvatar($("who"), user);
  }
  const m = (params.get("meet") || "").split(",").map(Number);
  if (m.length === 2 && m.every(Number.isFinite) && Math.abs(m[0]) <= 90 && Math.abs(m[1]) <= 180) state.meet = { lat: m[0], lng: m[1] };

  /* No shared place from them is fine when a meeting point came with the link: we still show the way to it. */
  if (them instanceof Error && !state.meet) {
    return problem(`<p style="margin:0"><b>${esc(t(them.message))}</b></p>
      <div class="row-actions"><a class="big" href="message.html?to=${esc(withId)}">${esc(t("Message"))}</a></div>`);
  }
  state.me = me.lat != null ? { lat: me.lat, lng: me.lng, id: me.id, name: me.full_name, saved: true } : { id: me.id, name: me.full_name };
  state.them = them instanceof Error ? null : them;
  state.themName = user ? user.full_name : "";

  $("app").hidden = false;
  try {
    const c = target();
    map = await TLMAP.createMap($("map"), { center: [c.lng, c.lat], zoom: 14.5 });
  } catch (e) { $("mapStatus").textContent = t(e.message); return; }
  $("mapStatus").hidden = true;
  map.on("click", (e) => setMeet(e.lngLat.lat, e.lngLat.lng));
  await draw();
  if (state.me.lat == null) useGps(true);        // no saved place: draw the way from where you are right now
}

/* ---------- pins ---------- */
function updatePins() {
  const put = (key, kind, label, p, drag) => {
    if (!p) { if (pins[key]) { pins[key].remove(); delete pins[key]; } return; }
    if (!pins[key]) {
      pins[key] = TLMAP.pin(map, kind, label, [p.lng, p.lat], drag);
      if (drag) pins[key].on("dragend", () => { const q = pins[key].getLngLat(); setMeet(q.lat, q.lng); });
    } else pins[key].setLngLat([p.lng, p.lat]);
  };
  put("me", "me", esc(initials(state.me.name)), state.me.lat != null ? state.me : null, false);
  put("them", "them", esc(initials(themName())), state.them, false);
  put("meet", "meet", "⚑", state.meet, true);
}

/* ---------- meeting point ---------- */
function setMeet(lat, lng) {
  state.meet = { lat, lng };
  state.meetLabel = "";
  TLMAP.reverse(lat, lng).then((n) => { if (state.meet && state.meet.lat === lat) state.meetLabel = n; });
  draw();
}
$("clearMeet").onclick = () => { state.meet = null; state.meetLabel = ""; draw(); };

$("half").onclick = () => {
  if (!state.them) return;
  if (state.me.lat == null) return showError($("msg"), new Error("Could not get your position"));
  const line = legs[0] && !state.meet ? legs[0].coords : null;      // halfway along the real path when we have it
  if (line) {
    const cum = TLMAP.cumulative(line), p = TLMAP.along(line, cum, 0.5).point;
    setMeet(p[1], p[0]);
  } else setMeet((state.me.lat + state.them.lat) / 2, (state.me.lng + state.them.lng) / 2);
};

$("share").onclick = async () => {
  if (!state.meet) return;
  const btn = $("share");
  btn.disabled = true;
  try {
    if (!state.meetLabel) state.meetLabel = await TLMAP.reverse(state.meet.lat, state.meet.lng);
    const link = `${location.origin}/route.html?with=${state.me.id}&meet=${state.meet.lat.toFixed(5)},${state.meet.lng.toFixed(5)}`;
    await api("/api/chat/" + withId, "POST", { content: `📍 ${t("Meeting point")}${state.meetLabel ? ": " + state.meetLabel : ""}\n${link}` });
    showOk($("msg"), "Meeting point sent");
  } catch (err) { showError($("msg"), err); }
  btn.disabled = false;
};

/* ---------- routes ---------- */
async function draw() {
  stopFly();
  const token = ++state.token, { me, them, meet, mode } = state;
  updatePins();
  $("share").hidden = !meet;
  $("clearMeet").hidden = !meet || !them;          // without a shared place of theirs, the meeting point is all there is
  $("half").hidden = !!meet || !them;
  updateGmaps();
  $("hint").textContent = t("Tap the map to choose a meeting point.");

  const myPoint = me.lat != null ? me : null;
  const jobs = !myPoint ? []
    : meet ? [{ from: myPoint, to: meet, title: `${t("You")} → ${t("Meeting point")}`, color: "#315efb", cls: "" },
              ...(them ? [{ from: them, to: meet, title: `${themName()} → ${t("Meeting point")}`, color: "#e88a35", cls: "them" }] : [])]
           : [{ from: myPoint, to: them, title: `${t("You")} → ${themName()}`, color: "#315efb", cls: "" }];

  if (!myPoint) {
    legs = []; TLMAP.clearLine(map, "route-a"); TLMAP.clearLine(map, "route-b");
    $("legs").innerHTML = `<div class="card"><b>${esc(t("Set your place so people can plan a route to you."))}</b>
      <div class="row-actions"><a class="big" href="place.html">${esc(t("My meeting place"))}</a></div></div>`;
    const c = target();
    map.flyTo({ center: [c.lng, c.lat], zoom: 15.5, pitch: state.tilted ? 60 : 0 });
    return;
  }

  $("legs").innerHTML = `<div class="empty-state">${esc(t("Loading…"))}</div>`;
  let results;
  try { results = await Promise.all(jobs.map((j) => TLMAP.route(mode, j.from, j.to))); }
  catch (err) {
    if (token !== state.token) return;
    legs = []; TLMAP.clearLine(map, "route-a"); TLMAP.clearLine(map, "route-b");
    $("legs").innerHTML = `<div class="card"><p class="msg" style="margin:0">${esc(t(err.message))}</p></div>`;
    return;
  }
  if (token !== state.token) return;             // a newer request replaced this one
  legs = results;

  TLMAP.setLine(map, "route-a", results[0].coords, jobs[0].color);
  if (results[1]) TLMAP.setLine(map, "route-b", results[1].coords, jobs[1].color); else TLMAP.clearLine(map, "route-b");

  $("legs").innerHTML = results.map((r, i) => `<div class="card leg ${jobs[i].cls}">
      <h3>${esc(jobs[i].title)}</h3>
      <div class="figs">${esc(TLMAP.km(r.distance))} · ${esc(TLMAP.dur(r.duration))}</div>
      <details><summary>${esc(t("Directions"))}</summary><ol>${r.steps.map((s) =>
        `<li>${esc(s.text)} <small>${s.distance > 0 ? "· " + esc(TLMAP.km(s.distance)) : ""}</small></li>`).join("")}</ol></details></div>`).join("");

  fitAll(results);
}

function fitAll(results) {
  const b = new maplibregl.LngLatBounds();
  (results || legs).forEach((r) => r.coords.forEach((c) => b.extend(c)));
  if (!b.isEmpty()) map.fitBounds(b, { padding: { top: 70, bottom: 60, left: 50, right: 50 }, maxZoom: 17, pitch: state.tilted ? 55 : 0, bearing: state.tilted ? -17 : 0, duration: 1200 });
}

/* ---------- controls ---------- */
$("modes").addEventListener("click", (e) => {
  const b = e.target.closest("[data-mode]");
  if (!b || b.dataset.mode === state.mode) return;
  state.mode = b.dataset.mode;
  document.querySelectorAll("#modes button").forEach((x) => x.classList.toggle("on", x === b));
  if (map) draw();
});

$("tilt").onclick = () => {
  state.tilted = !state.tilted;
  $("tilt").classList.toggle("on", state.tilted);
  if (map) map.easeTo({ pitch: state.tilted ? 60 : 0, bearing: state.tilted ? -17 : 0, duration: 700 });
};

function useGps(silent) {
  const fail = () => { if (!silent) showError($("msg"), new Error("Could not get your position")); };
  if (!navigator.geolocation) return fail();
  navigator.geolocation.getCurrentPosition(
    (p) => {                                              // used for this visit only, never sent to the server
      state.me = { ...state.me, lat: p.coords.latitude, lng: p.coords.longitude };
      $("msg").textContent = "";
      if (map) draw();
    },
    fail,
    { enableHighAccuracy: true, timeout: 12000 });
}
$("gps").onclick = () => useGps(false);

/* "Open in Google Maps": turn-by-turn navigation on the phone, from where you are, to the place we are heading to. */
function updateGmaps() {
  const to = target(), a = $("gmaps");
  if (!to) { a.hidden = true; return; }
  const mode = { foot: "walking", bike: "bicycling", car: "driving" }[state.mode];
  const from = state.me && state.me.lat != null ? `&origin=${state.me.lat},${state.me.lng}` : "";
  a.href = `https://www.google.com/maps/dir/?api=1${from}&destination=${to.lat},${to.lng}&travelmode=${mode}`;
  a.hidden = false;
}

/* ---------- 3D fly-through of the first route ---------- */
function stopFly(done) {
  if (!flying) return;
  flying = false; cancelAnimationFrame(raf);
  $("fly").classList.remove("on"); $("fly").textContent = t("Fly along the route");
  if (done || map) fitAll();
}
$("fly").onclick = () => {
  if (flying) return stopFly();
  if (!legs[0]) return;
  const line = legs[0].coords, cum = TLMAP.cumulative(line), total = cum[cum.length - 1];
  const duration = Math.min(40000, Math.max(8000, total * 7));
  flying = true; $("fly").classList.add("on"); $("fly").textContent = t("Stop");
  state.tilted = true; $("tilt").classList.add("on");
  let bearing = map.getBearing();
  const t0 = performance.now();
  const frame = (now) => {
    if (!flying) return;
    const f = Math.min(1, (now - t0) / duration);
    const here = TLMAP.along(line, cum, f).point;
    const ahead = TLMAP.along(line, cum, Math.min(1, f + 0.03)).point;
    if (TLMAP.dist(here, ahead) > 2) {                     // turn the camera gently towards where the road goes
      const target = TLMAP.heading(here, ahead);
      let diff = ((target - bearing + 540) % 360) - 180;
      bearing += diff * 0.06;
    }
    map.jumpTo({ center: here, bearing, pitch: 68, zoom: 17 });
    if (f < 1) raf = requestAnimationFrame(frame); else stopFly(true);
  };
  raf = requestAnimationFrame(frame);
};

init().catch((err) => problem(`<p class="msg" style="margin:0">${esc(t(err.message))}</p>`));
