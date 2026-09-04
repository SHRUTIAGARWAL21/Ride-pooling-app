// A reusable GUARD. Put it in front of any route that needs a logged-in user.
// If the token is good, it attaches req.user and calls next() to continue.
// If not, it stops the request with 401 and the handler never runs.

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
    // Every protected route can now read req.user without re-checking.
    req.user = { id: payload.sub, role: payload.role };
    // next() hands control to the next function in the chain (the handler).
    next();
  } catch (err) {
    // Tampered, forged, or expired token all land here.
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
