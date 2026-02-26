// app.js — UV.nu (Minimal nordisk utility)
// Datakälla: Open‑Meteo (ingen API-nyckel)
// - Hämtar UV (timvis) och väder (nuvarande)
// - Stöd för sök på stad + "Min plats"
// - Ritar en enkel UV-kurva (SVG) för dagen
// - All text och kommentarer på svenska

const DEFAULT_LOCATION = {
  namn: "Stockholm",
  land: "SE",
  lat: 59.3293,
  lon: 18.0686,
};

// =========
// Element
// =========
const el = {
  // Hero
  locationName: document.getElementById("locationName"),
  updatedAt: document.getElementById("updatedAt"),
  uvNow: document.getElementById("uvNow"),
  uvLevel: document.getElementById("uvLevel"),
  uvMarker: document.getElementById("uvMarker"),
  uvMax: document.getElementById("uvMax"),
  uvMaxTime: document.getElementById("uvMaxTime"),
  uvAdviceList: document.getElementById("uvAdviceList"),

  // Sök / plats
  cityInput: document.getElementById("cityInput"),
  useMyLocationBtn: document.getElementById("useMyLocationBtn"),

  // Väder
  tempNow: document.getElementById("tempNow"),
  feelsLike: document.getElementById("feelsLike"),
  cloudNow: document.getElementById("cloudNow"),
  windNow: document.getElementById("windNow"),
  tempMin: document.getElementById("tempMin"),
  tempMax: document.getElementById("tempMax"),
  weatherNote: document.getElementById("weatherNote"),

  // Prognos
  uvSpark: document.getElementById("uvSpark"),
  uvTicks: document.getElementById("uvTicks"),

  // Footer
  yearNow: document.getElementById("yearNow"),

  // Kontakt
  kontaktForm: document.getElementById("kontaktForm"),
  kontaktStatus: document.getElementById("kontaktStatus"),
  kontaktSuccess: document.getElementById("kontaktSuccess"),
};

// =========
// State
// =========
let currentLocation = { ...DEFAULT_LOCATION };

// =========
// Hjälpare
// =========
function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatTid(d) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

// UV-nivåer (förenklad, i linje med vanliga rekommendationer)
function uvKategori(uv) {
  if (uv < 3) return { namn: "Låg", accent: "var(--uv-green)" };
  if (uv < 6) return { namn: "Måttlig", accent: "var(--uv-green)" };
  if (uv < 8) return { namn: "Hög", accent: "var(--uv-amber)" };
  if (uv < 11) return { namn: "Mycket hög", accent: "var(--uv-red)" };
  return { namn: "Extrem", accent: "var(--uv-purple)" };
}

function uvRekommendationer(uv) {
  // Returnerar flera korta råd så att sidan känns mer hjälpsam utan att bli "plottrig"
  const råd = [];

  if (uv < 3) {
    råd.push("Inget särskilt skydd krävs för de flesta vid kortare vistelse.");
    råd.push("Använd solglasögon vid starkt ljus och var extra uppmärksam vid vatten/snö.");
  } else if (uv < 6) {
    råd.push("Solskydd rekommenderas mitt på dagen (SPF 30+).");
    råd.push("Solglasögon och hatt minskar risken för ögon- och hudskador.");
  } else if (uv < 8) {
    råd.push("Sök skugga mitt på dagen och använd solskydd (SPF 30–50).");
    råd.push("Täckande kläder och solglasögon ger extra skydd.");
  } else if (uv < 11) {
    råd.push("Undvik stark sol mitt på dagen. Skydda hud och ögon noggrant.");
    råd.push("Planera utomhusaktiviteter till morgon/kväll om möjligt.");
  } else {
    råd.push("Undvik solen. Extra skydd behövs även i skugga.");
    råd.push("Täckande kläder, hatt och solglasögon rekommenderas starkt.");
  }

  // Barn-råd (alltid med som tredje punkt)
  råd.push("Barn: Välj skugga och täckande kläder. Solkräm på hud som inte kan täckas.");

  return råd.slice(0, 3);
}
// =========
// Open‑Meteo: Geocoding (sök + reverse)
// =========
async function geokodaStad(query) {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", query);
  url.searchParams.set("count", "5");
  url.searchParams.set("language", "sv");
  url.searchParams.set("format", "json");

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error("Kunde inte söka efter plats");
  const data = await res.json();

  if (!data || !Array.isArray(data.results) || data.results.length === 0) return null;

  // Välj första träffen (ofta bäst). Vid behov kan vi förbättra ranking senare.
  const r = data.results[0];
  return {
    namn: r.name,
    land: r.country_code || "",
    lat: r.latitude,
    lon: r.longitude,
  };
}

async function reverseGeokoda(lat, lon) {
  // Open‑Meteo reverse endpoint (om det inte finns i framtiden, fall tillbaka)
  const url = new URL("https://geocoding-api.open-meteo.com/v1/reverse");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("language", "sv");
  url.searchParams.set("format", "json");

  try {
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !Array.isArray(data.results) || data.results.length === 0) return null;

    const r = data.results[0];
    return r.name || null;
  } catch {
    return null;
  }
}

// =========
// Open‑Meteo: UV + väder (en fetch)
// =========
async function hamtaData(lat, lon) {
  // OBS: Vi använder "current=..." för temperatur/m.m. och "hourly=uv_index" för UV.
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("timezone", "auto");

  // Nuvarande väder (inkl. 'apparent_temperature' = känns som)
  url.searchParams.set("current", "temperature_2m,apparent_temperature,cloud_cover,wind_speed_10m");

  // UV timvis + max per dag
  url.searchParams.set("hourly", "uv_index");
  url.searchParams.set("daily", "uv_index_max,temperature_2m_min,temperature_2m_max");

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error("Kunde inte hämta data från Open‑Meteo");
  return res.json();
}

// =========
// Render: Hero (UV nu, nivå, topp idag, rekommendation)
// =========
function renderHero({ uvNow, uvMax, uvMaxTime }) {
  const uvR = Math.round(uvNow * 10) / 10;
  el.uvNow.textContent = Number.isFinite(uvR) ? String(uvR) : "--";

  const cat = uvKategori(uvR);
  el.uvLevel.textContent = cat.namn;
  el.uvLevel.style.color = `rgba(17,24,39,.9)`;
  el.uvNow.style.color = cat.accent;

  // Markör på 0–12 skala (vi klipper vid 12 för layout)
  const pct = (clamp(uvR, 0, 12) / 12) * 100;
  el.uvMarker.style.left = `${pct}%`;

  el.uvMax.textContent = Number.isFinite(uvMax) ? String(Math.round(uvMax * 10) / 10) : "--";
  el.uvMaxTime.textContent = uvMaxTime || "--:--";

  // Sätt flera rekommendationer
  if (el.uvAdviceList) {
    const råd = uvRekommendationer(uvR);
    el.uvAdviceList.innerHTML = "";
    råd.forEach((text) => {
      const li = document.createElement("li");
      li.textContent = text;
      el.uvAdviceList.appendChild(li);
    });
  }
}

// =========
// Render: Väder (nu) (inkl. "Känns som" + min/max)
// =========
function renderWeather(current, daily) {
  const t = current?.temperature_2m;
  const feels = current?.apparent_temperature;
  const cloud = current?.cloud_cover;
  const wind = current?.wind_speed_10m;

  // Dagens min/max (temperatur) från daily-serien
  const tMin = Array.isArray(daily?.temperature_2m_min) ? daily.temperature_2m_min[0] : NaN;
  const tMax = Array.isArray(daily?.temperature_2m_max) ? daily.temperature_2m_max[0] : NaN;

  el.tempNow.textContent = Number.isFinite(t) ? Math.round(t) : "--";
  el.feelsLike.textContent = Number.isFinite(feels) ? Math.round(feels) : "--";
  el.cloudNow.textContent = Number.isFinite(cloud) ? Math.round(cloud) : "--";
  el.windNow.textContent = Number.isFinite(wind) ? Math.round(wind * 10) / 10 : "--";

  // Visa min/max om vi har värden
  if (el.tempMin) el.tempMin.textContent = Number.isFinite(tMin) ? Math.round(tMin) : "--";
  if (el.tempMax) el.tempMax.textContent = Number.isFinite(tMax) ? Math.round(tMax) : "--";

  // Diskret notis (t.ex. "Nu")
  el.weatherNote.textContent = "Nu";
}

// =========
// Hitta UV-värden för "nu" och "topp idag" från timserien
// =========
function analyseraUV(hourly, timezoneInfo) {
  const times = hourly?.time || [];
  const uv = hourly?.uv_index || [];

  if (!times.length || !uv.length) {
    return { uvNow: NaN, uvMax: NaN, uvMaxTime: null, points: [] };
  }

  // Open‑Meteo ger tider i lokal tid när timezone=auto.
  const now = new Date();
  const todayKey = now.toISOString().slice(0, 10);

  // Hitta index närmast "nu"
  let bestIdx = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < times.length; i++) {
    const dt = new Date(times[i]);
    const diff = Math.abs(dt.getTime() - now.getTime());
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
  }
  const uvNow = uv[bestIdx];

  // Topp idag (max under samma datum)
  let uvMax = -Infinity;
  let uvMaxIdx = null;

  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    if (t.slice(0, 10) !== todayKey) continue;

    const v = uv[i];
    if (Number.isFinite(v) && v > uvMax) {
      uvMax = v;
      uvMaxIdx = i;
    }
  }

  const uvMaxTime = uvMaxIdx != null ? formatTid(new Date(times[uvMaxIdx])) : null;

  // Punkter för dagskurva (06–19) för att inte se "tomt" ut
  const points = [];
  for (let i = 0; i < times.length; i++) {
    if (times[i].slice(0, 10) !== todayKey) continue;
    const d = new Date(times[i]);
    const h = d.getHours();
    if (h < 6 || h > 19) continue;
    points.push({ h, v: uv[i] });
  }

  // Om vi saknar data i det intervallet (t.ex. polarnatt / API-issue) så ta första 8 punkter som fallback
  if (points.length < 2) {
    for (let i = 0; i < Math.min(8, times.length); i++) {
      const d = new Date(times[i]);
      points.push({ h: d.getHours(), v: uv[i] });
    }
  }

  return {
    uvNow,
    uvMax: Number.isFinite(uvMax) ? uvMax : NaN,
    uvMaxTime,
    points,
  };
}

// =========
// Render: UV-prognos (enkel SVG-sparkline)
// =========
function renderUvSpark(points) {
  const svg = el.uvSpark;
  if (!svg) return;

  // Rensa
  svg.innerHTML = "";

  const W = 460;
  const H = 120;
  // Marginaler: vänster större för Y-axelns siffror
  const padL = 40;
  const padR = 14;
  const padY = 14;

  // Skala
  const xs = points.map(p => p.h);
  const ys = points.map(p => p.v);

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const maxY = Math.max(2, ...ys.filter(Number.isFinite)); // minst 2 så det inte blir platt
  const minY = 0;

  function xScale(h) {
    if (maxX === minX) return (padL + (W - padR)) / 2;
    return padL + ((h - minX) / (maxX - minX)) * (W - padL - padR);
  }
  function yScale(v) {
    const vv = clamp(v, minY, 12);
    const t = (vv - minY) / (maxY - minY || 1);
    return H - padY - t * (H - padY * 2);
  }

  // Grid (lätt)
  for (let i = 0; i < 4; i++) {
    const y = padY + (i / 3) * (H - padY * 2);
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", String(padL));
    line.setAttribute("x2", String(W - padR));
    line.setAttribute("y1", String(y));
    line.setAttribute("y2", String(y));
    line.setAttribute("class", "spark-grid");
    svg.appendChild(line);
  }

  // Y-axel: siffror (0–11) för att göra grafen mer lättläst
  const yEtiketter = [0, 2, 4, 6, 8, 10, 11];
  yEtiketter.forEach((val) => {
    // Hoppa över etiketter som ligger ovanför maxY (utom 0)
    if (val !== 0 && val > maxY + 0.1) return;

    const y = yScale(val);
    const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
    t.setAttribute("x", "6");
    t.setAttribute("y", String(y + 4)); // optisk centrering
    t.setAttribute("class", "spark-ylabel");
    t.textContent = String(val);
    svg.appendChild(t);
  });

  // Subtil Y-axellinje
  const axis = document.createElementNS("http://www.w3.org/2000/svg", "line");
  axis.setAttribute("x1", String(padL));
  axis.setAttribute("x2", String(padL));
  axis.setAttribute("y1", String(padY));
  axis.setAttribute("y2", String(H - padY));
  axis.setAttribute("class", "spark-axis");
  svg.appendChild(axis);

  // Path
  let d = "";
  points.forEach((p, i) => {
    const x = xScale(p.h);
    const y = yScale(p.v);
    d += (i === 0 ? "M" : "L") + x.toFixed(2) + " " + y.toFixed(2) + " ";
  });

  // Fyllning under linjen (diskret)
  const fillPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  const firstX = xScale(points[0].h);
  const lastX = xScale(points[points.length - 1].h);
  const baseY = H - padY;

  const dFill = `${d} L ${lastX.toFixed(2)} ${baseY.toFixed(2)} L ${firstX.toFixed(2)} ${baseY.toFixed(2)} Z`;
  fillPath.setAttribute("d", dFill);
  fillPath.setAttribute("class", "spark-fill");
  svg.appendChild(fillPath);

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", d.trim());
  path.setAttribute("class", "spark-line");
  svg.appendChild(path);

  // Markera topp
  let peak = { v: -Infinity, h: points[0].h, idx: 0 };
  points.forEach((p, i) => {
    if (Number.isFinite(p.v) && p.v > peak.v) peak = { v: p.v, h: p.h, idx: i };
  });

  const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  dot.setAttribute("cx", String(xScale(peak.h)));
  dot.setAttribute("cy", String(yScale(peak.v)));
  dot.setAttribute("r", "6");
  dot.setAttribute("class", "spark-dot");
  svg.appendChild(dot);

  // Tick-etiketter under grafen (minimalt)
  const tickHours = [points[0].h, 9, 12, 15, 18].filter(h => h >= minX && h <= maxX);
  const uniqueTicks = [...new Set(tickHours)].sort((a,b)=>a-b);
  el.uvTicks.innerHTML = uniqueTicks.map(h => `<span>${h === points[0].h ? "Nu" : String(h)}</span>`).join("");
}

// =========
// Uppdatera UI
// =========
async function uppdatera() {
  // Tidstämpel
  el.updatedAt.textContent = formatTid(new Date());
  el.locationName.textContent = currentLocation.namn || "Min plats";

  const data = await hamtaData(currentLocation.lat, currentLocation.lon);

  // Väder
  renderWeather(data.current, data.daily);

  // UV
  const uvInfo = analyseraUV(data.hourly, data.timezone);
  renderHero({ uvNow: uvInfo.uvNow, uvMax: uvInfo.uvMax, uvMaxTime: uvInfo.uvMaxTime });
  renderUvSpark(uvInfo.points);
}

// =========
// Events: sök / min plats
// =========
function setupEvents() {
  // Sök på stad (Enter)
  el.cityInput?.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter") return;
    const q = (el.cityInput.value || "").trim();
    if (!q) return;

    try {
      el.cityInput.blur();
      const place = await geokodaStad(q);
      if (!place) {
        // Håll det enkelt: återställ värdet
        el.cityInput.value = "";
        return;
      }
      currentLocation = { ...place };
      await uppdatera();
    } catch (err) {
      console.error(err);
    }
  });

  // Min plats
  el.useMyLocationBtn?.addEventListener("click", async () => {
    if (!navigator.geolocation) return;

    el.useMyLocationBtn.disabled = true;
    el.useMyLocationBtn.textContent = "Hämtar…";

    navigator.geolocation.getCurrentPosition(async (pos) => {
      try {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;

        currentLocation = { namn: "Min plats", land: "", lat, lon };

        // Försök få ett riktigt ortnamn utan API-nyckel
        const stad = await reverseGeokoda(lat, lon);
        if (stad) currentLocation.namn = stad;

        await uppdatera();
      } catch (err) {
        console.error(err);
      } finally {
        el.useMyLocationBtn.disabled = false;
        el.useMyLocationBtn.textContent = "Min plats";
      }
    }, (err) => {
      console.warn(err);
      el.useMyLocationBtn.disabled = false;
      el.useMyLocationBtn.textContent = "Min plats";
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
  });

  // Kontaktform (valfritt — skickas bara om du kopplar in en tjänst)
  el.kontaktForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    el.kontaktStatus.textContent = "";
    el.kontaktSuccess.classList.add("d-none");

    const action = el.kontaktForm.getAttribute("action") || "#";
    if (action === "#" || action.trim() === "") {
      el.kontaktStatus.textContent = "Formulär ej aktiverat ännu.";
      return;
    }

    try {
      const formData = new FormData(el.kontaktForm);
      const res = await fetch(action, {
        method: "POST",
        headers: { "Accept": "application/json" },
        body: formData
      });

      if (!res.ok) throw new Error("Skick misslyckades");

      el.kontaktForm.reset();
      el.kontaktSuccess.classList.remove("d-none");
    } catch (err) {
      el.kontaktStatus.textContent = "Kunde inte skicka. Försök igen senare.";
      console.error(err);
    }
  });
}

// =========
// Init
// =========
(function init() {
  // Footer-år
  if (el.yearNow) el.yearNow.textContent = String(new Date().getFullYear());

  setupEvents();
  uppdatera().catch(console.error);

  // PWA: service worker (om du redan har sw.js)
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
})();
