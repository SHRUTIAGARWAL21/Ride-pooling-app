// The MAP for ride routes. Connects URLs to controllers, behind guards.

import { Router } from "express";
import { estimateRides, createRide } from "../controllers/ride.controller.js";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";

const router = Router();

// STEP 1: quote all vehicle options + fares. Creates nothing.
// POST (not GET) because it carries structured pickup/dropoff input in a body.
router.post("/estimate", requireAuth, requireRole("rider"), estimateRides);

// STEP 2: book the chosen option. Full URL: POST /api/rides
router.post("/", requireAuth, requireRole("rider"), createRide);

export { router as rideRouter };
