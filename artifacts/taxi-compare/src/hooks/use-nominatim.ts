import React, { useState, useEffect, useRef } from "react";

interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
}

export interface Place {
  label: string;
  coordinate: {
    lat: number;
    lng: number;
  };
}

export function useNominatim() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    setLoading(true);
    setError(null);

    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=5&q=${encodeURIComponent(
            query
          )}`
        );
        if (!res.ok) {
          throw new Error("Failed to fetch address");
        }
        const data: NominatimResult[] = await res.json();
        setResults(
          data.map((item) => ({
            label: item.display_name,
            coordinate: {
              lat: parseFloat(item.lat),
              lng: parseFloat(item.lon),
            },
          }))
        );
      } catch (err: any) {
        setError(err.message || "An error occurred");
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 350);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  return { query, setQuery, results, loading, error };
}
