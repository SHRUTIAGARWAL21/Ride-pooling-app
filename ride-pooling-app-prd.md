# PRD — Ride-Sharing Web App with In-Trip Consent-Based Pooling

_Version 1.0 — September 2026_

**How to use this doc:** Build in phase order (1 → 4). Point Claude Code at one phase section at a time rather than the whole document at once — each phase is scoped to be independently buildable and testable before moving to the next.

---

## 1. Overview

A web-based ride-hailing app (rider + driver views) where a booked private ride can be upgraded mid-trip into a shared ride. Sharing requires explicit consent from the driver and the currently seated passenger, and only riders whose pickup/drop-off fall on the vehicle's _remaining_ route are shown the option to join. Fare splits evenly across all current occupants once a match is confirmed.

## 2. Tech stack

| Layer               | Choice                                                        |
| ------------------- | ------------------------------------------------------------- |
| Frontend            | React + Vite, Tailwind CSS                                    |
| Real-time client    | socket.io-client                                              |
| Backend             | Node.js + Express                                             |
| Real-time server    | socket.io                                                     |
| ORM                 | Prisma                                                        |
| Database            | PostgreSQL + PostGIS extension                                |
| Live location cache | Redis                                                         |
| Maps                | Google Maps JavaScript API + Directions API + Geolocation API |
| Geospatial math     | Turf.js                                                       |
| Auth                | JWT + bcrypt                                                  |
| Payments            | Stripe test mode (or Razorpay test mode)                      |
| Hosting             | Vercel (client), Render/Railway (server, Postgres, Redis)     |
| Testing             | Vitest                                                        |

## 3. User roles

- **Rider** — requests rides, can toggle sharing on an active ride, can request to join a shareable ride.
- **Driver** — accepts ride requests, can approve/reject incoming pool requests, sends live location.

No admin role in v1.

## 4. Data model

```
User
  id            uuid, pk
  name          string
  email         string, unique
  phone         string
  password_hash string
  role          enum(rider, driver)
  created_at    timestamp

Driver (1:1 with User where role=driver)
  user_id                uuid, fk -> User
  vehicle_type            enum(car, auto)
  vehicle_number          string
  is_open_to_pooling      boolean, default false
  current_lat             float, nullable
  current_lng             float, nullable
  last_location_at        timestamp, nullable

Ride
  id                uuid, pk
  driver_id         uuid, fk -> User, nullable until accepted
  status            enum(requested, accepted, in_progress, completed, cancelled)
  is_shareable      boolean, default false
  pickup_lat        float
  pickup_lng        float
  pickup_address    string
  dropoff_lat       float
  dropoff_lng       float
  dropoff_address   string
  route_polyline    text            -- encoded polyline from Directions API
  fare_total        decimal
  created_at        timestamp
  started_at        timestamp, nullable
  completed_at      timestamp, nullable

RidePassenger  (one row per rider in a ride — supports pooled rides with multiple riders)
  id            uuid, pk
  ride_id       uuid, fk -> Ride
  rider_id      uuid, fk -> User
  pickup_lat    float
  pickup_lng    float
  dropoff_lat   float
  dropoff_lng   float
  fare_share    decimal, nullable   -- set once ride completes
  joined_at     timestamp

PoolRequest   (a new rider's request to join an in-progress shareable ride)
  id                  uuid, pk
  ride_id             uuid, fk -> Ride
  requesting_rider_id uuid, fk -> User
  pickup_lat          float
  pickup_lng          float
  dropoff_lat         float
  dropoff_lng         float
  driver_approved     boolean, nullable
  passenger_approved  boolean, nullable
  status              enum(pending, confirmed, rejected)
  created_at          timestamp
```

## 5. Phase 1 — Core ride booking (build this first)

**Scope:** Standard private ride booking, no pooling yet.

**Screens**

- Auth: register / login
- Rider home: pickup + dropoff input (Google Places autocomplete), fare estimate, "Request ride" button
- Rider active-ride view: live map with driver marker moving, route polyline, driver ETA
- Driver home: toggle online/offline, list of nearby ride requests, accept button
- Driver active-ride view: live map, "Start ride" / "Complete ride" buttons

**API endpoints**

```
POST   /api/auth/register
POST   /api/auth/login
GET    /api/auth/me

POST   /api/rides                  body: {pickup, dropoff} -> creates Ride (status=requested)
GET    /api/rides/:id
GET    /api/rides/available         driver: nearby requested rides
PATCH  /api/rides/:id/accept        driver accepts
PATCH  /api/rides/:id/start
PATCH  /api/rides/:id/complete
PATCH  /api/rides/:id/cancel
```

**Socket.io events**

```
client -> server   driver:updateLocation   {rideId, lat, lng}   (emit every 3-5s while driving)
server -> client    driver:location         {rideId, lat, lng}   (relayed to the rider in that ride)
server -> client    ride:status             {rideId, status}
```

**Fare calculation:** distance (from Directions API) × per-km rate + base fare. Keep this a simple fixed formula for v1 — no surge pricing.

**Done when:** a rider can book a ride, a driver can accept it, both see each other move live on the map along the route, and the ride can be completed with a fare shown.

---

## 6. Phase 2 — Sharing toggle

**Scope:** Add the ability to mark an in-progress ride as shareable. No matching logic yet — just the toggle and state.

**Changes**

- Add "Open to sharing" toggle in the rider's active-ride view, enabled only after `status = in_progress`.
- Add "Accept shared rides" toggle in the driver's home screen (standing preference).
- `PATCH /api/rides/:id/toggle-sharing` — sets `Ride.is_shareable`. Only allowed if `status = in_progress` and `Driver.is_open_to_pooling = true`.

**Done when:** a rider mid-ride can flip sharing on, and it persists and is visible to the driver.

---

## 7. Phase 3 — Matching logic (the core differentiator)

**Scope:** When a new rider requests a ride, check whether any currently shareable ride is a viable match before creating a brand-new solo ride.

**Algorithm (v1 — corridor-buffer check, not full detour-time calculation):**

```
On POST /api/rides (new ride request with pickup, dropoff):

1. Find candidate rides:
   SELECT rides WHERE status = 'in_progress' AND is_shareable = true
   AND driver.current location is within ~5km of new pickup   (cheap pre-filter)

2. For each candidate ride:
   a. Get the driver's current position (lat, lng) from Redis.
   b. Decode Ride.route_polyline into a line (Turf.js lineString).
   c. Use turf.nearestPointOnLine(route, currentPosition) to find how far along
      the route the car currently is (the "location" property, in km).
   d. Use turf.lineSliceAlong(route, currentLocationKm, routeTotalLengthKm)
      to get the REMAINING route (only the part ahead of the car).
   e. Buffer the remaining route by a fixed corridor width (e.g. turf.buffer(remainingRoute, 0.4, {units: 'kilometers'})).
   f. Check turf.booleanPointInPolygon(newPickup, corridor) AND
            turf.booleanPointInPolygon(newDropoff, corridor).
   g. Check ordering: nearestPointOnLine(remainingRoute, newPickup).location <
                       nearestPointOnLine(remainingRoute, newDropoff).location
      (pickup must come before dropoff along the remaining path).
   h. If all checks pass -> candidate is a valid match.

3. Return candidate matches to the requesting rider alongside the option to
   book a normal solo ride instead.
```

**API endpoints**

```
POST   /api/rides          -- now also returns { matches: [...] } if any exist
POST   /api/rides/:id/join-request   body: {pickup, dropoff} -> creates PoolRequest
GET    /api/pool-requests/:id
```

**Config:** corridor width and max pre-filter radius should be environment-configurable constants, not hardcoded, so they're easy to tune later.

**Done when:** requesting a ride near an active shareable ride's remaining route surfaces it as a joinable match; requesting one behind the car or far off-route does not.

---

## 8. Phase 4 — Consent flow + fare split

**Scope:** Turn a matched `PoolRequest` into an actual confirmed passenger, requiring both driver and current passenger approval, and split the fare.

**Flow**

1. New rider sends `join-request` → `PoolRequest` created with `status = pending`.
2. Server emits `pool:request` via socket to the driver and to all current `RidePassenger`s on that ride.
3. Driver and passenger each respond via `PATCH /api/pool-requests/:id/respond` `{role, approve: true|false}`.
4. If either rejects → `status = rejected`, requesting rider notified via `pool:rejected`.
5. If both approve → `status = confirmed`, a new `RidePassenger` row is created, and `pool:confirmed` is emitted to everyone in the ride with the updated occupant count.
6. On `PATCH /api/rides/:id/complete`, calculate `fare_total / (number of RidePassenger rows)` and set `fare_share` on each.

**Socket.io events**

```
server -> client   pool:request     {poolRequestId, rideId, pickup, dropoff, riderName}
client -> server   pool:respond     {poolRequestId, role: 'driver'|'passenger', approve}
server -> client   pool:confirmed   {rideId, newRider, occupantCount}
server -> client   pool:rejected    {poolRequestId}
```

**Done when:** a full pooling cycle works end to end — new rider requests, driver and passenger both approve, new rider is added to the trip, and on completion every rider sees an equal fare share.

---

## 9. Stretch goals (after phases 1–4 work)

- Replace straight corridor-buffer matching with a real detour-time cap (call Directions API with the extra stop and compare added ETA).
- SOS button + live trip-sharing link for a rider's emergency contact (no login required to view).
- Small analytics view: pooling adoption rate, average detour time added, total savings generated.
- Driver document verification flow (upload placeholder for now).

## 10. Explicitly out of scope for v1

- Native mobile apps (web only, responsive layout is enough).
- Real money movement (payment integration stays in test/sandbox mode).
- Surge/dynamic pricing.
- Detour-time-based matching (v1 uses the corridor-buffer approach only — see stretch goals).
- Admin dashboard.
- Multi-language support.

## 11. Non-functional requirements

- Passwords hashed with bcrypt; JWT for session auth; never expose the Google Maps server-side key to the client (use a separate restricted browser key for client-side calls).
- Driver location updates every 3–5 seconds; matching check should complete in well under 1 second for a reasonable number of concurrently active shareable rides (tens, not thousands, for this project's scale).
- All API keys and secrets via environment variables, never committed to the repo.

## 12. Suggested repo structure

```
/client                 React + Vite app
  /src
    /components
    /pages
    /hooks
    /services            api calls + socket client setup
/server                  Node + Express app
  /src
    /routes
    /controllers
    /services            matching engine, maps service, fare calculation
    /sockets
  /prisma
    schema.prisma
```

## 13. Environment variables needed

```
DATABASE_URL=
REDIS_URL=
JWT_SECRET=
GOOGLE_MAPS_SERVER_KEY=
GOOGLE_MAPS_BROWSER_KEY=
STRIPE_SECRET_KEY=        (or RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET)
PORT=
CLIENT_URL=
```
