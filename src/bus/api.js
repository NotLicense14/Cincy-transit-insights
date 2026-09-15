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

// Pattern lookup — for Go-Metro, shape geometry comes from the static GTFS
// index (data/gtfs/index.json) rather than a live API call. This stub
// maintains the same interface so callers don't need to change.
async function getPattern(pid) {
  const { getTripMeta } = require('../shared/gtfs');
  const meta = getTripMeta(pid);
  if (!meta) throw new Error(`No pattern found for pid ${pid}`);
  return meta;
}

module.exports = {
  getVehicles,
  getVehiclesCachedOrFresh,
  getPattern,
};
