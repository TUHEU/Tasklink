/* ==========================================================================
   TaskLink - 3D map helpers (OpenStreetMap data, MapLibre GL, OSRM routes)
   Needs an internet connection in the visitor's browser (tiles, search, routing).
   ========================================================================== */
const TLMAP = (() => {
  /* Free, key-less services built on OpenStreetMap data */
  const STYLE = "https://tiles.openfreemap.org/styles/liberty";          // vector tiles incl. 3D buildings
  const LIB_VERSION = "4.7.1";
  const LIB_BASES = [                                                    // second CDN is a backup
    `https://cdn.jsdelivr.net/npm/maplibre-gl@${LIB_VERSION}/dist/`,
    `https://unpkg.com/maplibre-gl@${LIB_VERSION}/dist/`,
  ];
  const ROUTERS = { foot: "routed-foot", bike: "routed-bike", car: "routed-car" };
  const CENTERS = { "Yaoundé": [11.5021, 3.848], "Douala": [9.7679, 4.0511], "Other": [11.5021, 3.848] };

  /* ---- load the MapLibre library (css + js), trying each CDN in turn ---- */
  let libPromise;
  function loadLib() {
    if (window.maplibregl) return Promise.resolve();
    if (libPromise) return libPromise;
    libPromise = (async () => {
      for (const base of LIB_BASES) {
        try {
          await new Promise((ok, bad) => {
            const css = document.createElement("link");
            css.rel = "stylesheet"; css.href = base + "maplibre-gl.css"; document.head.appendChild(css);
            const js = document.createElement("script");
            js.src = base + "maplibre-gl.js"; js.onload = ok; js.onerror = bad; document.head.appendChild(js);
          });
          if (window.maplibregl) return;
        } catch (e) { /* try the next CDN */ }
      }
      libPromise = null;
      throw new Error("Could not load the map. Check your internet connection.");
    })();
    return libPromise;
  }

  /* ---- create a tilted map with 3D buildings ---- */
  async function createMap(el, { center, zoom = 15, pitch = 60, bearing = -17 } = {}) {
    await loadLib();
    const map = new maplibregl.Map({ container: el, style: STYLE, center, zoom, pitch, bearing, maxPitch: 80, hash: false });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    await new Promise((ok, bad) => {
      map.once("load", ok);
      map.once("error", (e) => { if (!map.loaded() && !map.isStyleLoaded()) bad(new Error("Could not load the map. Check your internet connection.")); });
    });
    ensure3DBuildings(map);
    return map;
  }

  /* The style already has extruded buildings; if a different style is used, add them. */
  function ensure3DBuildings(map) {
    const layers = map.getStyle().layers || [];
    if (layers.some((l) => l.type === "fill-extrusion")) return;
    const b = layers.find((l) => l["source-layer"] === "building");
    if (!b) return;
    map.addLayer({
      id: "tl-3d-buildings", type: "fill-extrusion", source: b.source, "source-layer": "building", minzoom: 14,
      paint: {
        "fill-extrusion-color": "#d8dde8",
        "fill-extrusion-height": ["coalesce", ["get", "render_height"], 8],
        "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
        "fill-extrusion-opacity": 0.85,
      },
    });
  }

  /* ---- markers ---- */
  function pin(map, kind, label, lngLat, draggable = false) {
    const el = document.createElement("div");
    el.className = "pin " + kind;
    el.innerHTML = `<span>${label}</span>`;
    return new maplibregl.Marker({ element: el, anchor: "bottom-left", offset: [-19, 8], draggable }).setLngLat(lngLat).addTo(map);
  }

  /* ---- search a place (Nominatim / OpenStreetMap), limited to Cameroon ---- */
  async function search(q) {
    const url = "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=cm&accept-language="
      + lang + "&q=" + encodeURIComponent(q);
    const res = await fetch(url).catch(() => null);
    if (!res || !res.ok) throw new Error("Could not load the map. Check your internet connection.");
    return (await res.json()).map((r) => ({ lat: +r.lat, lng: +r.lon, name: r.display_name }));
  }
  async function reverse(lat, lng) {
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&accept-language=${lang}&lat=${lat}&lon=${lng}`);
      const j = await res.json();
      return (j.display_name || "").split(",").slice(0, 3).join(",").trim();
    } catch (e) { return ""; }
  }

  /* ---- routing (OSRM on OpenStreetMap data) ---- */
  const DIRS = {
    fr: { left: "à gauche", right: "à droite", "slight left": "légèrement à gauche", "slight right": "légèrement à droite",
          "sharp left": "franchement à gauche", "sharp right": "franchement à droite", straight: "tout droit", uturn: "demi-tour" },
    en: { left: "left", right: "right", "slight left": "slightly left", "slight right": "slightly right",
          "sharp left": "sharp left", "sharp right": "sharp right", straight: "straight on", uturn: "make a U-turn" },
  };
  function instruction(step) {
    const m = step.maneuver || {}, name = step.name || "", fr = lang === "fr";
    const dir = (DIRS[lang] || DIRS.en)[m.modifier] || "";
    const on = name ? (fr ? ` sur ${name}` : ` onto ${name}`) : "";
    switch (m.type) {
      case "depart": return (fr ? "Pars" : "Start") + (name ? (fr ? ` sur ${name}` : ` on ${name}`) : "");
      case "arrive": return fr ? "Tu es arrivé" : "You have arrived";
      case "roundabout": case "rotary": case "roundabout turn":
        return fr ? `Au rond-point, prends la ${m.exit || 1}e sortie${on}` : `At the roundabout take exit ${m.exit || 1}${on}`;
      case "continue": case "new name":
        return (fr ? "Continue" : "Continue") + (dir ? " " + dir : "") + on;
      default:
        return dir ? (m.modifier === "straight" ? (fr ? "Va tout droit" : "Go straight") : (fr ? "Tourne " : "Turn ") + dir) + on
                   : (fr ? "Continue" : "Continue") + on;
    }
  }

  async function route(mode, from, to) {
    const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
    const q = "?overview=full&geometries=geojson&steps=true";
    const urls = [`https://routing.openstreetmap.de/${ROUTERS[mode]}/route/v1/driving/${coords}${q}`];
    if (mode === "car") urls.push(`https://router.project-osrm.org/route/v1/driving/${coords}${q}`);   // backup, car only
    for (const url of urls) {
      try {
        const res = await fetch(url);
        const j = await res.json();
        if (j.code === "Ok" && j.routes && j.routes[0]) {
          const r = j.routes[0];
          return {
            distance: r.distance, duration: r.duration, coords: r.geometry.coordinates,
            steps: r.legs.flatMap((l) => l.steps).map((s) => ({ text: instruction(s), distance: s.distance })),
          };
        }
        if (j.code === "NoRoute") throw new Error("No route found between these two points.");
      } catch (e) { if (e.message.startsWith("No route")) throw e; }
    }
    throw new Error("No route found between these two points.");
  }

  /* ---- little helpers ---- */
  const km = (m) => m < 950 ? Math.round(m / 10) * 10 + " m" : (m / 1000).toFixed(m < 10000 ? 1 : 0) + " km";
  const dur = (s) => { const mn = Math.max(1, Math.round(s / 60)); return mn < 60 ? mn + " min" : Math.floor(mn / 60) + " h " + String(mn % 60).padStart(2, "0"); };

  function dist(a, b) {                                   // metres between two [lng,lat]
    const R = 6371000, rad = Math.PI / 180;
    const dLat = (b[1] - a[1]) * rad, dLng = (b[0] - a[0]) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  const heading = (a, b) => {                              // compass bearing a -> b
    const rad = Math.PI / 180, y = Math.sin((b[0] - a[0]) * rad) * Math.cos(b[1] * rad);
    const x = Math.cos(a[1] * rad) * Math.sin(b[1] * rad) - Math.sin(a[1] * rad) * Math.cos(b[1] * rad) * Math.cos((b[0] - a[0]) * rad);
    return (Math.atan2(y, x) / rad + 360) % 360;
  };
  /* point at `frac` (0..1) of the way along a line, plus a point a bit ahead of it */
  function along(line, cum, frac) {
    const target = cum[cum.length - 1] * frac;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < target) i++;
    const span = cum[i] - cum[i - 1] || 1, k = Math.min(1, Math.max(0, (target - cum[i - 1]) / span));
    const a = line[i - 1], b = line[i];
    return { point: [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k], next: b, prev: a };
  }
  const cumulative = (line) => line.reduce((acc, p, i) => (acc.push(i ? acc[i - 1] + dist(line[i - 1], p) : 0), acc), []);

  /* Draw / update a line on the map */
  function setLine(map, id, coords, color) {
    const data = { type: "Feature", geometry: { type: "LineString", coordinates: coords } };
    if (map.getSource(id)) { map.getSource(id).setData(data); return; }
    map.addSource(id, { type: "geojson", data });
    map.addLayer({ id: id + "-casing", type: "line", source: id, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#fff", "line-width": 9, "line-opacity": .9 } });
    map.addLayer({ id, type: "line", source: id, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": color, "line-width": 5.5 } });
  }
  function clearLine(map, id) {
    if (map.getSource(id)) map.getSource(id).setData({ type: "FeatureCollection", features: [] });
  }

  return { loadLib, createMap, pin, search, reverse, route, km, dur, dist, heading, along, cumulative, setLine, clearLine, CENTERS };
})();
