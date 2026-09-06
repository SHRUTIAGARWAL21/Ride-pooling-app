// Distance + fare math. Pure functions — no database, no HTTP. Easy to test.

import { config } from "../config/env.js";

const EARTH_RADIUS_KM = 6371;

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

// Haversine: great-circle (straight-line over the globe) distance in km.
// An estimate — it ignores real roads. We replace it with Google later.
export function haversineKm(a, b) {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return EARTH_RADIUS_KM * 2 * Math.asin(Math.sqrt(h));
}

// Is this a vehicle type we actually price? Derived from the fare table, so
// the enum, the table, and this check can never drift apart.
export function isKnownVehicleType(type) {
  return Object.prototype.hasOwnProperty.call(config.fares, type);
}

// Price for a known distance and one vehicle type. Returns a 2-decimal STRING
// (money as exact text for the Decimal column, never a drifting Float).
function fareForDistance(distanceKm, vehicleType) {
  const rates = config.fares[vehicleType];
  const fare = rates.baseFare + distanceKm * rates.perKmRate;
  return fare.toFixed(2);
}

// One type: used by booking, to price the ride the rider chose.
export function estimateFare(pickup, dropoff, vehicleType) {
  const distanceKm = haversineKm(pickup, dropoff);
  return {
    distanceKm: Number(distanceKm.toFixed(2)),
    fareTotal: fareForDistance(distanceKm, vehicleType),
  };
}

// ALL types: used by the quote screen. We measure distance ONCE, then apply
// each type's rates — cheaper than measuring three times.
export function estimateAllFares(pickup, dropoff) {
  const distanceKm = haversineKm(pickup, dropoff);
  const options = Object.keys(config.fares).map((vehicleType) => ({
    vehicleType,
    fare: fareForDistance(distanceKm, vehicleType),
  }));
  return { distanceKm: Number(distanceKm.toFixed(2)), options };
}
