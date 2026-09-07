// The RECEPTIONIST for driver profiles. Talks HTTP; validates; calls the worker.

import {
  upsertDriverProfile,
  getDriverProfile,
} from "../services/driver.service.js";
// Reuse the same "is this a real vehicle type?" check the ride code uses,
// so the rules can never drift apart.
import { isKnownVehicleType } from "../services/fare.service.js";

// PUT /api/drivers/me — register or update the logged-in driver's vehicle.
// PUT (not POST) because it is idempotent: sending the same body twice leaves
// the profile in the same final state. That matches upsert perfectly.
export async function putDriverProfile(req, res) {
  const { vehicleType, vehicleNumber } = req.body ?? {};

  const errors = [];
  if (!isKnownVehicleType(vehicleType))
    errors.push("vehicleType must be one of: car, auto, bike");
  if (
    !vehicleNumber ||
    typeof vehicleNumber !== "string" ||
    vehicleNumber.trim().length < 4
  )
    errors.push("vehicleNumber is required");
  if (errors.length > 0) {
    return res.status(400).json({ error: "Validation failed", details: errors });
  }

  try {
    // req.user.id comes from the token — the driver edits only THEIR profile.
    const driver = await upsertDriverProfile({
      userId: req.user.id,
      vehicleType,
      vehicleNumber,
    });
    return res.json({ driver });
  } catch (err) {
    // P2002 = unique constraint failed. Here it means the plate is already
    // registered to some other driver. 409 = Conflict.
    if (err.code === "P2002") {
      return res
        .status(409)
        .json({ error: "That vehicle number is already registered" });
    }
    console.error("putDriverProfile error:", err);
    return res.status(500).json({ error: "Something went wrong" });
  }
}

// GET /api/drivers/me — read the logged-in driver's own profile.
export async function getMyDriverProfile(req, res) {
  const driver = await getDriverProfile(req.user.id);
  if (!driver) {
    // Valid driver account, but they have not registered a vehicle yet.
    return res.status(404).json({ error: "No driver profile yet" });
  }
  return res.json({ driver });
}
