/**
 * Lightweight geo helpers — no external mapping API required.
 * Distance is straight-line (haversine), which is a reasonable approximation
 * for short in-city tiffin routes and needs no paid routing API / API key.
 */

const AVERAGE_SCOOTER_SPEED_KMPH = 18; // conservative city/traffic average for a delivery scooter

function haversineDistanceKm(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371; // Earth radius in km
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function estimateEtaMinutes(distanceKm) {
  if (distanceKm <= 0) return 0;
  // +4 min buffer for parking / handoff at the door
  return Math.round((distanceKm / AVERAGE_SCOOTER_SPEED_KMPH) * 60 + 4);
}

module.exports = { haversineDistanceKm, estimateEtaMinutes };
