// Country-wise currency display, verified via real GPS location (not just
// the phone's locale setting) -- asks for foreground location permission
// once on load, reverse-geocodes to a country, and maps that to a
// currency. If permission is denied or location is unavailable, this falls
// back to the phone's locale (Intl), so the feature still works, just less
// precisely. The conversion rate itself is a real live rate fetched from a
// free, no-key exchange-rate API, cached for the session; a static table
// is only the fallback while that fetch is in flight or if it fails
// (offline, API down).
import * as Location from "expo-location";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const RATES_URL = "https://open.er-api.com/v6/latest/USD";

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  INR: "₹",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  AUD: "A$",
  CAD: "C$",
  AED: "AED ",
  SGD: "S$",
};

// Only used until the live rate loads, or if the fetch fails outright.
const FALLBACK_RATES: Record<string, number> = {
  USD: 1,
  INR: 87,
  EUR: 0.92,
  GBP: 0.79,
  JPY: 149,
  AUD: 1.52,
  CAD: 1.36,
  AED: 3.67,
  SGD: 1.34,
};

const REGION_CURRENCY: Record<string, string> = {
  US: "USD",
  IN: "INR",
  GB: "GBP",
  DE: "EUR",
  FR: "EUR",
  ES: "EUR",
  IT: "EUR",
  NL: "EUR",
  IE: "EUR",
  JP: "JPY",
  AU: "AUD",
  CA: "CAD",
  AE: "AED",
  SG: "SGD",
};

function currencyForCountry(countryCode: string | null | undefined): string | null {
  if (!countryCode) return null;
  return REGION_CURRENCY[countryCode.toUpperCase()] ?? null;
}

function localeCurrencyCode(): string {
  try {
    const locale = Intl.NumberFormat().resolvedOptions().locale;
    const region = locale.split("-")[1];
    return currencyForCountry(region) ?? "USD";
  } catch {
    return "USD";
  }
}

interface CurrencyState {
  code: string;
  symbol: string;
  rateLoaded: boolean;
  formatUSD: (amountUsd: number) => string;
}

const CurrencyContext = createContext<CurrencyState | null>(null);

export function CurrencyProvider({ children }: { children: ReactNode }) {
  // Locale is the instant fallback; GPS (once permission resolves) overrides it.
  const [code, setCode] = useState(localeCurrencyCode);
  const [rate, setRate] = useState<number>(FALLBACK_RATES[localeCurrencyCode()] ?? 1);
  const [rateLoaded, setRateLoaded] = useState(code === "USD");

  // Verify the country via real GPS rather than trusting the phone's locale alone.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") return;

        const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
        const places = await Location.reverseGeocodeAsync({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });

        const geoCurrency = currencyForCountry(places[0]?.isoCountryCode);
        if (!cancelled && geoCurrency) setCode(geoCurrency);
      } catch {
        // Denied, no GPS fix, or reverse geocoding failed -- keep the
        // locale-based currency already set above.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch the real, current rate for whichever currency we've settled on.
  useEffect(() => {
    setRate(FALLBACK_RATES[code] ?? 1);
    if (code === "USD") {
      setRateLoaded(true);
      return;
    }
    setRateLoaded(false);
    let cancelled = false;
    fetch(RATES_URL)
      .then((res) => res.json())
      .then((data) => {
        const live = data?.rates?.[code];
        if (!cancelled) {
          if (typeof live === "number") setRate(live);
          setRateLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setRateLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  const symbol = CURRENCY_SYMBOLS[code] ?? "$";

  function formatUSD(amountUsd: number): string {
    const converted = Math.round(amountUsd * rate);
    const sign = converted < 0 ? "-" : "";
    return `${sign}${symbol}${Math.abs(converted).toLocaleString()}`;
  }

  return <CurrencyContext.Provider value={{ code, symbol, rateLoaded, formatUSD }}>{children}</CurrencyContext.Provider>;
}

export function useCurrency(): CurrencyState {
  const ctx = useContext(CurrencyContext);
  if (!ctx) throw new Error("useCurrency must be used within CurrencyProvider");
  return ctx;
}
