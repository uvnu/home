// UV.nu MVP (GitHub Pages) — Open-Meteo (no API key)
// - Auto-detect location (browser geolocation) + city search override
// - Fallback default: Stockholm (if no saved location + geolocation denied/fails)
// - Shows: UV now (hero), today's max + peak time, hourly strip, recommendation list
//
// Docs:
// - Open-Meteo Forecast API:   https://open-meteo.com/en/docs
// - Open-Meteo Geocoding API: https://open-meteo.com/en/docs/geocoding-api

// Default fallback location (never show an empty page)
const DEFAULT_LOCATION = {
  name: "Stockholm",
  country: "SE",
  lat: 59.3293,
  lon: 18.0686,
};

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
const STORAGE_KEY = "uvnu_location_v1"; // { name, lat, lon, country, state }

// ---------- Helpers ----------
const round1 = (n) => Math.round(n * 10) / 10;

const fmtUpdated = () => {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `Uppdaterad ${hh}:${mm}`;
};

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
  if (uvi < 3)
    return [
      "Solglasögon om du vill",
      "Håll koll om du är extra känslig",
      "Barn: skydda ändå vid längre utevistelse",
    ];
  if (uvi < 6)
    return [
      "SPF 30 vid längre utevistelse",
      "Solglasögon",
      "Sök skugga om du är ute mitt på dagen",
    ];
  if (uvi < 8)
    return [
      "SPF 30+ och fyll på varannan timme",
      "Keps/solhatt + solglasögon",
      "Planera skugga 11–15",
    ];
  if (uvi < 11)
    return [
      "SPF 50 och fyll på ofta",
      "Täckande kläder/solhatt",
      "Undvik direkt sol 11–15",
    ];
  return [
    "SPF 50+ och täckande kläder",
    "Stanna i skugga så mycket som möjligt",
    "Extra försiktighet med barn",
  ];
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

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} – ${text.slice(0, 140)}`);
  }
  return res.json();
}

// ---------- Open-Meteo calls ----------
async function geocodeCity(q) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
    q
  )}&count=1&language=sv&format=json`;
  const data = await fetchJSON(url);
  const r = data?.results?.[0];
  if (!r) return null;
  return {
    name: r.name,
    country: r.country_code || r.country,
    lat: r.latitude,
    lon: r.longitude,
    state: r.admin1,
  };
}

async function openMeteoUV(lat, lon) {
  // UV-only MVP, timezone=auto returns local times for the selected location
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&current=uv_index` +
    `&hourly=uv_index` +
    `&daily=uv_index_max` +
    `&timezone=auto` +
    `&forecast_days=3`;
  return fetchJSON(url);
}

// ---------- Location flow ----------
function getBrowserLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation)
      reject(new Error("Geolocation stöds inte i din webbläsare."));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      (err) => reject(new Error(err.message || "Kunde inte hämta din plats.")),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 10 * 60 * 1000 }
    );
  });
}

function renderLocation(loc) {
  const parts = [loc.name];
  if (loc.state) parts.push(loc.state);
  if (loc.country) parts.push(loc.country);
  el.locationName.textContent = parts.join(", ");
  el.updatedAt.textContent = fmtUpdated();
}

// ---------- Rendering ----------
function renderUV(data) {
  // Open-Meteo format:
  // data.current.uv_index
  // data.hourly.time[] (ISO), data.hourly.uv_index[]
  // data.daily.time[] (date), data.daily.uv_index_max[]
  const nowUvi = data?.current?.uv_index;
  if (typeof nowUvi !== "number")
    throw new Error("Hittade ingen UV-data (current.uv_index).");

  const bandNow = uvBand(nowUvi);
  el.uvNow.textContent = round1(nowUvi).toFixed(1);
  el.uvLevel.textContent = bandNow.label;
  el.uvHint.textContent = uvHintText(nowUvi);

  // Today max (daily)
  const todayMax = data?.daily?.uv_index_max?.[0];
  const todayDate = data?.daily?.time?.[0]; // "YYYY-MM-DD"

  if (typeof todayMax === "number") {
    el.uvMax.textContent = round1(todayMax).toFixed(1);

    // Estimate peak time by finding the max in hourly values for today's date
    const times = data?.hourly?.time || [];
    const uvs = data?.hourly?.uv_index || [];
    let bestIdx = -1;
    let bestVal = -Infinity;

    for (let i = 0; i < times.length; i++) {
      if (!times[i]?.startsWith(todayDate)) continue;
      const v = uvs[i];
      if (typeof v === "number" && v > bestVal) {
        bestVal = v;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0) {
      const hhmm = times[bestIdx].slice(11, 16); // "HH:MM"
      el.uvMaxTime.textContent = `kring ${hhmm}`;
    } else {
      el.uvMaxTime.textContent = "—";
    }

    const maxBand = uvBand(todayMax);
    el.todaySummary.textContent = `Max ${Math.round(todayMax)} (${maxBand.label})`;
    el.todayComment.textContent = todayCommentText(todayMax);
  } else {
    el.uvMax.textContent = "—";
    el.uvMaxTime.textContent = "—";
    el.todaySummary.textContent = "—";
    el.todayComment.textContent = "—";
  }

  // Recommendation list based on current UV
  const rec = recListFor(nowUvi);
  el.recList.innerHTML = rec.map((x) => `<li>${x}</li>`).join("");

  // Forecast strip: next 8 hours from "now"
  el.forecastStrip.innerHTML = "";
  const times = data?.hourly?.time || [];
  const uvs = data?.hourly?.uv_index || [];
  const now = new Date();

  // Find first hourly index >= now
  let start = 0;
  for (let i = 0; i < times.length; i++) {
    const t = new Date(times[i]);
    if (t >= now) {
      start = i;
      break;
    }
  }

  for (let i = start; i < Math.min(start + 8, times.length); i++) {
    const t = times[i]?.slice(11, 16) || "";
    const v = uvs[i];
    const u = typeof v === "number" ? Math.round(v) : "—";
    const lbl = typeof v === "number" ? uvBand(v).label : "";
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

async function setLocationAndRefresh(loc) {
  setError("");
  setStatus("Hämtar UV-data…");
  renderLocation(loc);

  const data = await openMeteoUV(loc.lat, loc.lon);
  renderUV(data);

  setStatus("");
}

async function useMyLocation() {
  setError("");
  setStatus("Hämtar din plats… (tillåt platsåtkomst)");
  const { lat, lon } = await getBrowserLocation();

  // Minimal: label as "Min plats" until user searches a city
  const loc = { name: "Min plats", lat, lon, country: "" };
  saveLoc(loc);
  await setLocationAndRefresh(loc);
}

async function searchAndSetCity(q) {
  setError("");
  setStatus("Söker plats…");
  const loc = await geocodeCity(q);
  if (!loc)
    throw new Error(
      "Hittade ingen matchning. Prova t.ex. “Göteborg” eller “Umeå”."
    );
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
      // If user clicks "Min plats" and denies, fallback to default
      setStatus("Visar standardplats (Stockholm)…");
      setError("");
      try {
        saveLoc(DEFAULT_LOCATION);
        await setLocationAndRefresh(DEFAULT_LOCATION);
      } catch (err) {
        setStatus("");
        setError("Kunde inte hämta UV-data.");
      }
    }
  });
}

(async function init() {
  wireInputs();

  // 1) Prefer saved location (travel-friendly)
  const saved = loadLoc();
  if (saved?.lat && saved?.lon) {
    try {
      await setLocationAndRefresh(saved);
      return;
    } catch (e) {
      console.warn(e);
      // fall through
    }
  }

  // 2) Try browser geolocation
  try {
    await useMyLocation();
    return;
  } catch (e) {
    // 3) Fallback to Stockholm
    setStatus("Visar standardplats (Stockholm)…");
    setError("");
    try {
      saveLoc(DEFAULT_LOCATION);
      await setLocationAndRefresh(DEFAULT_LOCATION);
    } catch (err) {
      setStatus("");
      setError("Kunde inte hämta UV-data.");
      el.locationName.textContent = "Välj plats";
      el.updatedAt.textContent = "—";
    }
  }
})();
