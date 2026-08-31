/**
 * lib/fetchQuakes.js
 *
 * Pulls the USGS daily feed, optionally attaches Open-Meteo weather to the
 * strongest quakes, upserts into Supabase, then reads back the current
 * top 200 so the caller always returns the real state of the table
 * (not just "whatever USGS happened to send this poll").
 */

const USGS_FEED_URL =
  "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson";

async function fetchQuakes() {
  const res = await fetch(USGS_FEED_URL);
  if (!res.ok) throw new Error(`USGS fetch failed: ${res.status}`);
  const data = await res.json();

  return data.features.map((f) => {
    const [lng, lat, depth] = f.geometry.coordinates;
    return {
      id: f.id,
      magnitude: f.properties.mag,
      place: f.properties.place,
      latitude: lat,
      longitude: lng,
      depth_km: depth,
      event_time: new Date(f.properties.time).toISOString(),
    };
  });
}

async function attachWeather(rows, limit = 20) {
  const topRows = [...rows]
    .sort((a, b) => (b.magnitude ?? 0) - (a.magnitude ?? 0))
    .slice(0, limit);

  const withWeather = await Promise.all(
    topRows.map(async (row) => {
      try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${row.latitude}&longitude=${row.longitude}&current_weather=true`;
        const res = await fetch(url);
        if (!res.ok) return row;
        const json = await res.json();
        return {
          ...row,
          weather_temp_c: json.current_weather ? json.current_weather.temperature : null,
          weather_wind_kmh: json.current_weather ? json.current_weather.windspeed : null,
        };
      } catch {
        return row; // one failed weather lookup shouldn't drop the earthquake itself
      }
    })
  );

  const topIds = new Set(topRows.map((r) => r.id));
  const untouched = rows.filter((r) => !topIds.has(r.id));
  return [...withWeather, ...untouched];
}

async function fetchAndStoreQuakes(supabase, { includeWeather = true } = {}) {
  let rows = await fetchQuakes();
  if (includeWeather) rows = await attachWeather(rows);

  const { error: upsertError } = await supabase
    .from("earthquakes")
    .upsert(rows, { onConflict: "id" });
  if (upsertError) throw upsertError;

  // Read back from the DB rather than returning `rows` directly, so the
  // dashboard reflects the real source of truth (e.g. rows from an earlier
  // poll that have since aged out of USGS's rolling 24h feed).
  const { data, error: readError } = await supabase
    .from("earthquakes")
    .select("*")
    .order("event_time", { ascending: false })
    .limit(200);
  if (readError) throw readError;

  return data;
}

module.exports = { fetchAndStoreQuakes };
