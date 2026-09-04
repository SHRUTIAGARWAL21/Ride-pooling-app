// One place that reads every environment variable the app needs.
// Nothing else in the code reads process.env directly. Why:
//  - If a required value is missing, we fail LOUDLY here, at startup,
//    instead of mysteriously later inside some request.
//  - The rest of the code imports clean values from here, not raw strings.

// Read a variable. If it is missing, stop the whole program with a clear message.
function required(name) {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// Read a variable, but fall back to a default if it is not set.
function optional(name, fallback) {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

export const config = {
  // Number(...) because env values are always strings; the server needs a number.
  port: Number(optional("PORT", "4000")),
  clientUrl: required("CLIENT_URL"),
  // required() means the server refuses to start without a JWT secret —
  // far safer than starting up and signing tokens with "undefined".
  jwtSecret: required("JWT_SECRET"),
};
