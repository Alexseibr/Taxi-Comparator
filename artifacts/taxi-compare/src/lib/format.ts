export function formatPrice(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatTime(minutes: number) {
  return `${Math.round(minutes)} min`;
}

export function formatDistance(km: number) {
  return `${km.toFixed(1)} km`;
}
