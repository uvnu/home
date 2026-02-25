// UV.nu MVP (GitHub Pages, OpenWeather One Call 3.0 + Geocoding)
//
// Docs:
// - One Call API 3.0 (current + hourly includes uvi)  https://openweathermap.org/api/one-call-3
// - Geocoding API (direct geocoding)                  https://openweathermap.org/api/geocoding-api

const API_KEY = "eb45ab32159d3a2bb8369a2dfc5be8bb";

// DOM
const el = {
  locationName: document.getElementById("locationName"),
  updatedAt: document.getElementById("updatedAt"),
  status: document.getElementById("status"),
  error: document.getElementById("error"),
  uvNow: document.getElementById("uvNow"),
  uvLevel: document.getElementById("uvLevel"),
  uvHint: document.getElementById("uvHint"),
  uvMax: document.getElementById("uvMax"),
  uvMaxTime: document.getElementById("uvMaxTime"),
  todaySummary: document.getElementById("todaySummary"),
  todayComment: document.getElementById("todayComment"),
  recList: document.getElementById("recList"),
  forecastStrip: document.getElementById("forecastStrip"),
  cityInput: document.getElementById("cityInput"),
  cityInputMobile: document.getElementById("cityInputMobile"),
  useMyLocationBtn: document.getElementById("useMyLocationBtn"),
};

// Simple storage: last chosen location
const STORAGE_KEY = "uvnu_location_v1"; // { name, lat, lon, country }

// ---------- Helpers ----------
const fmtTime = (unixSeconds, tzOffsetSeconds) => {
  // Use location timezone offset if provided. We don’t need perfect i18n yet.
  const d = new Date((unixSeconds + tzOffsetSeconds) * 1000);
  return d.toISOString().slice(11, 16); // HH:MM
};

const fmtUpdated = () => {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `Uppdaterad ${hh}:${mm}`;
};

const round1 = (n) => Math.round(n * 10) / 10;

function uvBand(uvi) {
  if (uvi < 3) return { label: "Låg", key: "low" };
  if (uvi < 6) return { label: "Måttlig", key: "mod" };
  if (uvi < 8) return { label: "Hög", key: "high" };
  if (uvi < 11) return { label: "Mycket hög", key: "vhigh" };
  return { label: "Extrem", key: "extreme" };
}

function uvHintText(uvi) {
  if (uvi < 3) return "Lugnt. Solskydd oftast inte nödvändigt.";
  if (uvi < 6) return "SPF om du är ute länge.";
  if (uvi < 8) return "SPF 30+, solglasögon, sök skugga.";
  if (uvi < 11) return "Undvik solen mitt på dagen. SPF 50.";
  return "Extra försiktighet. Håll dig i skugga.";
}

function recListFor(uvi) {
  if (uvi < 3) return ["Solglasögon om du vill", "Håll koll om du är extra känslig", "Barn: skydda ändå vid längre utevistelse"];
  if (uvi < 6) return ["SPF 30 vid längre utevistelse", "Solglasögon", "Sök skugga om du är ute mitt på dagen"];
  if (uvi < 8) return ["SPF 30+ och fyll på varannan timme", "Keps/solhatt + solglasögon", "Planera skugga 11–15"];
  if (uvi < 11) return ["SPF 50 och fyll på ofta", "Täckande kläder/solhatt", "Undvik direkt sol 11–15"];
  return ["SPF 50+ och täckande kläder", "Stanna i skugga så mycket som möjligt", "Extra försiktighet med barn"];
}

function todayCommentText(maxUvi) {
  if (maxUvi < 3) return "Låg UV idag.";
  if (maxUvi < 6) return "Måttlig UV. Tänk på solskydd vid längre utevistelse.";
  if (maxUvi < 8) return "Starkast mitt på dagen. Planera skugga 11–15.";
  if (maxUvi < 11) return "Mycket stark UV mitt på dagen. Undvik direkt sol 11–15.";
  return "Extrem UV. Minimera direkt sol mitt på dagen.";
}

function setError(msg) {
  el.error.textContent = msg || "";
}

function setStatus(msg) {
  el.status.textContent = msg || "";
}

// ---------- OpenWeather calls ----------
async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} – ${text.slice(0, 120)}`);
  }
  return res.json();
}

async function geocodeCity(q) {
  // Direct geocoding
  const url = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(q)}&limit=1&appid=${API_KEY}`;
  const data = await fetchJSON(url);
  if (!Array.isArray(data) || data.length === 0) return null;
  const g = data[0];
  return {
    name: g.name,
    country: g.country,
    lat: g.lat,
    lon: g.lon,
    state: g.state,
  };
}

async function oneCall(lat, lon) {
  // One Call 3.0 current + hourly. Use metric for future add-ons.
  const url = `https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lon}&exclude=minutely,daily,alerts&units=metric&appid=${API_KEY}`;
  return fetchJSON(url);
}

// ---------- Rendering ----------
function renderLocation(loc) {
  const parts = [loc.name];
  if (loc.state) parts.push(loc.state);
  if (loc.country) parts.push(loc.country);
  el.locationName.textContent = parts.join(", ");
  el.updatedAt.textContent = fmtUpdated();
}

function renderUV(data) {
  const tz = data.timezone_offset ?? 0;

  const nowUvi = data?.current?.uvi;
  if (typeof nowUvi !== "number") throw new Error("Hittade ingen UV-data (current.uvi).");

  const band = uvBand(nowUvi);
  el.uvNow.textContent = round1(nowUvi).toFixed(1);
  el.uvLevel.textContent = band.label;
  el.uvHint.textContent = uvHintText(nowUvi);

  // Today max from next 24 hours
  const hourly = Array.isArray(data.hourly) ? data.hourly.slice(0, 24) : [];
  const withUvi = hourly.filter(h => typeof h.uvi === "number");
  let maxObj = null;
  for (const h of withUvi) {
    if (!maxObj || h.uvi > maxObj.uvi) maxObj = h;
  }
  if (maxObj) {
    el.uvMax.textContent = round1(maxObj.uvi).toFixed(1);
    el.uvMaxTime.textContent = `kring ${fmtTime(maxObj.dt, tz)}`;
    const maxBand = uvBand(maxObj.uvi);
    el.todaySummary.textContent = `Max ${Math.round(maxObj.uvi)} (${maxBand.label})`;
    el.todayComment.textContent = todayCommentText(maxObj.uvi);
  } else {
    el.uvMax.textContent = "—";
    el.uvMaxTime.textContent = "—";
    el.todaySummary.textContent = "—";
    el.todayComment.textContent = "—";
  }

  // Recommendation list based on current UV (simple + actionable)
  const rec = recListFor(nowUvi);
  el.recList.innerHTML = rec.map(x => `<li>${x}</li>`).join("");

  // Forecast strip: next 8 hours
  el.forecastStrip.innerHTML = "";
  const next = hourly.slice(0, 8);
  for (const h of next) {
    const u = (typeof h.uvi === "number") ? Math.round(h.uvi) : "—";
    const lbl = (typeof h.uvi === "number") ? uvBand(h.uvi).label : "";
    const t = (typeof h.dt === "number") ? fmtTime(h.dt, tz) : "";
    const card = document.createElement("div");
    card.className = "glass mini-card p-3";
    card.innerHTML = `
      <div class="small dim">${t}</div>
      <div class="h4 mb-0">${u}</div>
      <div class="small dim">${lbl}</div>
    `;
    el.forecastStrip.appendChild(card);
  }
}

// ---------- Location flow ----------
function saveLoc(loc) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(loc));
}
function loadLoc() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function getBrowserLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) reject(new Error("Geolocation stöds inte i din webbläsare."));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      (err) => reject(new Error(err.message || "Kunde inte hämta din plats.")),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 10 * 60 * 1000 }
    );
  });
}

async function setLocationAndRefresh(loc) {
  setError("");
  setStatus("Hämtar UV-data…");
  renderLocation(loc);

  const data = await oneCall(loc.lat, loc.lon);
  renderUV(data);

  setStatus("");
}

async function useMyLocation() {
  setError("");
  setStatus("Hämtar din plats… (tillåt platsåtkomst)");
  const { lat, lon } = await getBrowserLocation();

  // For display name, do a quick reverse-geocode via direct geocode? (optional)
  // Keep it simple: show coordinates until user searches a city.
  const loc = { name: "Min plats", lat, lon, country: "" };
  saveLoc(loc);
  await setLocationAndRefresh(loc);
}

async function searchAndSetCity(q) {
  setError("");
  setStatus("Söker plats…");
  const loc = await geocodeCity(q);
  if (!loc) throw new Error("Hittade ingen matchning. Prova t.ex. “Göteborg” eller “Umeå”.");
  saveLoc(loc);
  await setLocationAndRefresh(loc);
}

// ---------- Init ----------
function wireInputs() {
  const handler = async (value) => {
    const q = (value || "").trim();
    if (!q) return;
    try {
      await searchAndSetCity(q);
    } catch (e) {
      setStatus("");
      setError(e.message || String(e));
    }
  };

  const bind = (input) => {
    if (!input) return;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") handler(input.value);
    });
  };

  bind(el.cityInput);
  bind(el.cityInputMobile);

  el.useMyLocationBtn.addEventListener("click", async () => {
    try {
      await useMyLocation();
    } catch (e) {
      setStatus("");
      setError(e.message || String(e));
    }
  });
}

(async function init() {
  wireInputs();

  // Prefer saved location (travel-friendly)
  const saved = loadLoc();
  if (saved?.lat && saved?.lon) {
    try {
      await setLocationAndRefresh(saved);
      return;
    } catch (e) {
      // fall through to browser location
      console.warn(e);
    }
  }

  // First visit: ask for geolocation
  try {
    await useMyLocation();
  } catch (e) {
    setStatus("");
    setError("Tillåt platsåtkomst eller sök en stad ovan.");
    el.locationName.textContent = "Välj plats";
    el.updatedAt.textContent = "—";
  }
})();
