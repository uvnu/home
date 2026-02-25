// /assets/js/main.js
function weatherApp() {
    return {
        apiKey: 'eb45ab32159d3a2bb8369a2dfc5be8bb',
        city: 'Stockholm',
        inputCity: '',
        lat: 59.3293,
        lon: 18.0686,
        current: { temp: '--', precip: '--', uvi: '--' },
        hourly: [],
        recommendations: ['SPF 30+', 'Hatt', 'Solglasögon'],
        currentHour: new Date().getHours(),

        init() {
            this.fetchWeather();
            this.autoDetectLocation();
        },

        autoDetectLocation() {
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(pos => {
                    this.lat = pos.coords.latitude;
                    this.lon = pos.coords.longitude;
                    this.fetchWeather();
                });
            }
        },

        updateCity() {
            if (this.inputCity.trim() === '') return;
            fetch(`https://api.openweathermap.org/data/2.5/weather?q=${this.inputCity},SE&appid=${this.apiKey}`)
                .then(res => res.json())
                .then(data => {
                    this.city = data.name;
                    this.lat = data.coord.lat;
                    this.lon = data.coord.lon;
                    this.fetchWeather();
                    this.inputCity = '';
                });
        },

        fetchWeather() {
            fetch(`https://api.openweathermap.org/data/3.0/onecall?lat=${this.lat}&lon=${this.lon}&units=metric&appid=${this.apiKey}`)
                .then(res => res.json())
                .then(data => {
                    this.current.temp = data.current.temp.toFixed(1);
                    this.current.precip = data.hourly[0].pop ? Math.round(data.hourly[0].pop * 100) : 0;
                    this.hourly = data.hourly.slice(0, 12).map(h => ({ dt: new Date(h.dt * 1000).getHours(), uvi: h.uvi }));
                });
        },

        getUVColor(uvi) {
            if(uvi <= 2) return '#FFD700';
            if(uvi <= 5) return '#FFA500';
            if(uvi <= 7) return '#FF4500';
            if(uvi <= 10) return '#FF0000';
            return '#8B0000';
        }
    }
}
