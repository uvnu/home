/**
 * kly-sweden-search.js
 * Canonical Sweden-first search for kly.se.
 *
 * Supports one or many JSON sources. Each source can be either:
 *  - { places: [...] }
 *  - a raw array of place objects
 */
(function (global) {
  "use strict";

  const DEFAULT_LIMIT = 12;

  function normalizeStrict(value) {
    return (value ?? "").toString().toLowerCase().trim();
  }

  function normalizeFolded(value) {
    return normalizeStrict(value)
      .replace(/å/g, "a")
      .replace(/ä/g, "a")
      .replace(/ö/g, "o");
  }

  function typeWeight(type) {
    switch (type) {
      case "major_city": return 1100;
      case "city": return 1040;
      case "town": return 980;
      case "district": return 940;
      case "resort": return 920;
      case "destination": return 900;
      case "island": return 860;
      case "national_park": return 830;
      case "locality": return 800;
      case "municipality": return 650;
      case "abroad_city": return 500;
      default: return 0;
    }
  }

  function placeLabel(place) {
    if (place.label) return place.label;
    if (place.parent_name) return `${place.name} · ${place.parent_name}, ${place.county}`;
    return `${place.name} · ${place.county}`;
  }

  function toArray(payload) {
    if (Array.isArray(payload)) return payload;
    if (payload && Array.isArray(payload.places)) return payload.places;
    throw new Error("Invalid place data format (expected { places: [...] } or an array)");
  }

  function buildSearchTerms(place) {
    return [
      place.name,
      place.label,
      ...(place.aliases || []),
      ...(place.search_names || []),
    ].filter(Boolean);
  }

  function scoreMatch(place, query, queryFolded, queryHasDiacritics) {
    const terms = buildSearchTerms(place);
    let bestTier = -1;
    let bestTermBonus = 0;

    for (const term of terms) {
      const strict = normalizeStrict(term);

      if (strict.startsWith(query)) {
        const isPrimaryName = normalizeStrict(place.name) === strict;
        bestTier = Math.max(bestTier, isPrimaryName ? 5 : 4);
        bestTermBonus = Math.max(bestTermBonus, isPrimaryName ? 90 : 40);
        continue;
      }

      if (!queryHasDiacritics) {
        const folded = normalizeFolded(term);
        if (folded.startsWith(queryFolded)) {
          const isPrimaryName = normalizeFolded(place.name) === folded;
          bestTier = Math.max(bestTier, isPrimaryName ? 3 : 2);
          bestTermBonus = Math.max(bestTermBonus, isPrimaryName ? 30 : 10);
        }
      }
    }

    if (bestTier < 0) return null;

    const population = typeof place.population === "number" ? place.population : 0;
    const manualBoost = Number.isFinite(place.search_priority) ? place.search_priority : 0;

    return (
      bestTier * 10000 +
      bestTermBonus * 100 +
      typeWeight(place.type) +
      manualBoost +
      Math.min(250, population / 1000)
    );
  }

  const KlySwedenSearch = {
    _places: [],
    _loaded: false,

    async loadPlaces(jsonUrlOrUrls) {
      const urls = Array.isArray(jsonUrlOrUrls) ? jsonUrlOrUrls : [jsonUrlOrUrls];
      const payloads = await Promise.all(
        urls.map(async (url) => {
          const res = await fetch(url, { cache: "force-cache" });
          if (!res.ok) throw new Error(`Failed to load places: ${res.status}`);
          return toArray(await res.json());
        })
      );

      this._places = payloads.flat();
      this._loaded = true;
      return this._places.length;
    },

    isLoaded() {
      return this._loaded;
    },

    getPlaces() {
      return this._places;
    },

    search(query, options = {}) {
      const limit = Number.isFinite(options.limit) ? options.limit : DEFAULT_LIMIT;
      const minChars = Number.isFinite(options.minChars) ? options.minChars : 2;
      const includeHidden = !!options.includeHidden;

      if (!query) return [];
      const raw = query.toString();
      if (raw.trim().length < minChars) return [];

      const qStrict = normalizeStrict(raw);
      const qFolded = normalizeFolded(raw);
      const queryHasDiacritics = /[åäö]/i.test(raw);
      const bestByCanonical = new Map();

      for (const place of this._places) {
        if (!includeHidden && place.search_hidden) continue;

        const score = scoreMatch(place, qStrict, qFolded, queryHasDiacritics);
        if (score === null) continue;

        const key = place.canonical_id || place.id || `${place.name}-${place.county}`;
        const current = bestByCanonical.get(key);
        if (!current || score > current.score) {
          bestByCanonical.set(key, { place, score });
        }
      }

      return [...bestByCanonical.values()]
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((item) => item.place);
    },

    label(place) {
      return placeLabel(place);
    }
  };

  global.KlySwedenSearch = KlySwedenSearch;
})(window);
