// The RECEPTIONIST for rides. Reads req, validates, calls the service, replies.

import { createRideForRider } from "../services/ride.service.js";
import {
  estimateAllFares,
  isKnownVehicleType,
} from "../services/fare.service.js";
import { dispatchRideRequest } from "../sockets/dispatch.js";

// Latitude ranges -90..90; longitude -180..180. Number.isFinite blocks
// NaN/Infinity/strings.
function isValidLat(n) {
  return typeof n === "number" && Number.isFinite(n) && n >= -90 && n <= 90;
}
function isValidLng(n) {
  return typeof n === "number" && Number.isFinite(n) && n >= -180 && n <= 180;
}
function isValidPoint(p) {
  return (
    p &&
    isValidLat(p.lat) &&
    isValidLng(p.lng) &&
    typeof p.address === "string" &&
    p.address.trim().length > 0
  );
}

// Shared point validation used by both handlers below.
function validatePoints(pickup, dropoff) {
  const errors = [];
  if (!isValidPoint(pickup))
    errors.push("pickup must have a valid lat, lng, and address");
  if (!isValidPoint(dropoff))
    errors.push("dropoff must have a valid lat, lng, and address");
  return errors;
}

// STEP 1 of the flow: the quote. Read-only — it creates NO ride. It just
// returns every vehicle option with its fare, so the rider can choose.
export async function estimateRides(req, res) {
  const { pickup, dropoff } = req.body ?? {};

  const errors = validatePoints(pickup, dropoff);
  if (errors.length > 0) {
    return res
      .status(400)
      .json({ error: "Validation failed", details: errors });
  }

  // Pure calculation, so no try/catch around a database call is needed.
  const result = estimateAllFares(pickup, dropoff);
  return res.json(result);
}

// STEP 2 of the flow: booking. Now requires the CHOSEN vehicleType.
export async function createRide(req, res) {
  const { pickup, dropoff, vehicleType } = req.body ?? {};

  const errors = validatePoints(pickup, dropoff);
  // Validate the choice against the types we actually price.
  if (!isKnownVehicleType(vehicleType))
    errors.push("vehicleType must be one of: car, auto, bike");
  if (errors.length > 0) {
    return res
      .status(400)
      .json({ error: "Validation failed", details: errors });
  }

  try {
    // riderId comes from the TOKEN, never the body. vehicleType is the only
    // pricing input we take from the client — the fare itself is computed here.
    const { ride, distanceKm } = await createRideForRider({
      riderId: req.user.id,
      pickup,
      dropoff,
      vehicleType,
    });

    // Push the offer to online drivers of this type. It is a side-effect:
    // wrapped so a socket hiccup can never fail a booking that already saved.
    try {
      dispatchRideRequest(ride);
    } catch (e) {
      console.error("dispatch failed:", e);
    }

    return res.status(201).json({ ride, distanceKm });
  } catch (err) {
    console.error("createRide error:", err);
    return res.status(500).json({ error: "Something went wrong" });
  }
}
