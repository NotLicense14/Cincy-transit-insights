// Display names keyed by CTA's `rt` value, sourced from the CTA bustime
// `getroutes` endpoint so every active route is represented — including ones
// we don't currently poll. Sorted by route number; express/letter variants
// group with their base number. Extend the bunching/speedmap/gaps/ghosts
// arrays below to start tracking additional routes without touching this map.
const names = {
  1: 'Mt. Adams',
  10: 'Erie Avenue',
  11: 'Madison Road',
  12: 'Madisonville Commuter',
  16: 'Spring Grove / Daly',
  17: 'Hamilton Avenue',
  19: 'Colerain Avenue',
  2: 'Madeira Commuter',
  20: 'Winton Road',
  21: 'Harrison Avenue',
  22: 'Glenway / Madison',
  '23X': 'Forest Park Express',
  24: 'MLK / Beechmont',
  25: 'Mt. Lookout Commuter',
  27: 'Beekman / Linn',
  28: 'East End',
  '29X': 'Milford Express',
  '3X': 'Montgomery Express',
  30: 'Beechmont Commuter',
  31: 'Taft / McMillan',
  32: 'West 8th Street',
  33: 'Glenway Avenue',
  36: 'Price Hill / Uptown',
  37: 'MLK / Westwood Northern',
  38: 'Uptown Commuter',
  4: 'Montgomery Road',
  40: 'Montana Commuter',
  41: 'North Bend Road',
  43: 'Reading Road',
  46: 'Avondale',
  47: 'Avondale - Oakley',
  49: 'Fairmount',
  5: 'Blue Ash',
  50: 'River Road Commuter',
  51: 'Westwood - Avondale',
  '52X': 'Harrison Express',
  53: 'St. Bernard - Oakley',
  6: 'Queen City Avenue',
  61: 'Galbraith Road',
  64: 'Westwood',
  65: 'Western Hills',
  67: 'Kemper Road',
  70: 'UC Connector',
  '71X': 'Kings Island Express',
  '74X': 'Colerain Express',
  '75X': 'Anderson Express',
  77: 'Delhi',
  78: 'Vine Street',
  8: 'Blue Ash / Silverton Commuter',
  81: 'Mt. Washington Commuter',
  '82X': 'Eastgate Express',
};

// Routes polled for gap detection. Curated to high-frequency routes where
// "no bus for a long stretch" is meaningful content — low-frequency routes
// trip the threshold during normal scheduled gaps.
const gaps = ['17', '33', '43'];

// Routes polled for ghost-bus detection. Independent of bunching/gaps: a
// dedicated observer cron (scripts/observeBuses.js) fetches positions for
// these routes on a fixed cadence so the hourly rollup has consistent coverage
// regardless of what other jobs sampled.
const ghosts = ['17', '33', '43'];

// Routes eligible for the thin-gap detector — median weekday daytime (6 AM–10
// PM) headway > 15 min, the seam where curated `gaps`/`ghosts` coverage ends.
// Regenerate after GTFS refresh: `node scripts/compute-low-frequency-routes.js`.
const lowFrequency = [
  '1',
  '10',
  '11',
  '12',
  '16',
  '19',
  '2',
  '20',
  '21',
  '22',
  '23X',
  '24',
  '25',
  '27',
  '28',
  '29X',
  '3X',
  '30',
  '31',
  '32',
  '36',
  '37',
  '38',
  '4',
  '40',
  '41',
  '46',
  '47',
  '49',
  '5',
  '50',
  '51',
  '52X',
  '53',
  '6',
  '61',
  '64',
  '65',
  '67',
  '70',
  '71X',
  '74X',
  '75X',
  '77',
  '78',
  '8',
  '81',
  '82X',
];

// Every active CTA bus route. Used by observeBuses (the single API call site
// for the all-routes workload), bus pulse, bunching, and speedmap — all four
// read the same snapshot or rotate across the full list, so this list also
// keeps pulse symmetric with bin/bus/alerts.js so a CTA alert and a pulse
// signal can converge on the same thread.
//
// Night Owl routes (N-prefixed) are excluded EXCEPT N5: CTA's getvehicles
// reports overnight vehicles under the daytime route_id (e.g. a 3 AM 87-bus
// comes back as rt: "87"), so polling for "N87" perpetually returns "no data
// found" — only the daytime number ever has live data, even at 3 AM. N5 is
// the lone exception because no daytime "5" route exists; CTA tracks it as
// its own route in both getvehicles and GTFS. Names stay in `names` for
// alert-display lookups (CTA may still issue alerts tagged with N87, etc.).
const allRoutes = Object.keys(names).filter((r) => !/^N\d/.test(r) || r === 'N5');

// The following was taken from Trevin Flickinger:
const shortNames = {
  90: 'M+',
  100: 'The Streetcar',
};

function routeShortName(route) {
  return shortNames[route] || String(route).replace(/^0+(?=\d)/, '');
}

// Bare display label: "Route 2" for numbered routes, or just "CMAX" for
// branded lines whose short name already reads as a full name.
function routeLabel(route) {
  const short = routeShortName(route);
  return short === names[route] ? short : `Route ${short}`;
}

// Full display title with the descriptive name: "Route 2 (E Main/N High)",
// or just "CMAX" (skips the redundant "Route CMAX (CMAX)").
function routeTitle(route) {
  const name = names[route];
  const short = routeShortName(route);
  if (!name || short === name) return routeLabel(route);
  return `Route ${short} (${name})`;
}

module.exports = {
  names,
  gaps,
  ghosts,
  lowFrequency,
  allRoutes,
  routeShortName,
  routeLabel,
  routeTitle,
};
