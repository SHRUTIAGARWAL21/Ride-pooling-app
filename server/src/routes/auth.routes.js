// The MAP layer. It only connects URLs to controller functions.
// A Router is a mini-app you can mount under a path prefix (see app.js).

import { Router } from "express";
import { register, login, me } from "../controllers/auth.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = Router();

// Public routes — no token needed. These are how you GET a token.
router.post("/register", register); // POST /api/auth/register
router.post("/login", login); //    POST /api/auth/login

// Protected route — requireAuth runs before "me". If the token is bad,
// requireAuth sends 401 and "me" never runs. This is middleware chaining:
// Express calls them left to right, each deciding whether to continue.
router.get("/me", requireAuth, me); // GET /api/auth/me

export { router as authRouter };
