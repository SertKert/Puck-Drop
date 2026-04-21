// PuckDrop frontend.
// Loads data/teams.csv + per-team roster CSVs + per-player JSON files.
// No build step, no framework.

const els = {
  conference: document.getElementById('conference-select'),
  division: document.getElementById('division-select'),
  team: document.getElementById('team-select'),
  player: document.getElementById('player-select'),
  profile: document.getElementById('profile'),
  manifestLine: document.getElementById('manifest-line'),
};

let teams = [];        // parsed teams.csv
let rosterCache = {};  // teamAbbrev -> roster array

// --- CSV parsing -----------------------------------------------------------
// Handles quoted cells with embedded commas and escaped quotes (""). No fancy
// edge cases needed — we control the writer in scripts/fetch-data.js.
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false;
      } else cell += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (c === '\r') { /* ignore */ }
      else cell += c;
    }
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows[0];
  return rows.slice(1)
    .filter(r => r.length && r.some(v => v !== ''))
    .map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}
async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

// --- Dropdown population ---------------------------------------------------
function fillSelect(select, options, placeholder = '— select —') {
  select.innerHTML = '';
  const def = document.createElement('option');
  def.value = '';
  def.textContent = placeholder;
  select.appendChild(def);
  for (const opt of options) {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    select.appendChild(o);
  }
}

function populateConferences() {
  const conferences = [...new Set(teams.map(t => t.conference))].sort();
  fillSelect(els.conference, conferences.map(c => ({ value: c, label: c })));
  els.conference.disabled = false;
}

function populateDivisions(conference) {
  const divisions = [...new Set(teams.filter(t => t.conference === conference).map(t => t.division))].sort();
  fillSelect(els.division, divisions.map(d => ({ value: d, label: d })));
  els.division.disabled = divisions.length === 0;
}

function populateTeams(conference, division) {
  const list = teams
    .filter(t => t.conference === conference && t.division === division)
    .sort((a, b) => a.name.localeCompare(b.name));
  fillSelect(els.team, list.map(t => ({ value: t.abbrev, label: t.name })));
  els.team.disabled = list.length === 0;
}

async function populatePlayers(teamAbbrev) {
  els.player.disabled = true;
  fillSelect(els.player, [], 'Loading…');
  let roster = rosterCache[teamAbbrev];
  if (!roster) {
    const csv = await fetchText(`data/rosters/${teamAbbrev}.csv`);
    roster = parseCsv(csv);
    rosterCache[teamAbbrev] = roster;
  }
  // Group by position code for friendlier ordering.
  const positionOrder = { C: 0, L: 1, R: 2, D: 3, G: 4 };
  roster.sort((a, b) => {
    const pa = positionOrder[a.positionCode] ?? 99;
    const pb = positionOrder[b.positionCode] ?? 99;
    if (pa !== pb) return pa - pb;
    return a.lastName.localeCompare(b.lastName);
  });
  fillSelect(els.player, roster.map(p => {
    const num = p.sweaterNumber ? `#${p.sweaterNumber} ` : '';
    return { value: p.id, label: `${num}${p.fullName} (${p.positionCode})` };
  }));
  els.player.disabled = roster.length === 0;
}

// --- Profile rendering -----------------------------------------------------
function fmtHeight(inches) {
  if (!inches) return '—';
  const ft = Math.floor(inches / 12);
  const inch = inches % 12;
  return `${ft}' ${inch}"`;
}
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
function ageFrom(iso) {
  if (!iso) return '—';
  const b = new Date(iso + 'T00:00:00');
  if (isNaN(b)) return '—';
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return String(age);
}
function birthplace(p) {
  const parts = [p.birthCity?.default, p.birthStateProvince?.default, p.birthCountry].filter(Boolean);
  return parts.join(', ') || '—';
}
function pct(v) { return v == null ? '—' : (v * 100).toFixed(1) + '%'; }
function num(v) { return v == null ? '—' : String(v); }

function renderLoading() {
  els.profile.innerHTML = '<p class="loading">Loading player…</p>';
}
function renderError(msg) {
  els.profile.innerHTML = `<p class="error">${msg}</p>`;
}

function kvGrid(pairs) {
  return `<div class="kv-grid">${pairs.map(([k, v]) =>
    `<div class="kv"><span class="key">${k}</span><span class="value">${v}</span></div>`
  ).join('')}</div>`;
}

function renderSkaterStats(p) {
  const cur = p.featuredStats?.regularSeason?.subSeason || {};
  const career = p.careerTotals?.regularSeason || {};
  const playoffs = p.careerTotals?.playoffs;
  const rows = [
    ['Current season', cur],
    ['Career (regular season)', career],
    ...(playoffs && playoffs.gamesPlayed ? [['Career (playoffs)', playoffs]] : []),
  ];
  const cols = ['gamesPlayed','goals','assists','points','plusMinus','pim','shots','shootingPctg','powerPlayGoals','gameWinningGoals'];
  const headers = ['', 'GP','G','A','P','+/-','PIM','SOG','S%','PPG','GWG'];
  const body = rows.map(([label, s]) => {
    const cells = cols.map(c => c === 'shootingPctg' ? pct(s[c]) : num(s[c]));
    return `<tr><td>${label}</td>${cells.map(v => `<td>${v}</td>`).join('')}</tr>`;
  }).join('');
  return `
    <h3 class="section-title">Stats</h3>
    <table class="stats-table">
      <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

function renderGoalieStats(p) {
  const cur = p.featuredStats?.regularSeason?.subSeason || {};
  const career = p.careerTotals?.regularSeason || {};
  const playoffs = p.careerTotals?.playoffs;
  const rows = [
    ['Current season', cur],
    ['Career (regular season)', career],
    ...(playoffs && playoffs.gamesPlayed ? [['Career (playoffs)', playoffs]] : []),
  ];
  const cols = ['gamesPlayed','wins','losses','otLosses','shutouts','goalsAgainstAvg','savePctg'];
  const headers = ['', 'GP','W','L','OTL','SO','GAA','SV%'];
  const body = rows.map(([label, s]) => {
    const cells = cols.map(c => {
      if (c === 'savePctg') return pct(s[c]);
      if (c === 'goalsAgainstAvg') return s[c] == null ? '—' : Number(s[c]).toFixed(2);
      return num(s[c]);
    });
    return `<tr><td>${label}</td>${cells.map(v => `<td>${v}</td>`).join('')}</tr>`;
  }).join('');
  return `
    <h3 class="section-title">Stats</h3>
    <table class="stats-table">
      <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

function renderProfile(p) {
  const name = `${p.firstName?.default || ''} ${p.lastName?.default || ''}`.trim();
  const team = p.fullTeamName?.default || p.currentTeamAbbrev || '';
  const isGoalie = p.position === 'G';

  const bio = kvGrid([
    ['Position', p.position || '—'],
    ['Shoots/Catches', p.shootsCatches || '—'],
    ['Height', fmtHeight(p.heightInInches)],
    ['Weight', p.weightInPounds ? `${p.weightInPounds} lbs` : '—'],
    ['Born', fmtDate(p.birthDate)],
    ['Age', ageFrom(p.birthDate)],
    ['Birthplace', birthplace(p)],
  ]);

  const draft = p.draftDetails
    ? kvGrid([
        ['Draft Year', num(p.draftDetails.year)],
        ['Drafted By', p.draftDetails.teamAbbrev || '—'],
        ['Round', num(p.draftDetails.round)],
        ['Overall Pick', num(p.draftDetails.overallPick)],
      ])
    : '<p class="placeholder" style="margin:0.5rem 0;">Undrafted or no draft data available.</p>';

  const stats = isGoalie ? renderGoalieStats(p) : renderSkaterStats(p);

  els.profile.innerHTML = `
    <div class="profile-header">
      <h2>${name}</h2>
      ${p.sweaterNumber ? `<span class="sweater">#${p.sweaterNumber}</span>` : ''}
      ${p.position ? `<span class="position">${p.position}</span>` : ''}
      <div class="team-line">${team}</div>
    </div>
    <h3 class="section-title">Bio</h3>
    ${bio}
    <h3 class="section-title">Draft</h3>
    ${draft}
    ${stats}
  `;
}

async function onPlayerSelected(playerId) {
  if (!playerId) {
    els.profile.innerHTML = '<p class="placeholder">Make a selection above to view a player\'s profile.</p>';
    return;
  }
  renderLoading();
  try {
    const data = await fetchJson(`data/players/${playerId}.json`);
    renderProfile(data);
  } catch (e) {
    renderError(`Could not load player data (${e.message}). The daily refresh may not have picked up this player yet.`);
  }
}

// --- Event wiring ----------------------------------------------------------
function resetFrom(level) {
  const levels = ['division', 'team', 'player'];
  const start = levels.indexOf(level);
  for (let i = start; i < levels.length; i++) {
    fillSelect(els[levels[i]], []);
    els[levels[i]].disabled = true;
  }
  onPlayerSelected('');
}

els.conference.addEventListener('change', () => {
  resetFrom('division');
  const v = els.conference.value;
  if (v) populateDivisions(v);
});
els.division.addEventListener('change', () => {
  resetFrom('team');
  const c = els.conference.value, d = els.division.value;
  if (c && d) populateTeams(c, d);
});
els.team.addEventListener('change', () => {
  resetFrom('player');
  const t = els.team.value;
  if (t) populatePlayers(t);
});
els.player.addEventListener('change', () => onPlayerSelected(els.player.value));

// --- Boot ------------------------------------------------------------------
async function boot() {
  try {
    const [csv, manifest] = await Promise.all([
      fetchText('data/teams.csv'),
      fetchJson('data/manifest.json').catch(() => null),
    ]);
    teams = parseCsv(csv);
    populateConferences();
    if (manifest?.updatedAt) {
      const d = new Date(manifest.updatedAt);
      els.manifestLine.textContent = `Data last updated ${d.toLocaleString()} · ${manifest.teams} teams · ${manifest.players} players`;
    }
  } catch (e) {
    els.profile.innerHTML = `<p class="error">Failed to load team data: ${e.message}</p>`;
  }
}
boot();
