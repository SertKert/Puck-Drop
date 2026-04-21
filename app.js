// PuckDrop frontend (V2).
// Team selection via Leaflet map with one marker per NHL team; click a marker
// to load that team's roster. Player dropdown + profile card unchanged from V1,
// except the profile now shows the player's headshot.

const els = {
  map: document.getElementById('map'),
  selectedTeamName: document.getElementById('selected-team-name'),
  player: document.getElementById('player-select'),
  profile: document.getElementById('profile'),
  manifestLine: document.getElementById('manifest-line'),
};

let teams = [];           // parsed teams.csv
let rosterCache = {};     // teamAbbrev -> roster array
let selectedTeamAbbrev = null;

// Division → accent color. Applied to marker backgrounds and the CSS legend
// swatches via a data-attr selector in styles.css.
const DIVISION_COLORS = {
  Atlantic: '#38bdf8',
  Metropolitan: '#a78bfa',
  Central: '#f472b6',
  Pacific: '#fb923c',
};

// --- CSV parsing -----------------------------------------------------------
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

// --- Map -------------------------------------------------------------------
function teamMarkerHtml(team) {
  const color = DIVISION_COLORS[team.division] || '#94a3b8';
  // Inline SVG fetch would be nicer, but <img> with the NHL logo URL works
  // fine inside Leaflet's DivIcon.
  return `<div class="team-marker" style="border-color:${color}" title="${team.name}">
    <img src="${team.logo}" alt="${team.name}" loading="lazy" />
  </div>`;
}

function buildMap() {
  const map = L.map('map', {
    center: [44.0, -96.0],
    zoom: 4,
    minZoom: 3,
    maxZoom: 7,
    worldCopyJump: false,
    scrollWheelZoom: true,
  });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(map);

  for (const t of teams) {
    if (!t.latitude || !t.longitude) continue;
    const lat = parseFloat(t.latitude), lng = parseFloat(t.longitude);
    if (Number.isNaN(lat) || Number.isNaN(lng)) continue;

    const icon = L.divIcon({
      className: 'team-marker-wrap',
      html: teamMarkerHtml(t),
      iconSize: [44, 44],
      iconAnchor: [22, 22],
    });
    const marker = L.marker([lat, lng], { icon, title: t.name }).addTo(map);
    marker.bindTooltip(`${t.name} <span class="tooltip-div">${t.division}</span>`, { direction: 'top', offset: [0, -18] });
    marker.on('click', () => selectTeam(t.abbrev));
  }
}

function selectTeam(abbrev) {
  selectedTeamAbbrev = abbrev;
  const team = teams.find(t => t.abbrev === abbrev);
  els.selectedTeamName.textContent = team ? team.name : abbrev;
  els.selectedTeamName.style.color = team ? (DIVISION_COLORS[team.division] || '') : '';
  onPlayerSelected('');
  populatePlayers(abbrev);
}

// --- Player dropdown -------------------------------------------------------
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

async function populatePlayers(teamAbbrev) {
  els.player.disabled = true;
  fillSelect(els.player, [], 'Loading…');
  let roster = rosterCache[teamAbbrev];
  if (!roster) {
    try {
      const csv = await fetchText(`data/rosters/${teamAbbrev}.csv`);
      roster = parseCsv(csv);
      rosterCache[teamAbbrev] = roster;
    } catch (e) {
      fillSelect(els.player, [], `Failed to load roster: ${e.message}`);
      return;
    }
  }
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
  }), '— select a player —');
  els.player.disabled = roster.length === 0;
}

els.player.addEventListener('change', () => onPlayerSelected(els.player.value));

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
  const cols = ['gamesPlayed','goals','assists','points','plusMinus','pim','shots','shootingPctg','powerPlayGoals','powerPlayPoints','gameWinningGoals','faceoffWinningPctg'];
  const headers = ['', 'GP','G','A','P','+/-','PIM','SOG','S%','PPG','PPP','GWG','FO%'];
  const body = rows.map(([label, s]) => {
    const cells = cols.map(c => (c === 'shootingPctg' || c === 'faceoffWinningPctg') ? pct(s[c]) : num(s[c]));
    return `<tr><td>${label}</td>${cells.map(v => `<td>${v}</td>`).join('')}</tr>`;
  }).join('');
  return `
    <h3 class="section-title">Stats</h3>
    <div class="table-wrap">
    <table class="stats-table">
      <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${body}</tbody>
    </table>
    </div>`;
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
  const cols = ['gamesPlayed','gamesStarted','wins','losses','otLosses','shutouts','goalsAgainst','shotsAgainst','goalsAgainstAvg','savePctg'];
  const headers = ['', 'GP','GS','W','L','OTL','SO','GA','SA','GAA','SV%'];
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
    <div class="table-wrap">
    <table class="stats-table">
      <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${body}</tbody>
    </table>
    </div>`;
}

function renderHonors(p) {
  const badges = [];
  if (p.isActive === true) badges.push('<span class="badge badge-active">Active</span>');
  if (p.isActive === false) badges.push('<span class="badge badge-inactive">Inactive</span>');
  if (p.inHHOF) badges.push('<span class="badge badge-hhof">Hockey Hall of Fame</span>');
  if (p.inTop100AllTime) badges.push('<span class="badge badge-top100">Top 100 All-Time</span>');
  for (const b of (p.badges || [])) {
    const label = typeof b === 'string' ? b : (b?.name?.default || b?.name || b?.title || '');
    if (label) badges.push(`<span class="badge">${label}</span>`);
  }
  const slug = p.playerSlug ? `<span class="slug">${p.playerSlug}</span>` : '';
  if (!badges.length && !slug) return '';
  return `
    <h3 class="section-title">Status & Honors</h3>
    <div class="honors">${badges.join('')}${slug}</div>`;
}

function renderSeasonTotals(p) {
  const all = p.seasonTotals || [];
  if (!all.length) return '';
  const isGoalie = p.position === 'G';

  // Show NHL regular-season rows, newest first. Fall back to all leagues if
  // the player has never played an NHL game (prospects, AHL callups, etc).
  let rows = all.filter(s => s.leagueAbbrev === 'NHL' && s.gameTypeId === 2);
  let scope = 'NHL regular season';
  if (!rows.length) {
    rows = all.filter(s => s.gameTypeId === 2);
    scope = 'All leagues (regular season)';
  }
  if (!rows.length) return '';
  rows.sort((a, b) => b.season - a.season);

  const fmtSeason = (s) => {
    const str = String(s);
    return str.length === 8 ? `${str.slice(0, 4)}–${str.slice(6)}` : str;
  };
  const teamName = (r) => r.teamName?.default || r.teamCommonName?.default || '—';

  const headers = isGoalie
    ? ['Season','Team','GP','GS','W','L','OTL','SO','GA','SA','GAA','SV%']
    : ['Season','Team','GP','G','A','P','+/-','PIM','SOG','S%','PPG','PPP'];

  const body = rows.map(r => {
    const cells = isGoalie ? [
      num(r.gamesPlayed), num(r.gamesStarted), num(r.wins), num(r.losses),
      num(r.otLosses), num(r.shutouts), num(r.goalsAgainst), num(r.shotsAgainst),
      r.goalsAgainstAvg == null ? '—' : Number(r.goalsAgainstAvg).toFixed(2),
      pct(r.savePctg),
    ] : [
      num(r.gamesPlayed), num(r.goals), num(r.assists), num(r.points),
      num(r.plusMinus), num(r.pim), num(r.shots), pct(r.shootingPctg),
      num(r.powerPlayGoals), num(r.powerPlayPoints),
    ];
    return `<tr><td>${fmtSeason(r.season)}</td><td>${teamName(r)}</td>${cells.map(v => `<td>${v}</td>`).join('')}</tr>`;
  }).join('');

  return `
    <h3 class="section-title">Season by Season <span class="section-sub">— ${scope}</span></h3>
    <div class="table-wrap">
    <table class="stats-table">
      <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${body}</tbody>
    </table>
    </div>`;
}

function renderLast5(p) {
  const games = p.last5Games || [];
  if (!games.length) return '';
  const isGoalie = p.position === 'G';
  const headers = isGoalie
    ? ['Date','Opp','H/R','W/L','SA','GA','SV%','TOI']
    : ['Date','Opp','H/R','G','A','P','+/-','PIM','SOG','Shifts','TOI'];

  const body = games.map(g => {
    const opp = g.opponentAbbrev || '—';
    const hr = g.homeRoadFlag || '—';
    if (isGoalie) {
      const decision = g.decision || '—'; // W/L/OTL
      return `<tr>
        <td>${g.gameDate || '—'}</td><td>${opp}</td><td>${hr}</td>
        <td>${decision}</td><td>${num(g.shotsAgainst)}</td><td>${num(g.goalsAgainst)}</td>
        <td>${pct(g.savePctg)}</td><td>${g.toi || '—'}</td>
      </tr>`;
    }
    return `<tr>
      <td>${g.gameDate || '—'}</td><td>${opp}</td><td>${hr}</td>
      <td>${num(g.goals)}</td><td>${num(g.assists)}</td><td>${num(g.points)}</td>
      <td>${num(g.plusMinus)}</td><td>${num(g.pim)}</td><td>${num(g.shots)}</td>
      <td>${num(g.shifts)}</td><td>${g.toi || '—'}</td>
    </tr>`;
  }).join('');

  return `
    <h3 class="section-title">Last 5 Games</h3>
    <div class="table-wrap">
    <table class="stats-table">
      <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${body}</tbody>
    </table>
    </div>`;
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
  const headshot = p.headshot
    ? `<img class="headshot" src="${p.headshot}" alt="${name}" onerror="this.style.display='none'" />`
    : '';
  const teamLogo = p.teamLogo
    ? `<img class="team-logo" src="${p.teamLogo}" alt="${team}" onerror="this.style.display='none'" />`
    : '';

  els.profile.innerHTML = `
    <div class="profile-header">
      ${headshot}
      <div class="profile-head-text">
        <h2>${name}</h2>
        <div class="profile-head-meta">
          ${p.sweaterNumber ? `<span class="sweater">#${p.sweaterNumber}</span>` : ''}
          ${p.position ? `<span class="position">${p.position}</span>` : ''}
          ${teamLogo}
          <span class="team-line">${team}</span>
        </div>
      </div>
    </div>
    ${renderHonors(p)}
    <h3 class="section-title">Bio</h3>
    ${bio}
    <h3 class="section-title">Draft</h3>
    ${draft}
    ${stats}
    ${renderSeasonTotals(p)}
    ${renderLast5(p)}
  `;
}

async function onPlayerSelected(playerId) {
  if (!playerId) {
    els.profile.innerHTML = '<p class="placeholder">Click a team, pick a player to view the profile.</p>';
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

// --- Boot ------------------------------------------------------------------
async function boot() {
  try {
    const [csv, manifest] = await Promise.all([
      fetchText('data/teams.csv'),
      fetchJson('data/manifest.json').catch(() => null),
    ]);
    teams = parseCsv(csv);
    buildMap();
    // Color the legend swatches using the same division palette as the markers.
    document.querySelectorAll('.legend .swatch').forEach(el => {
      const d = el.getAttribute('data-div');
      if (DIVISION_COLORS[d]) el.style.background = DIVISION_COLORS[d];
    });
    if (manifest?.updatedAt) {
      const d = new Date(manifest.updatedAt);
      els.manifestLine.textContent = `Data last updated ${d.toLocaleString()} · ${manifest.teams} teams · ${manifest.players} players · Map tiles © OpenStreetMap contributors`;
    }
  } catch (e) {
    els.profile.innerHTML = `<p class="error">Failed to load team data: ${e.message}</p>`;
  }
}
boot();
