const UV_LEVELS = [
  { max: 2, label: 'Låg', color: 'var(--uv-low)', hex: '#61a83b', status: 'Låg risk just nu' },
  { max: 5, label: 'Måttlig', color: 'var(--uv-moderate)', hex: '#d9a406', status: 'Skydd kan behövas' },
  { max: 7, label: 'Hög', color: 'var(--uv-high)', hex: '#ea7b12', status: 'Skydda dig nu' },
  { max: 10, label: 'Mycket hög', color: 'var(--uv-very-high)', hex: '#d64534', status: 'Starkt skydd behövs' },
  { max: Infinity, label: 'Extrem', color: 'var(--uv-extreme)', hex: '#9050c8', status: 'Undvik stark sol' },
];

const ASSET_BASE = window.UVNU_ASSET_BASE || '/';
const DEFAULT_PLACE = { name: 'Stockholm', lat: 59.3293, lon: 18.0686, route_slug: 'stockholm', county: 'Stockholms län' };
const state = {
  location: window.UVNU_INITIAL_PLACE || DEFAULT_PLACE,
  uvData: null,
  cityPages: new Set(),
  search: { aliasEntries: [], placesById: new Map() },
};

const $ = (id) => document.getElementById(id);
const asset = (path) => ASSET_BASE.replace(/\/$/, '') + '/' + path.replace(/^\//, '');

function getLevel(uv) { return UV_LEVELS.find(level => uv <= level.max) || UV_LEVELS[UV_LEVELS.length - 1]; }
function formatNumber(value, digits = 1) { return Number(value).toLocaleString('sv-SE', { minimumFractionDigits: digits, maximumFractionDigits: digits }); }
function formatTime(date = new Date()) { return new Intl.DateTimeFormat('sv-SE', { hour: '2-digit', minute: '2-digit' }).format(date); }
function escapeHtml(str) { return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function parseJsonPayload(payload) { if (Array.isArray(payload)) return payload; if (payload && Array.isArray(payload.places)) return payload.places; if (payload && Array.isArray(payload.aliases)) return payload.aliases; return []; }

async function loadJson(path) { const response = await fetch(asset(path), { cache: 'force-cache' }); if (!response.ok) throw new Error(`Could not load ${path}`); return response.json(); }

async function loadSearchData() {
  const [canonical, localAreas, backlog, abroad, aliases, cityPages] = await Promise.all([
    loadJson('sweden-places.json'),
    loadJson('sweden-local-areas-seed.json'),
    loadJson('sweden-local-areas-backlog.json'),
    loadJson('places-abroad-seed.json'),
    loadJson('place-aliases.json'),
    loadJson('city-pages.json'),
    window.SwedenSearch.loadPlaces([
      asset('sweden-places.json'), asset('sweden-local-areas-seed.json'), asset('sweden-local-areas-backlog.json'), asset('places-abroad-seed.json')
    ])
  ]);

  const allPlaces = [
    ...parseJsonPayload(canonical), ...parseJsonPayload(localAreas), ...parseJsonPayload(backlog), ...parseJsonPayload(abroad)
  ];
  const map = new Map();
  allPlaces.forEach(place => { if (place.id) map.set(place.id, place); if (place.canonical_id) map.set(place.canonical_id, place); });
  state.search.placesById = map;
  state.search.aliasEntries = parseJsonPayload(aliases);
  state.cityPages = new Set((cityPages || []).map(page => page.slug));
}

function mergedSearch(query) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];
  const results = [];
  const seen = new Set();
  const push = (place, score = 0) => {
    if (!place) return;
    const key = place.canonical_id || place.id || `${place.name}-${place.label}`;
    if (seen.has(key)) return;
    seen.add(key);
    results.push({ place, score });
  };

  if (window.SwedenSearch?.isLoaded()) {
    window.SwedenSearch.search(q, { limit: 10, minChars: 2 }).forEach((place, index) => push(place, 1000 - index));
  }

  const qFold = q.toLowerCase().replace(/å/g, 'a').replace(/ä/g, 'a').replace(/ö/g, 'o');
  state.search.aliasEntries
    .filter(alias => String(alias.term || '').toLowerCase().replace(/å/g, 'a').replace(/ä/g, 'a').replace(/ö/g, 'o').startsWith(qFold))
    .slice(0, 10)
    .forEach((alias, index) => {
      const place = state.search.placesById.get(alias.canonical_id) || {
        id: alias.canonical_id, canonical_id: alias.canonical_id, name: alias.label?.split(' · ')[0] || alias.term,
        label: alias.label, type: alias.type, route_slug: alias.route_slug
      };
      push(place, 850 - index);
    });

  return results.sort((a, b) => b.score - a.score).slice(0, 12).map(result => result.place);
}

async function geocodeName(name, countryCode = '') {
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.searchParams.set('name', name); url.searchParams.set('count', '1'); url.searchParams.set('language', 'sv'); url.searchParams.set('format', 'json');
  if (countryCode) url.searchParams.set('countryCode', countryCode);
  const response = await fetch(url.toString());
  const data = await response.json();
  return data.results?.[0] || null;
}

async function resolveCoordinates(place) {
  if (typeof place.lat === 'number' && typeof place.lon === 'number') return { lat: place.lat, lon: place.lon, name: place.name || place.label };
  if (place.parent_place_id) {
    const parent = state.search.placesById.get(place.parent_place_id);
    if (parent && typeof parent.lat === 'number' && typeof parent.lon === 'number') return { lat: parent.lat, lon: parent.lon, name: place.name || parent.name };
  }
  const match = await geocodeName(place.name, place.country || '');
  return match ? { lat: match.latitude, lon: match.longitude, name: place.name || match.name } : null;
}

function formatProtectionWindow(hourly) {
  const risky = hourly.filter(item => item.uv >= 3);
  if (!risky.length) return 'Skydd behövs normalt inte';
  return `Skydd rekommenderas kl. ${String(risky[0].hour).padStart(2, '0')}–${String(risky[risky.length - 1].hour).padStart(2, '0')}`;
}

function makeHeroCopy(current, peak, protectionText) {
  if (peak.uv < 3) return `UV-index väntas hålla sig under 3 idag. ${current.cloud > 0 ? `Molnigheten är ungefär ${Math.round(current.cloud)}% just nu.` : 'Klart läge just nu.'}`;
  if (current.uv < 3) return `${protectionText}. Som mest väntas UV nå ${formatNumber(peak.uv)} runt kl ${String(peak.hour).padStart(2, '0')}:00.`;
  return `${protectionText}. Som mest väntas UV nå ${formatNumber(peak.uv)} runt kl ${String(peak.hour).padStart(2, '0')}:00.`;
}

function createTips(currentUv, peakUv, protectionText) {
  if (peakUv < 3) {
    return [
      { icon: '○', title: 'Låg risk idag', copy: 'UV väntas hålla sig under gränsen där de flesta behöver solskydd.' },
      { icon: '☼', title: 'Längre tid ute', copy: 'Vid lång tid utomhus kan solglasögon och vanlig försiktighet ändå vara skönt.' },
      { icon: '↻', title: 'Kolla igen senare', copy: 'Vädret och molnigheten kan ändras under dagen, särskilt på sommaren.' },
    ];
  }
  if (currentUv < 3) {
    return [
      { icon: '☀', title: 'Skydd senare idag', copy: `${protectionText}. Planera solskydd om du ska vara ute då.` },
      { icon: '⌐', title: 'Solglasögon', copy: 'Bra när solen står högt, särskilt mitt på dagen.' },
      { icon: '⌂', title: 'Sök skugga', copy: 'Skugga mitt på dagen minskar exponeringen när UV-index passerar 3.' },
    ];
  }
  return [
    { icon: '☀', title: 'Skydda dig nu', copy: 'Använd solskydd och undvik onödig exponering när solen är som starkast.' },
    { icon: '⌐', title: 'Solglasögon', copy: 'Skydda ögonen när UV-index är 3 eller högre.' },
    { icon: '⌂', title: 'Sök skugga', copy: 'Ta pauser i skugga, särskilt runt dagens topp.' },
  ];
}

function levelColor(uv) { return getLevel(uv).hex; }
function setHeroColor(color) { $('uv-number').style.color = color; $('hero-status').style.color = color; }

function renderChart(hourly) {
  const wrap = $('chart-bars'); wrap.innerHTML = '';
  if (!hourly?.length) { wrap.innerHTML = '<div class="hint" style="width:100%">Ingen data ännu.</div>'; return; }
  const nowHour = new Date().getHours();
  const max = Math.max(1, ...hourly.map(h => h.uv));
  hourly.forEach(item => {
    const col = document.createElement('div'); col.className = 'bar-col'; if (item.hour === nowHour) col.classList.add('current');
    const bar = document.createElement('div'); bar.className = 'bar';
    const heightPct = Math.max(4, (item.uv / max) * 82); bar.style.height = `${heightPct}%`; bar.style.background = levelColor(item.uv); col.style.setProperty('--bar-height', `${heightPct}%`);
    const value = document.createElement('div'); value.className = 'bar-value'; value.textContent = item.uv > 0 ? formatNumber(item.uv) : '0';
    const hour = document.createElement('div'); hour.className = 'bar-hour'; hour.textContent = String(item.hour).padStart(2, '0');
    col.appendChild(value); col.appendChild(bar); col.appendChild(hour); wrap.appendChild(col);
  });
}

function renderTips(currentUv, peakUv, protectionText) {
  $('tips-grid').innerHTML = createTips(currentUv, peakUv, protectionText).map(tip => `
    <div class="tip-item"><div class="tip-icon" aria-hidden="true">${escapeHtml(tip.icon)}</div><div><div class="tip-title">${escapeHtml(tip.title)}</div><div class="tip-copy">${escapeHtml(tip.copy)}</div></div></div>
  `).join('');
}

function updateUI() {
  const data = state.uvData;
  $('location-label').textContent = state.location.name;
  $('updated-at').textContent = formatTime();
  if ($('city-name-inline')) $('city-name-inline').textContent = state.location.name;

  if (!data || !data.hourly?.length) {
    $('uv-number').textContent = '–'; $('hero-status').textContent = 'Kunde inte hämta data'; $('hero-copy').textContent = 'Kontrollera anslutningen och försök igen om en stund.';
    $('protect-value').textContent = '–'; $('peak-value').textContent = '–'; $('cloud-value').textContent = '–'; $('chart-note').textContent = 'Ingen data';
    setHeroColor('#181716'); renderChart([]); renderTips(0, 0, ''); return;
  }
  const nowHour = new Date().getHours();
  const current = data.hourly.reduce((best, item) => Math.abs(item.hour - nowHour) < Math.abs(best.hour - nowHour) ? item : best, data.hourly[0]);
  const peak = data.hourly.reduce((best, item) => item.uv > best.uv ? item : best, data.hourly[0]);
  const level = getLevel(current.uv);
  const protectionText = formatProtectionWindow(data.hourly);
  const markerPct = Math.max(0, Math.min(100, (Math.min(current.uv, 11) / 11) * 100));

  $('uv-number').textContent = formatNumber(current.uv);
  $('hero-status').textContent = level.status;
  $('hero-copy').textContent = makeHeroCopy(current, peak, protectionText);
  $('protect-value').textContent = protectionText;
  $('peak-value').textContent = `${formatNumber(peak.uv)} runt kl ${String(peak.hour).padStart(2, '0')}:00`;
  $('cloud-value').textContent = `${Math.round(current.cloud)}%`;
  $('chart-note').textContent = `Visar dagens utveckling för ${state.location.name}`;
  $('scale-marker').style.left = `${markerPct}%`;
  setHeroColor(level.hex); renderChart(data.hourly); renderTips(current.uv, peak.uv, protectionText);
}

async function loadUvData() {
  const { lat, lon } = state.location;
  $('hero-status').textContent = 'Hämtar data…'; $('hero-copy').textContent = 'Vi laddar dagens UV-prognos för vald plats.';
  try {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', lat); url.searchParams.set('longitude', lon); url.searchParams.set('hourly', 'uv_index,cloud_cover'); url.searchParams.set('timezone', 'auto'); url.searchParams.set('forecast_days', '1');
    const response = await fetch(url.toString()); const json = await response.json();
    const now = new Date(); const pad = n => String(n).padStart(2, '0'); const today = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
    const hourly = (json.hourly?.time || []).map((time, index) => ({ time, hour: Number(time.split('T')[1]?.slice(0,2)), uv: Math.max(0, Math.round((json.hourly.uv_index?.[index] || 0) * 10) / 10), cloud: Number(json.hourly.cloud_cover?.[index] || 0) })).filter(item => item.time.startsWith(today) && item.hour >= 6 && item.hour <= 21);
    state.uvData = { hourly };
  } catch (error) { console.error('UV data error', error); state.uvData = null; }
  updateUI();
}

function openOverlay(id) { $(id).classList.add('open'); document.body.style.overflow = 'hidden'; }
function closeOverlay(id) { $(id).classList.remove('open'); if (![...document.querySelectorAll('.overlay.open')].length) document.body.style.overflow = ''; }

function renderSearchResults(query) {
  const container = $('search-results'); const q = String(query || '').trim();
  if (q.length < 2) { container.innerHTML = '<div class="hint">Skriv minst två bokstäver. Sverige-resultat kommer först, följt av lokala områden, alias och utvalda utlandsplatser.</div>'; return; }
  const results = mergedSearch(q);
  if (!results.length) { container.innerHTML = '<div class="hint">Inga träffar i platsindexet. Prova en större stad eller annan stavning.</div>'; return; }
  container.innerHTML = results.map(place => {
    const id = place.id || place.canonical_id || '';
    const meta = [place.type, place.parent_name || place.county || place.region, place.country_name_sv].filter(Boolean).join(' · ');
    const pageHint = place.route_slug && state.cityPages.has(place.route_slug) ? 'Öppnar lokal UV-sida' : 'Visar UV direkt';
    return `<button class="result-btn" type="button" data-id="${escapeHtml(id)}"><div><div class="result-name">${escapeHtml(place.name || place.label || 'Okänd plats')}</div><div class="result-sub">${escapeHtml(place.label || '')}</div>${meta ? `<div class="result-meta">${escapeHtml(meta)} · ${pageHint}</div>` : ''}</div><div class="result-arrow">›</div></button>`;
  }).join('');
  container.querySelectorAll('.result-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const place = state.search.placesById.get(btn.dataset.id) || mergedSearch(q).find(p => (p.id || p.canonical_id) === btn.dataset.id);
      if (!place) return;
      if (place.route_slug && state.cityPages.has(place.route_slug)) { window.location.href = `${ASSET_BASE}${place.route_slug}/`; return; }
      btn.disabled = true; btn.querySelector('.result-arrow').textContent = '…';
      const resolved = await resolveCoordinates(place);
      if (!resolved) { btn.disabled = false; btn.querySelector('.result-arrow').textContent = '›'; alert('Kunde inte hitta koordinater för platsen just nu.'); return; }
      state.location = { name: place.name || resolved.name, lat: resolved.lat, lon: resolved.lon, route_slug: place.route_slug || '' };
      closeOverlay('search-overlay'); await loadUvData();
    });
  });
}

async function setCurrentPosition() {
  if (!navigator.geolocation) { alert('Din webbläsare stödjer inte geolocation.'); return; }
  navigator.geolocation.getCurrentPosition(async pos => {
    state.location = { name: 'Min position', lat: pos.coords.latitude, lon: pos.coords.longitude, route_slug: '' };
    closeOverlay('search-overlay'); await loadUvData();
  }, () => alert('Kunde inte hämta din position.'), { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
}

function initInstallBanner() {
  if (localStorage.getItem('uvnu-hide-install')) return;
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (standalone) return;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  if (isIOS) { $('install-copy').textContent = 'På iPhone: öppna Dela-menyn i Safari och välj ”Lägg till på hemskärmen”.'; $('install-banner').classList.add('show'); return; }
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); $('install-copy').textContent = 'På Android: använd webbläsarens installera/lägg till på hemskärmen-funktion.'; $('install-banner').classList.add('show'); }, { once: true });
}

function bindEvents() {
  $('location-btn').addEventListener('click', () => { $('search-input').value = ''; renderSearchResults(''); openOverlay('search-overlay'); setTimeout(() => $('search-input').focus(), 40); });
  $('search-close').addEventListener('click', () => closeOverlay('search-overlay'));
  $('gps-btn').addEventListener('click', setCurrentPosition);
  $('install-close').addEventListener('click', () => { $('install-banner').classList.remove('show'); localStorage.setItem('uvnu-hide-install', '1'); });
  $('search-input').addEventListener('input', event => renderSearchResults(event.target.value));
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeOverlay('search-overlay'); });
  document.querySelectorAll('.overlay').forEach(overlay => overlay.addEventListener('click', event => { if (event.target === overlay) closeOverlay(overlay.id); }));
}

async function init() {
  bindEvents(); initInstallBanner(); updateUI();
  try { await loadSearchData(); } catch (error) { console.error('Search data failed to load', error); }
  await loadUvData(); setInterval(loadUvData, 30 * 60 * 1000);
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register(asset('sw.js')).catch(console.error));
}
init();
