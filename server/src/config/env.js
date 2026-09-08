// One place that reads every environment variable the app needs.
// Nothing else in the code reads process.env directly. Why:
//  - If a required value is missing, we fail LOUDLY here, at startup.
//  - The rest of the code imports clean values from here, not raw strings.

function required(name) {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name, fallback) {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

export const config = {
  port: Number(optional("PORT", "4000")),
  clientUrl: required("CLIENT_URL"),
  jwtSecret: required("JWT_SECRET"),

  // ---- Fare table: one entry per vehicle type ----
  // Kept in ONE place so prices are easy to tune. The formula per type is:
  //   fare = baseFare + distanceKm * perKmRate
  // A bike is cheapest, an auto mid, a car the most. Numbers are plain
  // currency units. (We can move these to env vars later if we ever need
  // different prices per environment.)
  fares: {
    bike: { baseFare: 15, perKmRate: 6 },
    auto: { baseFare: 25, perKmRate: 9 },
    car: { baseFare: 40, perKmRate: 14 },
  },

  // Timeout sweeper (both configurable). The sweeper cancels a ride that has
  // stayed "requested" (nobody accepted) longer than rideTimeoutMs.
  sweepIntervalMs: Number(optional("SWEEP_INTERVAL_MS", "30000")), // run every 30s
  rideTimeoutMs: Number(optional("RIDE_TIMEOUT_MS", "120000")), // give up after 2 min
};
