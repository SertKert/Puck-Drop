#!/usr/bin/env node
// Fetch NHL data and write static files consumed by the frontend.
//   data/teams.csv              — one row per team, with conference/division
//   data/rosters/<abbrev>.csv   — one row per player on that team
//   data/players/<id>.json      — full per-player landing payload from NHL API
//
// Run: node scripts/fetch-data.js

const fs = require('fs');
const path = require('path');

const API = 'https://api-web.nhle.com/v1';
const ROOT = path.resolve(__dirname, '..');

// Home-arena coordinates for each NHL team. NHL API doesn't expose these,
// so we keep a hardcoded lookup. Used by V2's map UI.
const TEAM_COORDS = {
  ANA: [33.8078, -117.8767], BOS: [42.3662, -71.0621], BUF: [42.8750, -78.8765],
  CGY: [51.0375, -114.0519], CAR: [35.8032, -78.7218], CHI: [41.8807, -87.6742],
  COL: [39.7486, -105.0077], CBJ: [39.9695, -83.0061], DAL: [32.7906, -96.8103],
  DET: [42.3411, -83.0552], EDM: [53.5469, -113.4977], FLA: [26.1585, -80.3255],
  LAK: [34.0430, -118.2673], MIN: [44.9447, -93.1011], MTL: [45.4960, -73.5693],
  NSH: [36.1592, -86.7785], NJD: [40.7336, -74.1711], NYI: [40.7230, -73.7238],
  NYR: [40.7505, -73.9934], OTT: [45.2969, -75.9271], PHI: [39.9012, -75.1720],
  PIT: [40.4394, -79.9892], SJS: [37.3327, -121.9012], SEA: [47.6221, -122.3540],
  STL: [38.6267, -90.2027], TBL: [27.9427, -82.4519], TOR: [43.6434, -79.3791],
  UTA: [40.7683, -111.9011], VAN: [49.2778, -123.1090], VGK: [36.1029, -115.1784],
  WSH: [38.8981, -77.0210], WPG: [49.8928, -97.1436],
};
const DATA = path.join(ROOT, 'data');
const ROSTERS = path.join(DATA, 'rosters');
const PLAYERS = path.join(DATA, 'players');

// Small concurrency helper so we don't hammer the NHL API.
async function pool(items, size, worker) {
  const results = new Array(items.length);
  let i = 0;
  const runners = Array.from({ length: size }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      results[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return results;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function getJson(url, { retries = 5 } = {}) {
  let delay = 1000;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, { redirect: 'follow' });
    if (res.ok) return res.json();
    if (res.status === 429 || res.status >= 500) {
      if (attempt === retries) throw new Error(`${res.status} ${url} (after ${retries} retries)`);
      const retryAfter = parseFloat(res.headers.get('retry-after') || '0') * 1000;
      await sleep(Math.max(retryAfter, delay));
      delay = Math.min(delay * 2, 30000);
      continue;
    }
    throw new Error(`${res.status} ${url}`);
  }
}

// Minimal CSV escape: wrap in quotes if value contains comma/quote/newline; double-up embedded quotes.
function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function csvRow(cells) { return cells.map(csvCell).join(','); }

function ensureDirs() {
  for (const d of [DATA, ROSTERS, PLAYERS]) fs.mkdirSync(d, { recursive: true });
}

async function fetchTeams() {
  const data = await getJson(`${API}/standings/now`);
  const teams = data.standings.map(t => {
    const abbrev = t.teamAbbrev.default;
    const coords = TEAM_COORDS[abbrev] || [null, null];
    return {
      abbrev,
      name: t.teamName?.default || t.teamCommonName?.default || t.placeName.default,
      placeName: t.placeName.default,
      commonName: t.teamCommonName?.default || '',
      conference: t.conferenceName,
      conferenceAbbrev: t.conferenceAbbrev,
      division: t.divisionName,
      divisionAbbrev: t.divisionAbbrev,
      logo: t.teamLogo || '',
      latitude: coords[0] ?? '',
      longitude: coords[1] ?? '',
    };
  });
  teams.sort((a, b) =>
    a.conference.localeCompare(b.conference) ||
    a.division.localeCompare(b.division) ||
    a.name.localeCompare(b.name));

  const header = ['abbrev','name','placeName','commonName','conference','conferenceAbbrev','division','divisionAbbrev','logo','latitude','longitude'];
  const rows = [csvRow(header), ...teams.map(t => csvRow(header.map(h => t[h])))];
  fs.writeFileSync(path.join(DATA, 'teams.csv'), rows.join('\n') + '\n');
  console.log(`wrote data/teams.csv (${teams.length} teams)`);
  return teams;
}

async function fetchRoster(teamAbbrev) {
  const r = await getJson(`${API}/roster/${teamAbbrev}/current`);
  const all = [...(r.forwards || []), ...(r.defensemen || []), ...(r.goalies || [])];
  return all.map(p => ({
    id: p.id,
    firstName: p.firstName?.default || '',
    lastName: p.lastName?.default || '',
    fullName: `${p.firstName?.default || ''} ${p.lastName?.default || ''}`.trim(),
    sweaterNumber: p.sweaterNumber ?? '',
    positionCode: p.positionCode || '',
    shootsCatches: p.shootsCatches || '',
    heightInInches: p.heightInInches ?? '',
    weightInPounds: p.weightInPounds ?? '',
    birthDate: p.birthDate || '',
    birthCountry: p.birthCountry || '',
    headshot: p.headshot || '',
  }));
}

async function writeRosterCsv(teamAbbrev, roster) {
  const header = ['id','firstName','lastName','fullName','sweaterNumber','positionCode','shootsCatches','heightInInches','weightInPounds','birthDate','birthCountry','headshot'];
  const rows = [csvRow(header), ...roster.map(p => csvRow(header.map(h => p[h])))];
  fs.writeFileSync(path.join(ROSTERS, `${teamAbbrev}.csv`), rows.join('\n') + '\n');
}

async function fetchPlayer(id, { skipIfExists = false } = {}) {
  const out = path.join(PLAYERS, `${id}.json`);
  if (skipIfExists && fs.existsSync(out)) return 'skipped';
  const data = await getJson(`${API}/player/${id}/landing`);
  fs.writeFileSync(out, JSON.stringify(data));
  return 'fetched';
}

async function main() {
  ensureDirs();
  const teams = await fetchTeams();

  // Roster per team (concurrency 6)
  const rosters = await pool(teams, 6, async (t) => {
    try {
      const roster = await fetchRoster(t.abbrev);
      await writeRosterCsv(t.abbrev, roster);
      console.log(`  roster ${t.abbrev}: ${roster.length} players`);
      return roster;
    } catch (e) {
      console.error(`  roster ${t.abbrev} FAILED: ${e.message}`);
      return [];
    }
  });

  // Unique player IDs (a player could appear on more than one roster mid-trade)
  const playerIds = [...new Set(rosters.flat().map(p => p.id))];
  console.log(`fetching ${playerIds.length} player profiles…`);

  const resume = process.argv.includes('--resume');
  let fetched = 0, skipped = 0, fail = 0, done = 0;
  await pool(playerIds, 2, async (id) => {
    try {
      const r = await fetchPlayer(id, { skipIfExists: resume });
      if (r === 'skipped') skipped++; else { fetched++; await sleep(150); }
    } catch (e) { fail++; console.error(`  player ${id} FAILED: ${e.message}`); }
    done++;
    if (done % 50 === 0) console.log(`  players progress: ${done}/${playerIds.length}`);
  });
  console.log(`players: ${fetched} fetched, ${skipped} skipped, ${fail} failed`);

  // Write a tiny manifest so the frontend can show a "last updated" timestamp.
  const playerCount = fs.readdirSync(PLAYERS).filter(f => f.endsWith('.json')).length;
  fs.writeFileSync(path.join(DATA, 'manifest.json'),
    JSON.stringify({ updatedAt: new Date().toISOString(), teams: teams.length, players: playerCount }, null, 2));
  console.log('done.');
}

main().catch(e => { console.error(e); process.exit(1); });
