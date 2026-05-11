import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  EXTERNAL_OBSERVATIONS_PATH,
  loadUserTrips,
  parseObservationsFile,
  type Observation,
} from "@/lib/observations";

async function fetchExternalObservations(): Promise<Observation[]> {
  const url = `${import.meta.env.BASE_URL}${EXTERNAL_OBSERVATIONS_PATH}`;
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) {
    if (res.status === 404) return [];
    throw new Error(`HTTP ${res.status} при загрузке observations.json`);
  }
  const json = await res.json();
  const { items } = parseObservationsFile(json, "external");
  return items;
}

export function useExternalObservations() {
  return useQuery({
    queryKey: ["observations", "external"],
    queryFn: fetchExternalObservations,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

export function useUserTrips(): Observation[] {
  const [trips, setTrips] = useState<Observation[]>(() => loadUserTrips());

  useEffect(() => {
    const refresh = () => setTrips(loadUserTrips());
    window.addEventListener("pzk:user-trips-changed", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("pzk:user-trips-changed", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  return trips;
}

export function useAllObservations(): Observation[] {
  const ext = useExternalObservations();
  const user = useUserTrips();
  return [...(ext.data ?? []), ...user];
}
