/**
 * Today's forecast, from Open-Meteo.
 *
 * Chosen because it needs no API key and no account — the only piece of this
 * stack with nothing to sign up for. That matters more than it sounds: the
 * daily screen is the one that has to work every morning without ceremony, and
 * a key that expires is a morning it doesn't.
 *
 * Two decisions worth knowing:
 *
 * The forecast is reduced over *waking hours*, not the calendar day. A 24-hour
 * minimum is usually 4am, which is a temperature nobody dresses for. Reducing
 * over 07:00–21:00 answers the question actually being asked, which is what
 * it will feel like while you are outside in these clothes.
 *
 * It reduces on `apparent_temperature` rather than the air temperature, for
 * the same reason. 8°C in still sun and 8°C in wind want different coats, and
 * Open-Meteo has already done the wind-and-humidity arithmetic — so taking its
 * answer is both more correct and less code than a wind rule of our own.
 */

/** The waking window the forecast is reduced over, in local hours. */
const DAY_START_HOUR = 7;
const DAY_END_HOUR = 21;

export type Forecast = {
  /** Coldest it will feel while you're out, °C. Drives the layering rules. */
  feelsLikeMin: number;
  /** Warmest it will feel while you're out, °C. */
  feelsLikeMax: number;
  /** Plain air temperature range, for display. */
  tempMin: number;
  tempMax: number;
  /** 0–100, the peak chance of rain across the window. */
  precipChance: number;
  /** km/h, the peak gust across the window. */
  windMax: number;
  /** WMO weather code at its worst across the window. */
  code: number;
  /** A short phrase for the screen: "cold, rain likely". */
  summary: string;
  /** Where this was for, echoed back so the screen can name it. */
  placeName: string | null;
};

/**
 * WMO weather codes, collapsed to the distinctions that change what you wear.
 *
 * The full table separates "slight drizzle" from "moderate drizzle", which is
 * not a distinction any wardrobe makes. Everything wet is wet.
 */
function describeCode(code: number): string {
  if (code >= 95) return "thunderstorms";
  if (code >= 85) return "snow showers";
  if (code >= 80) return "showers";
  if (code >= 71) return "snow";
  if (code >= 61) return "rain";
  if (code >= 51) return "drizzle";
  if (code >= 45) return "fog";
  if (code >= 1) return "cloud";
  return "clear";
}

/**
 * How the temperature reads in wardrobe language.
 *
 * These bands are the same ones the composition rules key off, named here once
 * so the sentence on the screen and the decision behind it can never disagree.
 */
export function describeTemperature(feelsLike: number): string {
  if (feelsLike <= 0) return "freezing";
  if (feelsLike <= 7) return "cold";
  if (feelsLike <= 13) return "chilly";
  if (feelsLike <= 19) return "mild";
  if (feelsLike <= 25) return "warm";
  return "hot";
}

type HourlyResponse = {
  hourly?: {
    time?: string[];
    temperature_2m?: number[];
    apparent_temperature?: number[];
    precipitation_probability?: (number | null)[];
    weather_code?: number[];
    wind_speed_10m?: number[];
  };
};

export class WeatherUnavailable extends Error {}

/**
 * Fetches and reduces today's forecast.
 *
 * Cached for 30 minutes. A forecast that is half an hour stale has never
 * changed anyone's coat, and the daily screen is refreshed far more often than
 * the weather moves — mostly by the user tapping between occasions.
 */
export async function getForecast(
  lat: number,
  lon: number,
  placeName: string | null = null,
): Promise<Forecast> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", lat.toFixed(4));
  url.searchParams.set("longitude", lon.toFixed(4));
  url.searchParams.set(
    "hourly",
    "temperature_2m,apparent_temperature,precipitation_probability,weather_code,wind_speed_10m",
  );
  // `timezone=auto` makes the returned timestamps local to the coordinates, so
  // "hour 7" below means 7am where the clothes are, not 7am UTC.
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", "1");

  const response = await fetch(url, {
    next: { revalidate: 1_800 },
    signal: AbortSignal.timeout(8_000),
  }).catch(() => {
    throw new WeatherUnavailable("Couldn't reach the forecast.");
  });

  if (!response.ok) {
    throw new WeatherUnavailable(`Forecast service answered ${response.status}.`);
  }

  const payload = (await response.json()) as HourlyResponse;
  const hourly = payload.hourly;
  const times = hourly?.time ?? [];

  if (times.length === 0) {
    throw new WeatherUnavailable("Forecast came back empty.");
  }

  // Indices inside the waking window. Falls back to the whole day if the
  // response is shaped unexpectedly, so a strange payload degrades to a
  // slightly worse forecast rather than to no screen at all.
  let indices = times
    .map((time, index) => ({ hour: Number(time.slice(11, 13)), index }))
    .filter(({ hour }) => hour >= DAY_START_HOUR && hour <= DAY_END_HOUR)
    .map(({ index }) => index);
  if (indices.length === 0) indices = times.map((_, index) => index);

  const at = (series: (number | null)[] | undefined, index: number) => {
    const value = series?.[index];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };

  const collect = (series: (number | null)[] | undefined) =>
    indices
      .map((index) => at(series, index))
      .filter((value): value is number => value !== null);

  const apparent = collect(hourly?.apparent_temperature);
  const actual = collect(hourly?.temperature_2m);
  const precip = collect(hourly?.precipitation_probability);
  const wind = collect(hourly?.wind_speed_10m);
  const codes = collect(hourly?.weather_code);

  if (apparent.length === 0 && actual.length === 0) {
    throw new WeatherUnavailable("Forecast carried no temperatures.");
  }

  // If apparent temperature is missing, the air temperature is the honest
  // fallback — it is the same question asked less precisely.
  const feels = apparent.length > 0 ? apparent : actual;
  const air = actual.length > 0 ? actual : apparent;

  const feelsLikeMin = Math.round(Math.min(...feels));
  const precipChance = precip.length > 0 ? Math.round(Math.max(...precip)) : 0;
  // Max, not modal: the worst weather of the day is what you have to have
  // dressed for, because you can't go home and change.
  const code = codes.length > 0 ? Math.max(...codes) : 0;

  const conditions = describeCode(code);
  // "chilly, rain likely" reads better than "chilly, rain, 70%" — the number is
  // only worth saying when it's genuinely uncertain.
  const wet = code >= 51;
  const summary = [
    describeTemperature(feelsLikeMin),
    wet && precipChance >= 60
      ? `${conditions} likely`
      : wet
        ? `${conditions} possible`
        : conditions,
  ].join(", ");

  return {
    feelsLikeMin,
    feelsLikeMax: Math.round(Math.max(...feels)),
    tempMin: Math.round(Math.min(...air)),
    tempMax: Math.round(Math.max(...air)),
    precipChance,
    windMax: wind.length > 0 ? Math.round(Math.max(...wind)) : 0,
    code,
    summary,
    placeName,
  };
}

/**
 * Turns a typed place name into coordinates, using Open-Meteo's geocoder.
 *
 * Also keyless. Settings uses this so the location can be typed rather than
 * requiring the browser's geolocation prompt — which is the right default on a
 * laptop that thinks it lives at its ISP's exchange.
 */
export type GeocodeHit = {
  name: string;
  admin1: string | null;
  country: string | null;
  latitude: number;
  longitude: number;
};

export async function geocode(query: string): Promise<GeocodeHit[]> {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", query.slice(0, 80));
  url.searchParams.set("count", "5");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");

  const response = await fetch(url, {
    next: { revalidate: 86_400 },
    signal: AbortSignal.timeout(8_000),
  }).catch(() => {
    throw new WeatherUnavailable("Couldn't reach the place lookup.");
  });

  if (!response.ok) throw new WeatherUnavailable("Place lookup failed.");

  const payload = (await response.json()) as {
    results?: {
      name?: string;
      admin1?: string;
      country?: string;
      latitude?: number;
      longitude?: number;
    }[];
  };

  return (payload.results ?? [])
    .filter(
      (hit): hit is Required<Pick<typeof hit, "latitude" | "longitude">> & typeof hit =>
        typeof hit.latitude === "number" && typeof hit.longitude === "number",
    )
    .map((hit) => ({
      name: hit.name ?? query,
      admin1: hit.admin1 ?? null,
      country: hit.country ?? null,
      latitude: hit.latitude,
      longitude: hit.longitude,
    }));
}

/** "Brooklyn, New York, United States" — what Settings shows after a lookup. */
export function describePlace(hit: GeocodeHit) {
  return [hit.name, hit.admin1, hit.country].filter(Boolean).join(", ");
}
