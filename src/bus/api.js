const axios = require('axios');
const GtfsRealtimeBindings = require('gtfs-realtime-bindings');
const { recordBusObservations, getLatestBusSnapshot } = require('../shared/observations');
const { withRetry } = require('../shared/retry');

// Go-Metro GTFS-realtime feeds — public, unauthenticated protobuf endpoints.
const VEHICLE_POSITIONS_URL =
  'https://tmgtfsprd.sorttrpcloud.com/TMGTFSRealTimeWebService/vehicle/vehiclepositions.pb';

// Fetch and decode the VehiclePositions protobuf feed.
async function fetchVehiclePositions() {
  const { data } = await withRetry(
    () =>
      axios.get(VEHICLE_POSITIONS_URL, {
        responseType: 'arraybuffer',
        timeout: 15000,
      }),
    { label: 'Go-Metro VehiclePositions' },
  );
  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(data));
  return feed.entity || [];
}

// Normalize a GTFS-rt VehiclePosition entity into the shape the rest of the
// codebase expects.
// NOTE: Metro's realtime direction_id is unreliable — always resolve direction
// via getTripMeta(tripId) in src/shared/gtfs.js, never trust this field.
function parseVehicle(entity) {
  const v = entity.vehicle;
  if (!v || !v.position) return null;
  return {
    vid: entity.id,
    route: v.trip?.routeId ?? null,
    // shape_id from the static feed is used as the pattern identifier (pid),
    // resolved via getTripMeta. The live feed doesn't carry it directly.
    pid: v.trip?.tripId ? String(v.trip.tripId) : null,
    lat: v.position.latitude,
    lon: v.position.longitude,
    heading: v.position.bearing != null ? Math.round(v.position.bearing) : null,
    // Metro has no pdist equivalent — recovered by projecting onto the trip's
    // static shape in src/bus/shapeProjection.js.
    pdist: null,
    destination: null,
    delayed: false,
    schedStartSec: null,
    schedStartDate: null,
    tatripid: v.trip?.tripId ? String(v.trip.tripId) : null,
    tmstmp: v.timestamp ? new Date(Number(v.timestamp) * 1000) : new Date(),
  };
}

// Returns all active vehicles, optionally filtered to a set of route IDs.
// `record` controls whether observations are written to the DB (set false for
// diagnostic/timelapse fetches that shouldn't pollute the snapshot cache).
async function getVehicles(routes, { record = true } = {}) {
  const entities = await fetchVehiclePositions();
  const routeSet = routes && routes.length > 0 ? new Set(routes.map(String)) : null;
  const results = [];
  for (const entity of entities) {
    const v = parseVehicle(entity);
    if (!v) continue;
    if (routeSet && !routeSet.has(String(v.route))) continue;
    results.push(v);
  }
  if (record) recordBusObservations(results);
  return results;
}

// Returns `{ vehicles, now, source }`. The 90s maxStaleMs covers the 60s
// observeBuses cadence — bunching/gaps/pulse always hit the cache, so
// observeBuses is the only feed-poll site for the all-routes workload.
async function getVehiclesCachedOrFresh(routes, { maxStaleMs = 90 * 1000 } = {}) {
  const cached = getLatestBusSnapshot(routes, maxStaleMs);
  if (cached && cached.vehicles.length > 0) {
    return { vehicles: cached.vehicles, now: new Date(cached.snapshotTs), source: 'cache' };
  }
  const vehicles = await getVehicles(routes);
  return { vehicles, now: new Date(), source: 'fetch' };
}

// Pattern lookup — constructs pattern geometry from the schedule DB.
// Fetches all stops for a trip, calculates distances, and returns as a pattern object.
async function getPattern(tripId) {
  const Path = require('node:path');
  const Fs = require('fs-extra');
  const Database = require('better-sqlite3');
  const { haversineFt } = require('../shared/geo');
  const { loadIndex } = require('../shared/gtfs');

  const SCHED_DB_PATH =
    process.env.GTFS_SCHEDULE_DB_PATH ||
    Path.join(__dirname, '..', '..', 'data', 'gtfs', 'schedule.sqlite');

  try {
    if (!Fs.existsSync(SCHED_DB_PATH)) {
      throw new Error(`Schedule DB not found at ${SCHED_DB_PATH}`);
    }
    const db = new Database(SCHED_DB_PATH, { readonly: true });
    // Query sched_stops for this trip, ordered by sequence
    const stmt = db.prepare(
      'SELECT route, trip_id, lat, lon, sched_sec FROM sched_stops WHERE trip_id = ? ORDER BY seq ASC',
    );
    const stops = stmt.all(String(tripId));
    db.close();

    if (stops.length < 2) {
      throw new Error(`Trip ${tripId} has < 2 stops in schedule DB`);
    }

    const route = String(stops[0].route);
    const index = loadIndex();
    const byRoute = index.routes?.[route];
    if (!byRoute) {
      throw new Error(`Route ${route} not indexed`);
    }

    // Build points array with distances
    const points = [];
    let totalFt = 0;
    for (let i = 0; i < stops.length; i++) {
      const stop = stops[i];
      let pdist = 0;
      if (i > 0) {
        const prev = stops[i - 1];
        pdist = haversineFt({ lat: prev.lat, lon: prev.lon }, { lat: stop.lat, lon: stop.lon });
        totalFt += pdist;
      }
      points.push({
        type: 'S',
        lat: stop.lat,
        lon: stop.lon,
        pdist: totalFt,
        schedSec: stop.sched_sec,
      });
    }

    // Use direction 0 info from index as template
    const dirInfo = byRoute['0'] || Object.values(byRoute)[0];
    const pattern = {
      pid: String(tripId),
      route,
      direction: '0',
      headsign: dirInfo?.headsign || `Trip ${tripId}`,
      lengthFt: totalFt,
      points,
      // Inherit schedule expectations from the route/direction
      headways: dirInfo?.headways || null,
      durations: dirInfo?.durations || null,
    };

    return pattern;
  } catch (e) {
    throw new Error(`getPattern failed for trip ${tripId}: ${e.message}`);
  }
}

module.exports = {
  getVehicles,
  getVehiclesCachedOrFresh,
  getPattern,
};
