// server.js
//
// Three jobs:
//  1. Let an admin add bus stops (name, lat, lon) -> saved in data/stops.json
//  2. Let an admin tie a student to a bus (student_id -> bus_id) -> data/assignments.json
//  3. Accept live bus location updates (this is the endpoint your future
//     "fake bus" program will call repeatedly) -> data/busLocations.json
//
// The student page reads its own assigned bus, polls that bus's current
// location, and calculates the distance itself (same Haversine logic
// from before) to decide when to show the "bus has arrived" notification.

const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 3001;

const DATA_DIR = path.join(__dirname, "data");
const STOPS_FILE = path.join(DATA_DIR, "stops.json");
const ASSIGNMENTS_FILE = path.join(DATA_DIR, "assignments.json");
const BUS_LOCATIONS_FILE = path.join(DATA_DIR, "busLocations.json");
const LOG_FILE = path.join(__dirname, "activity.log");

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ---------- tiny file-based storage helpers ----------
function readJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch (e) {
    return fallback;
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function log(line) {
  const timestamp = new Date().toISOString();
  fs.appendFileSync(LOG_FILE, `[${timestamp}] ${line}\n`);
}

// Make sure the data files exist on first run
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(STOPS_FILE)) writeJSON(STOPS_FILE, []);
if (!fs.existsSync(ASSIGNMENTS_FILE)) writeJSON(ASSIGNMENTS_FILE, {});
if (!fs.existsSync(BUS_LOCATIONS_FILE)) writeJSON(BUS_LOCATIONS_FILE, {});

// ---- Haversine formula: real-world distance between two lat/lon points ----
function toRadians(deg) {
  return deg * (Math.PI / 180);
}

function haversineDistance(p1, p2) {
  const R = 6371000; // Earth's radius in meters
  const lat1 = toRadians(p1.lat);
  const lat2 = toRadians(p2.lat);
  const dLat = toRadians(p2.lat - p1.lat);
  const dLon = toRadians(p2.lon - p1.lon);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // meters
}

// =================== STOPS (admin only) ===================

// Admin adds a new stop
app.post("/api/stops", (req, res) => {
  const { name, lat, lon } = req.body;

  if (!name || typeof lat !== "number" || typeof lon !== "number") {
    return res.status(400).json({ error: "name, lat and lon are required" });
  }

  const stops = readJSON(STOPS_FILE, []);
  const newStop = {
    id: "stop_" + Date.now(),
    name,
    lat,
    lon,
    createdAt: new Date().toISOString(),
  };
  stops.push(newStop);
  writeJSON(STOPS_FILE, stops);

  log(`STOP_ADDED  name="${name}"  lat=${lat}  lon=${lon}`);
  res.json({ ok: true, stop: newStop, allStops: stops });
});

// Anyone can view the list of stops (used by the admin page to show the table)
app.get("/api/stops", (req, res) => {
  res.json(readJSON(STOPS_FILE, []));
});

// Admin deletes a stop
app.delete("/api/stops/:id", (req, res) => {
  const stops = readJSON(STOPS_FILE, []);
  const filtered = stops.filter((s) => s.id !== req.params.id);
  writeJSON(STOPS_FILE, filtered);
  log(`STOP_DELETED  id=${req.params.id}`);
  res.json({ ok: true, allStops: filtered });
});

// =================== STUDENT <-> BUS + STOP ASSIGNMENT (admin only) ===================
// A student is now tied to TWO things: the bus they ride, and the stop
// they board/alight at. We compare the bus's live position against that
// fixed stop's position — the student's own location is no longer used.

// Admin assigns a student to a bus AND a stop
app.post("/api/assign", (req, res) => {
  const { studentId, busId, stopId } = req.body;

  if (!studentId || !busId || !stopId) {
    return res.status(400).json({ error: "studentId, busId and stopId are all required" });
  }

  const stops = readJSON(STOPS_FILE, []);
  const stopExists = stops.some((s) => s.id === stopId);
  if (!stopExists) {
    return res.status(400).json({ error: "That stopId does not exist. Add the stop first." });
  }

  const assignments = readJSON(ASSIGNMENTS_FILE, {});
  assignments[studentId] = { busId, stopId };
  writeJSON(ASSIGNMENTS_FILE, assignments);

  log(`ASSIGNED  student="${studentId}"  ->  bus="${busId}"  stop="${stopId}"`);
  res.json({ ok: true, assignments });
});

// View all assignments (admin page table)
app.get("/api/assignments", (req, res) => {
  res.json(readJSON(ASSIGNMENTS_FILE, {}));
});

// The main endpoint the student page uses: given a studentId, work out
// their assigned bus + stop, and return the live distance between them.
app.get("/api/bus-stop-distance/:studentId", (req, res) => {
  const assignments = readJSON(ASSIGNMENTS_FILE, {});
  const assignment = assignments[req.params.studentId];

  if (!assignment) {
    return res.status(404).json({ error: "This student is not assigned to a bus/stop yet." });
  }

  const { busId, stopId } = assignment;

  const stops = readJSON(STOPS_FILE, []);
  const stop = stops.find((s) => s.id === stopId);
  if (!stop) {
    return res.status(404).json({ error: "The assigned stop no longer exists." });
  }

  const busLocations = readJSON(BUS_LOCATIONS_FILE, {});
  const busLoc = busLocations[busId];

  if (!busLoc) {
    return res.json({
      busId,
      stopId,
      stopName: stop.name,
      busLocationKnown: false,
    });
  }

  const distanceMeters = haversineDistance(
    { lat: busLoc.lat, lon: busLoc.lon },
    { lat: stop.lat, lon: stop.lon }
  );

  res.json({
    busId,
    stopId,
    stopName: stop.name,
    busLocationKnown: true,
    distanceMeters,
  });
});

// =================== BUS LOCATION ===================
// This is the endpoint your FUTURE fake-bus emitter program will call
// repeatedly, e.g. every few seconds, with the bus's current coordinates.

app.post("/api/bus-location", (req, res) => {
  const { busId, lat, lon } = req.body;

  if (!busId || typeof lat !== "number" || typeof lon !== "number") {
    return res.status(400).json({ error: "busId, lat and lon are required" });
  }

  const busLocations = readJSON(BUS_LOCATIONS_FILE, {});
  busLocations[busId] = { lat, lon, updatedAt: Date.now() };
  writeJSON(BUS_LOCATIONS_FILE, busLocations);

  log(`BUS_LOCATION  bus="${busId}"  lat=${lat.toFixed(6)}  lon=${lon.toFixed(6)}`);
  res.json({ ok: true });
});

// A student's page polls this to get their assigned bus's current position
app.get("/api/bus-location/:busId", (req, res) => {
  const busLocations = readJSON(BUS_LOCATIONS_FILE, {});
  const loc = busLocations[req.params.busId];

  if (!loc) {
    return res.status(404).json({ error: "No location received for this bus yet." });
  }
  res.json(loc);
});

app.listen(PORT, () => {
  console.log(`\n✅ Server running at http://localhost:${PORT}`);
  console.log(`   Admin page:   http://localhost:${PORT}/admin.html`);
  console.log(`   Student page: http://localhost:${PORT}/student.html`);
  console.log(`   All activity logged to: ${LOG_FILE}\n`);
});
