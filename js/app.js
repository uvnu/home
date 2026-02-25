// DOM elements
const cityInput = document.getElementById('cityInput');
const searchBtn = document.getElementById('searchBtn');
const uvValue = document.getElementById('uvValue');
const uvAdvice = document.getElementById('uvAdvice');
const temperature = document.getElementById('temperature');
const weatherDesc = document.getElementById('weatherDesc');

// Map for UV advice
function getUVAdvice(uv) {
  if (uv < 3) return "Låg risk, normalt skydd räcker";
  if (uv < 6) return "Medium risk, solskydd rekommenderas";
  if (uv < 8) return "Hög risk, använd solskydd och skyddskläder";
  return "Mycket hög risk, undvik direkt sol och skydda huden";
}

// Convert city name to coordinates using Open-Meteo geocoding
async function getCoordinates(city) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=sv`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.results && data.results.length > 0) {
    return {
      lat: data.results[0].latitude,
      lon: data.results[0].longitude
    };
  }
  return null;
}

// Fetch weather & UV
async function fetchWeather(city) {
  const coords = await getCoordinates(city);
  if (!coords) {
    alert("Stad ej hittad");
    return;
  }

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&current_weather=true&hourly=uv_index&timezone=Europe/Stockholm`;
  const res = await fetch(url);
  const data = await res.json();

  const uv = data.hourly.uv_index[0]; // first hour as current UV
  const temp = data.current_weather.temperature;
  const desc = `Vind: ${data.current_weather.windspeed} km/h`;

  // Update DOM
  uvValue.textContent = uv.toFixed(1);
  uvAdvice.textContent = getUVAdvice(uv);
  temperature.textContent = `${temp} °C`;
  weatherDesc.textContent = desc;
}

// Event listener
searchBtn.addEventListener('click', () => {
  const city = cityInput.value.trim();
  if (city) fetchWeather(city);
});

// Optionally, fetch default city on load
fetchWeather("Stockholm");
