// The entry point. It wires Express + Socket.io onto ONE HTTP server and starts it.

import http from "node:http"; // Node's built-in HTTP module
import { app } from "./app.js";
import { config } from "./config/env.js";
import { initSocket } from "./sockets/index.js";
import { startSweeper } from "./jobs/sweeper.js";

// Create the HTTP server ourselves, wrapping the Express app. (app.listen()
// would create one internally, but then Socket.io could not share it.)
// "app" is passed as the request handler for all normal HTTP requests.
const server = http.createServer(app);

// Attach the live line (Socket.io) to the SAME server, so both share port 4000.
initSocket(server);

// Start the background sweeper that auto-cancels rides nobody accepted.
// It runs on a timer for the whole life of the server.
startSweeper();

// Start listening. Note we call server.listen(...), NOT app.listen(...) now.
server.listen(config.port, () => {
  console.log(`Server is running at http://localhost:${config.port}`);
  console.log(`Health check: http://localhost:${config.port}/api/health`);
  console.log(`Socket.io is attached on the same port`);
});
