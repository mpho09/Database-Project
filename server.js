require("dotenv").config();
const express = require("express");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { fetchAndStoreQuakes } = require("./lib/fetchQuakes");

// --- Fail fast on missing config, instead of a confusing error mid-request ---
const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SECRET_KEY"];
const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`Missing required environment variable(s): ${missing.join(", ")}`);
  process.exit(1);
}

const PORT = Number(process.env.PORT || 3000);
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 5 * 60 * 1000); // default: 5 min

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

const app = express();
app.use(express.static(path.join(__dirname, "public")));

// --- In-memory state shared by both endpoints below ---
let latestQuakes = [];
const sseClients = new Set();

function broadcast(rows) {
  const payload = `data: ${JSON.stringify(rows)}\n\n`;
  for (const res of sseClients) res.write(payload);
}

// Plain JSON snapshot — used for the page's first load.
app.get("/api/earthquakes", (req, res) => {
  res.json(latestQuakes);
});

// Server-Sent Events stream — pushes a new snapshot every time the poll refreshes.
app.get("/api/stream", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(`data: ${JSON.stringify(latestQuakes)}\n\n`);
  sseClients.add(res);

  // Keep the connection alive through proxies/load balancers that
  // close idle connections after ~30-60s.
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

async function refreshQuakes() {
  try {
    const rows = await fetchAndStoreQuakes(supabase);
    latestQuakes = rows;
    broadcast(rows);
    console.log(`[${new Date().toISOString()}] refreshed ${rows.length} earthquakes`);
  } catch (err) {
    // A failed poll should be logged and retried next cycle — never crash the server.
    console.error("Poll failed:", err.message);
  }
}

const server = app.listen(PORT, async () => {
  console.log(`Pulse dashboard running on http://localhost:${PORT}`);
  await refreshQuakes(); // populate immediately instead of waiting for the first interval
  setInterval(refreshQuakes, POLL_INTERVAL_MS);
});

// Close SSE connections cleanly instead of leaving clients hanging on shutdown/deploy.
process.on("SIGTERM", () => {
  for (const res of sseClients) res.end();
  server.close(() => process.exit(0));
});