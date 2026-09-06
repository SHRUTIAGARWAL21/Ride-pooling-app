// Reusable GUARDS. Put them in front of any route that needs protection.
// requireAuth  -> "are you logged in?"      (401 if not)
// requireRole  -> "are you the right role?" (403 if not)

import { verifyToken } from "../utils/jwt.js";

export function requireAuth(req, res, next) {
  // The client sends the token in the Authorization header, by convention:
  //   Authorization: Bearer <token>
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  // 401 = "Unauthorized" — you are not authenticated.
  if (scheme !== "Bearer" || !token) {
    return res
      .status(401)
      .json({ error: "Missing or malformed Authorization header" });
  }

  try {
    // Valid signature + not expired -> we trust the payload.
    const payload = verifyToken(token);
    // Attach who-is-asking to the request so later handlers can use it.
    req.user = { id: payload.sub, role: payload.role };
    // next() hands control to the next function in the chain.
    next();
  } catch (err) {
    // Tampered, forged, or expired token all land here.
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// requireRole is a FACTORY: you call it with the allowed roles, and it RETURNS
// a middleware. That lets us write requireRole("rider") or requireRole("driver")
// on each route. It must run AFTER requireAuth, which sets req.user.
export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    // req.user.role came from the signed token, so we can trust it.
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      // 403 = "Forbidden": we know who you are, you just may not do this.
      return res
        .status(403)
        .json({ error: "You are not allowed to perform this action" });
    }
    next();
  };
}
