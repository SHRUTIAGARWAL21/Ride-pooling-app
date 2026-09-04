// The entry point. Its only job: take the built app and start listening.

import { app } from "./app.js";
import { config } from "./config/env.js";

// Start the server. It opens a network port and waits for requests.
// The callback runs once, after the port is open and ready.
app.listen(config.port, () => {
  console.log(`Server is running at http://localhost:${config.port}`);
  console.log(`Health check: http://localhost:${config.port}/api/health`);
});
