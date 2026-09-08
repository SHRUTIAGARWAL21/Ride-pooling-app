// The RECEPTIONIST for rides. Reads req, validates, calls the service, replies.

import {
  createRideForRider,
  acceptRideForDriver,
  startRideByDriver,
  driverCancelRide,
  riderCancelRide,
} from "../services/ride.service.js";
import {
  estimateAllFares,
  isKnownVehicleType,
} from "../services/fare.service.js";
import {
  dispatchRideRequest,
  notifyRideAccepted,
  notifyRideStatus,
} from "../sockets/dispatch.js";

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

// A driver claims a requested ride. PATCH /api/rides/:id/accept
export async function acceptRide(req, res) {
  const rideId = req.params.id; // from the URL (:id)
  const driverId = req.user.id; // from the token (the logged-in driver)

  try {
    const result = await acceptRideForDriver({ rideId, driverId });

    // Map the worker's result to the right HTTP status.
    if (result.status === "no_profile")
      return res
        .status(400)
        .json({ error: "Register a vehicle before accepting rides" });
    if (result.status === "not_found")
      return res.status(404).json({ error: "Ride not found" });
    if (result.status === "conflict")
      return res.status(409).json({ error: "This ride is no longer available" });

    // Success: push the news over sockets (side-effect; never fail the 200).
    // notifyRideAccepted sends the PIN to the RIDER (via ride:accepted).
    try {
      notifyRideAccepted(result.ride);
    } catch (e) {
      console.error("notifyRideAccepted failed:", e);
    }

    // Strip the PIN before replying to the DRIVER — they must never receive it.
    const { startPin, ...rideForDriver } = result.ride;
    return res.json({ ride: rideForDriver });
  } catch (err) {
    console.error("acceptRide error:", err);
    return res.status(500).json({ error: "Something went wrong" });
  }
}

// A driver starts the ride they accepted. PATCH /api/rides/:id/start
export async function startRide(req, res) {
  const rideId = req.params.id;
  const driverId = req.user.id;
  const { pin } = req.body ?? {}; // the PIN the rider gave the driver at pickup
  try {
    const result = await startRideByDriver({ rideId, driverId, pin });
    if (result.status === "not_found")
      return res.status(404).json({ error: "Ride not found" });
    if (result.status === "conflict")
      return res.status(409).json({ error: "This ride cannot be started" });
    if (result.status === "bad_pin")
      return res.status(400).json({ error: "Incorrect PIN" });

    try {
      notifyRideStatus(result.ride); // tell the rider: in_progress
    } catch (e) {
      console.error("notify failed:", e);
    }
    return res.json({ ride: result.ride });
  } catch (err) {
    console.error("startRide error:", err);
    return res.status(500).json({ error: "Something went wrong" });
  }
}

// Cancel a ride. WHO cancels (from the trusted token role) decides what happens:
//   driver -> put the ride back in the pool (re-dispatch)
//   rider  -> terminate the ride
export async function cancelRide(req, res) {
  const rideId = req.params.id;
  try {
    if (req.user.role === "driver") {
      const result = await driverCancelRide({ rideId, driverId: req.user.id });
      if (result.status === "not_found")
        return res.status(404).json({ error: "Ride not found" });
      if (result.status === "conflict")
        return res
          .status(409)
          .json({ error: "This ride can no longer be cancelled" });

      // Back in the pool: re-offer to drivers, and tell the rider we are
      // searching again. Same dispatch function used at first booking.
      try {
        dispatchRideRequest(result.ride);
        notifyRideStatus(result.ride);
      } catch (e) {
        console.error("notify failed:", e);
      }
      return res.json({ ride: result.ride });
    }

    // rider path -> terminate
    const result = await riderCancelRide({ rideId, riderId: req.user.id });
    if (result.status === "not_found")
      return res.status(404).json({ error: "Ride not found" });
    if (result.status === "forbidden")
      return res.status(403).json({ error: "This is not your ride" });
    if (result.status === "conflict")
      return res
        .status(409)
        .json({ error: "This ride can no longer be cancelled" });

    try {
      notifyRideStatus(result.ride); // tell driver (if any) + clear the pool
    } catch (e) {
      console.error("notify failed:", e);
    }
    return res.json({ ride: result.ride });
  } catch (err) {
    console.error("cancelRide error:", err);
    return res.status(500).json({ error: "Something went wrong" });
  }
}
