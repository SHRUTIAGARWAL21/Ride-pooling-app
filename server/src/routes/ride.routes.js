// The MAP for ride routes. Connects URLs to controllers, behind guards.

import { Router } from "express";
import {
  estimateRides,
  createRide,
  acceptRide,
  startRide,
  cancelRide,
} from "../controllers/ride.controller.js";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";

const router = Router();

// STEP 1: quote all vehicle options + fares. Creates nothing.
// POST (not GET) because it carries structured pickup/dropoff input in a body.
router.post("/estimate", requireAuth, requireRole("rider"), estimateRides);

// STEP 2: book the chosen option. Full URL: POST /api/rides
router.post("/", requireAuth, requireRole("rider"), createRide);

// A driver claims a requested ride. Full URL: PATCH /api/rides/:id/accept
router.patch("/:id/accept", requireAuth, requireRole("driver"), acceptRide);

// A driver starts the ride they accepted. accepted -> in_progress.
router.patch("/:id/start", requireAuth, requireRole("driver"), startRide);

// Cancel a ride. BOTH roles allowed; the controller branches on role:
// driver -> re-open (re-dispatch); rider -> terminate.
router.patch("/:id/cancel", requireAuth, cancelRide);

export { router as rideRouter };
