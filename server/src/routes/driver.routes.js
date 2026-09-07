// The MAP for driver routes. Connects URLs to controllers, behind guards.

import { Router } from "express";
import {
  putDriverProfile,
  getMyDriverProfile,
} from "../controllers/driver.controller.js";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";

const router = Router();

// Both routes are driver-only. "me" always means "the logged-in driver",
// taken from the token — never an id in the URL — so one driver can never
// read or edit another driver's profile.
router.get("/me", requireAuth, requireRole("driver"), getMyDriverProfile);
router.put("/me", requireAuth, requireRole("driver"), putDriverProfile);

export { router as driverRouter };
