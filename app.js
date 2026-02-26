// app.js (complete) — Open-Meteo (no API key)
// + PWA install support:
//   - Install button appears on supported browsers (Android Chrome etc.)
//   - iOS hint shown (Share → Add to Home Screen)
// + Forecast switches: hours (daytime) vs days max (nighttime)

const DEFAULT_LOCATION = {
  name: "Stockholm",
  country: "SE",
  lat: 59.3293,
  lon: 18.0686,
};

const el = {
  locationName: document.getElementById("locationName"),
  updatedAt: document.getElementById("updatedAt"),
  status: document.getElementById("status"),
  weatherTemp: document.getElementById("weatherTemp"),
  weatherSummary: document.getElementById("weatherSummary"),
  weatherDetails: document.getElementById("weatherDetails"),
  weatherIcon: document.getElementById("weatherIcon"),
  weatherFeels: document.getElementById("weatherFeels"),
  uvScaleMarker: document.getElementById("uvScaleMarker"),
  uvScaleLabel: document.getElementById("uvScaleLabel"),
  error: document.getElementById("error"),

  uvNow: document.getElementById("uvNow"),
  uvLevel: document.getElementById("uvLevel"),
  uvHint: document.getElementById("uvHint"),

  uvMax: document.getElementById("uvMax"),
  uvMaxTime: document.getElementById("uvMaxTime"),
  uvMaxBand: document.getElementById("uvMaxBand"),

  todayNarrativeTitle: document.getElementById("todayNarrativeTitle"),
  todayNarrativeBody: document.getElementById("todayNarrativeBody"),

  recList: document.getElementById("recList"),

  forecastStrip: document.getElementById("forecastStrip"),
  forecastModeLabel: document.getElementById("forecastModeLabel"),
  forecastSummary: document.getElementById("forecastSummary"),

  cityInput: document.getElementById("cityInput"),
  cityInputMobile: document.getElementById("cityInputMobile"),
  useMyLocationBtn: document.getElementById("useMyLocationBtn"),

  installBtn: document.getElementById("installBtn"),
  installHint: document.getElementById("installHint"),
};

const STORAGE_KEY = "uvnu_location_v1"; // { name, lat, lon, country, state }
let deferredInstallPrompt = null;

// ---------- small helpers ----------
const round1 = (n) => Math.round(n * 10) / 10;

const fmtUpdated = () => {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `Uppdaterad ${hh}:${mm}`;
};

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

// ---------- UV logic ----------
function uvBand(uvi) {
  if (uvi < 3) return { label: "Låg" };
  if (uvi < 6) return { label: "Måttlig" };
  if (uvi < 8) return { label: "Hög" };
  if (uvi < 11) return { label: "Mycket hög" };
  return { label: "Extrem" };
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

// ---------- Place + text helpers ----------
function renderLocation(loc) {
  const parts = [loc.name];
  if (loc.state) parts.push(loc.state);
  if (loc.country) parts.push(loc.country);
  el.locationName.textContent = parts.join(", ");
  el.updatedAt.textContent = fmtUpdated();
}

function placeShortName() {
  const t = el.locationName?.textContent || "";
  return t.split(",")[0].trim() || "platsen";
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
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&current=uv_index` +
    `&hourly=uv_index` +
    `&daily=uv_index_max` +
    `&timezone=auto` +
    `&forecast_days=5`;
  return fetchJSON(url);
}


async function openMeteoWeather(lat, lon) {
  // Hämtar grundläggande väderdata utan API-nyckel
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,apparent_temperature,weathercode,wind_speed_10m,relative_humidity_2m` +
    `&timezone=auto`;
  return fetchJSON(url);
}

function weatherCodeToText(code) {
  // Open-Meteo Weathercode: https://open-meteo.com/en/docs
  const m = {
    0: "Klart",
    1: "Mest klart",
    2: "Delvis molnigt",
    3: "Mulet",
    45: "Dimma",
    48: "Rimfrost-dimma",
    51: "Duggregn (lätt)",
    53: "Duggregn",
    55: "Duggregn (kraftigt)",
    56: "Underkylt duggregn (lätt)",
    57: "Underkylt duggregn",
    61: "Regn (lätt)",
    63: "Regn",
    65: "Regn (kraftigt)",
    66: "Underkylt regn (lätt)",
    67: "Underkylt regn",
    71: "Snö (lätt)",
    73: "Snö",
    75: "Snö (kraftigt)",
    77: "Kornsnö",
    80: "Regnskurar (lätta)",
    81: "Regnskurar",
    82: "Regnskurar (kraftiga)",
    85: "Snöskurar (lätta)",
    86: "Snöskurar",
    95: "Åska",
    96: "Åska med hagel (lätt)",
    99: "Åska med hagel",
  };
  return m[code] ?? "Väder";
}

function weatherCodeToEmoji(code) {
  // En enkel ikon-karta som funkar överallt (utan extra bilder)
  if (code === 0) return "☀️";
  if (code === 1) return "🌤️";
  if (code === 2) return "⛅";
  if (code === 3) return "☁️";
  if (code === 45 || code === 48) return "🌫️";
  if ([51,53,55,56,57].includes(code)) return "🌦️";
  if ([61,63,65,66,67,80,81,82].includes(code)) return "🌧️";
  if ([71,73,75,77,85,86].includes(code)) return "🌨️";
  if ([95,96,99].includes(code)) return "⛈️";
  return "🌡️";
}

function renderWeather(weatherData) {
  if (!weatherData || !weatherData.current) return;

  const c = weatherData.current;

  const temp = typeof c.temperature_2m === "number" ? Math.round(c.temperature_2m) : null;
  const feels = typeof c.apparent_temperature === "number" ? Math.round(c.apparent_temperature) : null;
  const wind = typeof c.wind_speed_10m === "number" ? Math.round(c.wind_speed_10m) : null;
  const rh = typeof c.relative_humidity_2m === "number" ? Math.round(c.relative_humidity_2m) : null;
  const code = c.weathercode;

  const text = weatherCodeToText(code);
  const emoji = weatherCodeToEmoji(code);

  if (el.weatherTemp) el.weatherTemp.textContent = temp !== null ? `${temp}°` : "—";
  if (el.weatherSummary) el.weatherSummary.textContent = text;
  if (el.weatherIcon) el.weatherIcon.textContent = emoji;

  const details = [];
  if (wind !== null) details.push(`Vind ${wind} m/s`);
  if (rh !== null) details.push(`Luftfuktighet ${rh}%`);
  if (el.weatherDetails) el.weatherDetails.textContent = details.length ? details.join(" • ") : "—";

  if (el.weatherFeels) {
    el.weatherFeels.textContent = feels !== null ? `Känns som ${feels}°` : "";
  }
}

// ---------- Forecast rendering ----------
function renderForecastStrip(nowUvi, data) {
  el.forecastStrip.innerHTML = "";

  const nowIsNight = nowUvi < 0.5;

  if (el.forecastModeLabel) {
    el.forecastModeLabel.textContent = nowIsNight ? "Kommande dagar" : "Kommande timmar";
  }

  if (nowIsNight) {
    const dTimes = data?.daily?.time || [];
    const dMax = data?.daily?.uv_index_max || [];
    const count = Math.min(5, dTimes.length, dMax.length);

    if (el.forecastSummary) {
      let bestI = 0;
      for (let i = 0; i < count; i++) {
        if (typeof dMax[i] === "number" && dMax[i] > dMax[bestI]) bestI = i;
      }
      const top = dMax[bestI];
      const day =
        bestI === 0 ? "idag" :
        bestI === 1 ? "imorgon" :
        new Date(dTimes[bestI] + "T12:00:00").toLocaleDateString("sv-SE", { weekday: "long" });

      el.forecastSummary.textContent =
        (typeof top === "number")
          ? `Högst de kommande dagarna: ${round1(top).toFixed(1)} (${uvBand(top).label}) ${day}.`
          : "";
    }

    for (let i = 0; i < count; i++) {
      const dateStr = dTimes[i];
      const v = dMax[i];
      const u = typeof v === "number" ? Math.round(v) : "—";
      const lbl = typeof v === "number" ? uvBand(v).label : "";

      let dayLabel = "—";
      if (i === 0) dayLabel = "Idag";
      else if (i === 1) dayLabel = "Imorgon";
      else {
        const d = new Date(dateStr + "T12:00:00");
        dayLabel = d.toLocaleDateString("sv-SE", { weekday: "short" });
      }

      const card = document.createElement("div");
      card.className = "glass mini-card p-3";
      card.innerHTML = `
        <div class="small dim">${dayLabel}</div>
        <div class="h4 mb-0">${u}</div>
        <div class="small dim">${lbl}</div>
      `;
      el.forecastStrip.appendChild(card);
    }
    return;
  }

  if (el.forecastSummary) el.forecastSummary.textContent = "";

  const times = data?.hourly?.time || [];
  const uvs = data?.hourly?.uv_index || [];
  const now = new Date();

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

// ---------- Main render ----------
function renderUV(data) {
  const nowUvi = data?.current?.uv_index;
  if (typeof nowUvi !== "number")
    throw new Error("Hittade ingen UV-data (current.uv_index).");

  // UV now card
  el.uvNow.textContent = round1(nowUvi).toFixed(1);
  el.uvLevel.textContent = uvBand(nowUvi).label;
  el.uvHint.textContent = uvHintText(nowUvi);

  // Find today's peak time from hourly max for today's date
  const todayMax = data?.daily?.uv_index_max?.[0];
  const todayDate = data?.daily?.time?.[0];

  let peakTxt = "mitt på dagen";
  if (todayDate) {
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
    if (bestIdx >= 0) peakTxt = times[bestIdx].slice(11, 16);
  }

  const place = placeShortName();

  if (typeof todayMax === "number") {
    const maxTxt = round1(todayMax).toFixed(1);

    // Peak today card
    el.uvMax.textContent = maxTxt;
    el.uvMaxTime.textContent = `kring ${peakTxt}`;
    if (el.uvMaxBand) el.uvMaxBand.textContent = uvBand(todayMax).label;

    // Narrative (sound + Apple-ish)
    const narrativeTitle = `Solen i ${place} är som starkast runt ${peakTxt} med UV-index ${maxTxt}.`;

    let narrativeBody = "";
    if (todayMax < 3) {
      narrativeBody = "UV är låg idag — solskydd är oftast inte nödvändigt.";
    } else if (todayMax < 6) {
      narrativeBody = "UV är måttlig — använd SPF om du är ute länge, särskilt mitt på dagen.";
    } else {
      narrativeBody = "Vid UV-index 3+ är det bra för de flesta att skydda sig. Planera skugga 11–15.";
    }

    el.todayNarrativeTitle.textContent = narrativeTitle;
    el.todayNarrativeBody.textContent = narrativeBody;
  } else {
    el.uvMax.textContent = "—";
    el.uvMaxTime.textContent = "—";
    if (el.uvMaxBand) el.uvMaxBand.textContent = "";
    el.todayNarrativeTitle.textContent = "—";
    el.todayNarrativeBody.textContent = "—";
  }

  // Recommendation list based on current UV
  const rec = recListFor(nowUvi);
  el.recList.innerHTML = rec.map((x) => `<li>${x}</li>`).join("");

  // Forecast strip
  renderForecastStrip(nowUvi, data);
}

// ---------- Refresh ----------
async function setLocationAndRefresh(loc) {
  setError("");
  setStatus("Hämtar UV- och väderdata…");
  renderLocation(loc);

  const [uvData, weatherData] = await Promise.all([
    openMeteoUV(loc.lat, loc.lon),
    openMeteoWeather(loc.lat, loc.lon),
  ]);

  renderWeather(weatherData);
  renderUV(uvData);

  setStatus("");
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

async function useMyLocation() {
  setError("");
  setStatus("Hämtar din plats… (tillåt platsåtkomst)");
  const { lat, lon } = await getBrowserLocation();
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

// ---------- PWA / Install UX ----------
function isStandalone() {
  // iOS Safari uses navigator.standalone
  // Others can use matchMedia display-mode
  return (
    window.navigator.standalone === true ||
    window.matchMedia?.("(display-mode: standalone)")?.matches
  );
}

function isIOS() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

function setupInstallUX() {
  // Android/Chrome: capture install prompt
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (el.installBtn) el.installBtn.style.display = "inline-block";
  });

  if (el.installBtn) {
    el.installBtn.addEventListener("click", async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice.catch(() => null);
      deferredInstallPrompt = null;
      el.installBtn.style.display = "none";
    });
  }

  // iOS: show a small hint (no native prompt)
  if (isIOS() && !isStandalone() && el.installHint) {
    el.installHint.style.display = "block";
    el.installHint.textContent = "Tips: På iPhone, tryck Dela och välj ”Lägg till på hemskärmen” för att spara UV.nu som app.";
  }
}

// ---------- Service worker ----------
async function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("/sw.js");
  } catch {
    // ignore
  }
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
    } catch {
      setStatus("Visar standardplats (Stockholm)…");
      setError("");
      try {
        saveLoc(DEFAULT_LOCATION);
        await setLocationAndRefresh(DEFAULT_LOCATION);
      } catch {
        setStatus("");
        setError("Kunde inte hämta UV-data.");
      }
    }
  });
}

(async function init() {
  setupInstallUX();
  registerSW();
  wireInputs();

  // 1) Saved location
  const saved = loadLoc();
  if (saved?.lat && saved?.lon) {
    try {
      await setLocationAndRefresh(saved);
      return;
    } catch {
      // fall through
    }
  }

  // 2) Browser location
  try {
    await useMyLocation();
    return;
  } catch {
    // 3) Stockholm fallback
    setStatus("Visar standardplats (Stockholm)…");
    setError("");
    try {
      saveLoc(DEFAULT_LOCATION);
      await setLocationAndRefresh(DEFAULT_LOCATION);
    } catch {
      setStatus("");
      setError("Kunde inte hämta UV-data.");
      el.locationName.textContent = "Välj plats";
      el.updatedAt.textContent = "—";
    }
  }
})();
