'use strict';
/* =========================================================================
   JV Stats — basketball stat tracker (PWA)
   Everything is stored on the device in localStorage.
   Games store a list of events; every stat is calculated from those events,
   which makes Undo and corrections simple and always accurate.
   ========================================================================= */

const STORE_KEY = 'jvstats.v1';

// Stat buttons shown on the pad, in order
const STATS = {
  '2PM': { label: '2PT made',     btn: '2PT ✓', cls: 'make', pts: 2 },
  '3PM': { label: '3PT made',     btn: '3PT ✓', cls: 'make', pts: 3 },
  'FTM': { label: 'FT made',      btn: 'FT ✓',  cls: 'make', pts: 1 },
  '2PX': { label: '2PT missed',   btn: '2PT ✗', cls: 'miss' },
  '3PX': { label: '3PT missed',   btn: '3PT ✗', cls: 'miss' },
  'FTX': { label: 'FT missed',    btn: 'FT ✗',  cls: 'miss' },
  'OREB': { label: 'Off. rebound', btn: 'OREB' },
  'DREB': { label: 'Def. rebound', btn: 'DREB' },
  'AST':  { label: 'Assist',       btn: 'AST' },
  'STL':  { label: 'Steal',        btn: 'STL' },
  'BLK':  { label: 'Block',        btn: 'BLK' },
  'TO':   { label: 'Turnover',     btn: 'TO' },
  'PF':   { label: 'Foul',         btn: 'FOUL', cls: 'foul' },
};
const OPP = { OPP1: 1, OPP2: 2, OPP3: 3 };   // opponent scoring
const PERIODS = ['Q1', 'Q2', 'Q3', 'Q4', 'OT'];
const TEAM_FOUL_BONUS = 5;                    // highlight team fouls at this count per quarter
const COURT_SIZE = 5;                         // players on the floor at once
const ROLES = { PG: 'Point guard', F: 'Forward', U: 'Utility' };
const MIN_PG = 1;                             // the rotation planner keeps at least this many point guards on
// Court positions by lineup slot, and which roster roles suit each one (best first)
const POSITIONS = ['PG', 'F', 'F', 'C', 'IG'];
const SLOT_PREFS = { PG: ['PG', 'U', 'F'], F: ['F', 'U', 'PG'], C: ['U', 'F', 'PG'], IG: ['U', 'PG', 'F'] };

/* ---------- Storage ---------- */
function defaultDB() { return { version: 1, teamName: 'JV Girls', roster: [], games: [] }; }
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return Object.assign(defaultDB(), JSON.parse(raw));
  } catch (e) { /* fall through */ }
  return defaultDB();
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); }
  catch (e) { toast('⚠️ Could not save — phone storage may be full'); }
}
let db = load();

const state = { view: 'games', gameId: null, sub: 'track', selected: null, posPick: null };

/* ---------- Helpers ---------- */
const $app = document.getElementById('app');
const $modal = document.getElementById('modal');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const fmtDate = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); };
const pct = (m, a) => a ? Math.round((m / a) * 100) + '%' : '–';
const byNumber = (a, b) => (parseInt(a.num, 10) || 0) - (parseInt(b.num, 10) || 0) || a.name.localeCompare(b.name);
const getGame = id => db.games.find(g => g.id === id);
const playerLabel = p => `#${p.num} ${p.name}`;
// Roles come from the roster (so a change applies right away), falling back to the game's copy for imported players
function roleOf(g, id) {
  const r = db.roster.find(x => x.id === id) || g.players.find(x => x.id === id);
  return r && ROLES[r.role] ? r.role : '';
}
const roleTag = role => role ? `<span class="role role-${role}">${role}</span>` : '';
const roleSelect = (cur = '') => `<select name="role"><option value="">—</option>${Object.entries(ROLES).map(([k, v]) =>
  `<option value="${k}" ${cur === k ? 'selected' : ''}>${v}</option>`).join('')}</select>`;
const gamePlayer = p => ({ id: p.id, num: p.num, name: p.name, role: p.role || '' });
// A full group with no point guard, on a team that has point guards
function missingPG(g, ids) {
  if (ids.length < COURT_SIZE || !g.players.some(p => roleOf(g, p.id) === 'PG')) return false;
  return ids.filter(id => roleOf(g, id) === 'PG').length < MIN_PG;
}

// Each game keeps a lineup per period: g.lineups = { Q1: [playerId, …], Q2: … }
// A player's index in the lineup is her slot, so lineup[0] plays POSITIONS[0] (PG), and so on.
function onCourt(g) {
  const ids = (g.lineups && g.lineups[g.period]) || [];
  return ids.map(id => g.players.find(p => p.id === id)).filter(Boolean);
}
function setCourt(g, ids) {
  g.lineups = g.lineups || {}; g.lineups[g.period] = ids;
  g.played = g.played || {};   // everyone who has been on the court in each period
  g.played[g.period] = [...new Set([...(g.played[g.period] || []), ...ids])];
  if (ids.length < COURT_SIZE) return;
  g.pos = g.pos || {};         // positions each player has played in each period: g.pos.Q1[id] = ['PG', …]
  const qp = g.pos[g.period] = g.pos[g.period] || {};
  ids.forEach((id, i) => { qp[id] = qp[id] || []; if (!qp[id].includes(POSITIONS[i])) qp[id].push(POSITIONS[i]); });
}
// Orders players into slots: anyone in `keep` stays in her old slot, the rest fill open slots by role
function placeLineup(g, ids, keep = []) {
  const n = Math.min(ids.length, COURT_SIZE), slots = new Array(n).fill(null);
  const left = new Set(ids.slice(0, COURT_SIZE));
  keep.forEach((id, i) => { if (i < n && left.has(id)) { slots[i] = id; left.delete(id); } });
  for (let i = 0; i < n; i++) {
    if (slots[i]) continue;
    const prefs = SLOT_PREFS[POSITIONS[i]];
    const rank = id => { const r = prefs.indexOf(roleOf(g, id)); return r < 0 ? prefs.length : r; };
    slots[i] = [...left].sort((a, b) => rank(a) - rank(b))[0];
    left.delete(slots[i]);
  }
  return slots;
}

// Pre-game rotation plan: g.plan = { Q1: { start: [ids], sub: [ids] }, … }
const PLAN_QS = ['Q1', 'Q2', 'Q3', 'Q4'];
const SHIFTS = { start: 'Start of quarter', sub: 'Mid-quarter' };
const shiftOrder = () => PLAN_QS.flatMap(q => Object.keys(SHIFTS).map(part => [q, part]));
function planFor(g, q, part) {
  const ids = (g.plan && g.plan[q] && g.plan[q][part]) || [];
  return ids.filter(id => g.players.some(p => p.id === id));
}
function setPlan(g, q, part, ids) { g.plan = g.plan || {}; g.plan[q] = g.plan[q] || {}; g.plan[q][part] = ids; }
function planCounts(g) {
  const c = {}; g.players.forEach(p => { c[p.id] = 0; });
  shiftOrder().forEach(([q, part]) => planFor(g, q, part).forEach(id => { c[id]++; }));
  return c;
}
function quartersPlayed(g) {
  const c = {}; g.players.forEach(p => { c[p.id] = 0; });
  PERIODS.forEach(q => {
    const ids = new Set([...((g.played && g.played[q]) || []), ...g.events.filter(e => e.q === q && e.p).map(e => e.p)]);
    ids.forEach(id => { if (id in c) c[id]++; });
  });
  return c;
}
// Quarters each player has played in every other game, so extra shifts rotate across the season
function seasonQuarters(g) {
  const c = {};
  db.games.filter(x => x.id !== g.id).forEach(x => {
    const qp = quartersPlayed(x);
    Object.keys(qp).forEach(id => { c[id] = (c[id] || 0) + qp[id]; });
  });
  return c;
}
// Fewest planned shifts first, then players who sat out the previous shift, then fewest quarters this season
function suggestShift(g, q, part, season = seasonQuarters(g)) {
  const order = shiftOrder();
  const i = order.findIndex(([a, b]) => a === q && b === part);
  const prev = new Set(i > 0 ? planFor(g, ...order[i - 1]) : []);
  const counts = planCounts(g);
  planFor(g, q, part).forEach(id => { counts[id]--; });
  const lines = box(g).lines;
  const ranked = g.players.filter(p => !(lines[p.id] && lines[p.id].PF >= 5))
    .sort((a, b) => counts[a.id] - counts[b.id] || prev.has(a.id) - prev.has(b.id)
      || (season[a.id] || 0) - (season[b.id] || 0) || byNumber(a, b));
  const pick = ranked.slice(0, COURT_SIZE);
  // Not enough point guards: swap the lowest-ranked non-PG picks for the best-ranked PGs left over
  const isPG = p => roleOf(g, p.id) === 'PG';
  const spare = ranked.slice(COURT_SIZE).filter(isPG);
  while (pick.filter(isPG).length < MIN_PG && spare.length) {
    const i = pick.map(isPG).lastIndexOf(false);
    if (i < 0) break;
    pick[i] = spare.shift();
  }
  return pick.map(p => p.id);
}

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 1600);
}
function buzz() { try { navigator.vibrate && navigator.vibrate(15); } catch (e) {} }

/* ---------- Stat math ---------- */
function emptyLine() { return { PTS: 0, FGM: 0, FGA: 0, TPM: 0, TPA: 0, FTM: 0, FTA: 0, OREB: 0, DREB: 0, AST: 0, STL: 0, BLK: 0, TO: 0, PF: 0 }; }
function apply(L, s) {
  switch (s) {
    case '2PM': L.FGM++; L.FGA++; L.PTS += 2; break;
    case '2PX': L.FGA++; break;
    case '3PM': L.FGM++; L.FGA++; L.TPM++; L.TPA++; L.PTS += 3; break;
    case '3PX': L.FGA++; L.TPA++; break;
    case 'FTM': L.FTM++; L.FTA++; L.PTS++; break;
    case 'FTX': L.FTA++; break;
    default: if (s in L) L[s]++;
  }
}
function box(game) {
  const lines = {};
  game.players.forEach(p => { lines[p.id] = emptyLine(); });
  const team = emptyLine();
  const byQ = {};
  PERIODS.forEach(q => { byQ[q] = { us: 0, them: 0, fouls: 0 }; });
  let opp = 0;
  for (const e of game.events) {
    const q = byQ[e.q] || byQ.Q1;
    if (e.s in OPP) { opp += OPP[e.s]; q.them += OPP[e.s]; continue; }
    if (!lines[e.p]) lines[e.p] = emptyLine();
    apply(lines[e.p], e.s);
    apply(team, e.s);
    if (STATS[e.s] && STATS[e.s].pts) q.us += STATS[e.s].pts;
    if (e.s === 'PF') q.fouls++;
  }
  return { lines, team, opp, byQ };
}
function result(game, b) {
  if (!game.final) return null;
  return b.team.PTS > b.opp ? 'W' : b.team.PTS < b.opp ? 'L' : 'T';
}
function periodsPlayed(game, b) {
  return PERIODS.filter(q => q !== 'OT' || b.byQ.OT.us || b.byQ.OT.them || game.period === 'OT');
}

/* ---------- Rendering ---------- */
function render() {
  document.body.classList.toggle('in-game', state.view === 'game');
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.view === state.view));
  const views = { games: viewGames, roster: viewRoster, settings: viewSettings, game: viewGame };
  $app.innerHTML = (views[state.view] || viewGames)();
  if (state.view === 'game' && state.sub === 'track') requestWakeLock(); else releaseWakeLock();
}

function viewGames() {
  const games = [...db.games].sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.created - a.created);
  const list = games.map(g => {
    const b = box(g);
    const r = result(g, b);
    const badge = g.final ? `<span class="badge ${r === 'W' ? 'w' : r === 'L' ? 'l' : ''}">${r}</span>` : '<span class="badge live">LIVE</span>';
    return `<button class="card game-card" data-action="open-game" data-id="${g.id}">
      <div class="grow">
        <div style="font-weight:700">${g.home ? 'vs' : '@'} ${esc(g.opponent)}</div>
        <div class="muted small">${fmtDate(g.date)}</div>
      </div>
      <div class="score num">${b.team.PTS}–${b.opp}</div>
      ${badge}
    </button>`;
  }).join('');
  const w = db.games.filter(g => result(g, box(g)) === 'W').length;
  const l = db.games.filter(g => result(g, box(g)) === 'L').length;
  return `
    <div class="row spread"><h1>${esc(db.teamName)}</h1><span class="muted num">${w}–${l}</span></div>
    <button class="btn-primary btn-block btn-big" data-action="new-game">+ New Game</button>
    <button class="btn-ghost btn-block" style="margin-top:8px" data-action="import-game">⬆️ Import game file…</button>
    <input id="import-file" type="file" accept=".json,application/json" multiple hidden>
    <h2>Games</h2>
    ${list || `<div class="empty">No games yet.${db.roster.length ? '' : '<br>Start by adding players on the <b>Roster</b> tab.'}</div>`}
  `;
}

function viewRoster() {
  const items = [...db.roster].sort(byNumber).map(p => `
    <div class="roster-item">
      <div class="jersey num">${esc(p.num)}</div>
      <div class="grow">${esc(p.name)} ${roleTag(ROLES[p.role] ? p.role : '')}</div>
      <button class="btn-ghost" data-action="edit-player" data-id="${p.id}">Edit</button>
    </div>`).join('');
  return `
    <h1>Roster</h1>
    <form class="card" data-form="add-player" autocomplete="off">
      <div class="row">
        <label class="field" style="width:90px;margin:0"><span>Number</span>
          <input name="num" type="text" inputmode="numeric" maxlength="3" required></label>
        <label class="field grow" style="margin:0"><span>Name</span>
          <input name="name" type="text" maxlength="30" required></label>
      </div>
      <label class="field" style="margin-bottom:0"><span>Role</span>${roleSelect()}</label>
      <button class="btn-primary btn-block" style="margin-top:10px" type="submit">Add Player</button>
    </form>
    <div class="card">${items || '<div class="muted">No players yet.</div>'}</div>
  `;
}

function viewSettings() {
  return `
    <h1>Settings</h1>
    <div class="card">
      <form data-form="team-name"><label class="field"><span>Team name</span>
        <input name="teamName" type="text" maxlength="30" value="${esc(db.teamName)}"></label>
        <button class="btn-block" type="submit">Save name</button></form>
    </div>
    <h2>Backup &amp; restore</h2>
    <div class="card stack">
      <p class="muted small" style="margin:0">Your roster and games live only on this phone. Back up now and then, or to move everything to a new phone.</p>
      <button data-action="backup">⬇️ Back up all data</button>
      <button data-action="restore">⬆️ Restore from backup…</button>
      <input id="restore-file" type="file" accept=".json,application/json" hidden>
    </div>
    <h2>Danger zone</h2>
    <div class="card"><button class="btn-danger btn-block" data-action="wipe">Delete all data</button></div>
    <p class="muted small" style="text-align:center">JV Stats · ${db.games.length} games · ${db.roster.length} players</p>
  `;
}

function viewGame() {
  const g = getGame(state.gameId);
  if (!g) { state.view = 'games'; return viewGames(); }
  const b = box(g);
  const header = `
    <div class="row spread" style="margin-bottom:8px">
      <button class="btn-ghost" data-action="nav" data-view="games">‹ Games</button>
      <span class="muted small">${fmtDate(g.date)}${g.final ? ' · Final' : ''}</span>
      <button class="btn-ghost" data-action="game-menu">⋯</button>
    </div>
    <div class="scoreboard">
      <div><div class="team">${esc(db.teamName)}</div><div class="pts num">${b.team.PTS}</div></div>
      <div class="mid">${g.final ? 'FINAL' : esc(g.period)}<br>${g.home ? 'vs' : '@'}</div>
      <div class="right"><div class="team">${esc(g.opponent)}</div><div class="pts num">${b.opp}</div></div>
    </div>
    <div class="subtabs">
      ${['track', 'plan', 'box', 'share'].map(s => `<button class="${state.sub === s ? 'on' : ''}" data-action="sub" data-sub="${s}">${{ track: 'Track', plan: 'Plan', box: 'Box Score', share: 'Share' }[s]}</button>`).join('')}
    </div>`;
  const body = state.sub === 'box' ? viewBox(g, b) : state.sub === 'share' ? viewShare(g, b)
    : state.sub === 'plan' ? viewPlan(g) : viewTrack(g, b);
  return header + body;
}

function viewTrack(g, b) {
  if (g.final) {
    return `<div class="empty">This game is final.<br><br><button data-action="reopen">Reopen to edit stats</button></div>`;
  }
  // Nobody on the court yet but this quarter has a planned five: put them out there
  if (!onCourt(g).length && planFor(g, g.period, 'start').length) { setCourt(g, placeLineup(g, planFor(g, g.period, 'start'))); save(); }
  const qFouls = b.byQ[g.period].fouls;
  const periods = `<div class="segmented">${PERIODS.map(q => `<button class="${g.period === q ? 'on' : ''}" data-action="period" data-q="${q}">${q}</button>`).join('')}</div>`;
  const court = onCourt(g);
  const tiles = court.map((p, i) => {
    const L = b.lines[p.id] || emptyLine();
    const fcls = L.PF >= 5 ? 'f5' : L.PF >= 4 ? 'f4' : '';
    const pos = court.length === COURT_SIZE ? `<span class="pos ${state.posPick === p.id ? 'on' : ''}" data-action="pos" data-id="${p.id}">${POSITIONS[i]}</span>` : '';
    return `<button class="tile ${state.selected === p.id ? 'sel' : ''} ${fcls}" data-action="select" data-id="${p.id}">
      ${pos}<span class="fouls">${L.PF ? L.PF + 'F' : ''}</span>
      <span class="n num">${esc(p.num)}</span>
      <span class="nm">${esc(p.name)}</span>
      <span class="pp num">${L.PTS} pt${L.PTS === 1 ? '' : 's'}</span>
    </button>`;
  }).join('');
  const subTile = `<button class="tile sub-tile" data-action="sub-modal">
      <span class="n">⇄</span><span class="nm">${court.length < COURT_SIZE ? `Set lineup (${court.length}/${COURT_SIZE})` : 'Sub'}</span></button>`;
  const sel = court.find(p => p.id === state.selected);
  const moving = court.length === COURT_SIZE && court.find(p => p.id === state.posPick);
  const posRow = moving ? `
    <div class="pos-row"><span class="small">Move <b>${esc(moving.name)}</b> to</span>
      ${court.map((p, i) => `<button class="${p.id === moving.id ? 'on' : ''}" data-action="pos-to" data-i="${i}">${POSITIONS[i]}</button>`).join('')}
      <button class="btn-ghost" data-action="pos-cancel" aria-label="Cancel">✕</button></div>` : '';
  const pad = Object.entries(STATS).map(([k, v]) =>
    `<button class="${v.cls || ''}" data-action="stat" data-s="${k}" ${sel ? '' : 'disabled'}>${v.btn}</button>`).join('');
  const recent = g.events.slice(-8).reverse().map(e => `
    <div class="log-item"><span class="muted small num" style="width:28px">${e.q}</span>
      <span class="grow">${describe(g, e)}</span>
      <button class="x" data-action="del-event" data-id="${e.id}" aria-label="Delete">✕</button></div>`).join('');
  return `
    ${periods}
    <div class="row spread small muted" style="margin:-2px 2px 8px">
      <span>Team fouls ${g.period}: <b style="color:${qFouls >= TEAM_FOUL_BONUS ? 'var(--bad)' : 'var(--text)'}">${qFouls}</b>${qFouls >= TEAM_FOUL_BONUS ? ' · opponent in bonus' : ''}</span>
    </div>
    ${g.players.length ? '' : '<div class="empty" style="margin-bottom:8px">No players in this game. Use ⋯ → Players dressed.</div>'}
    <div class="players">${tiles}${g.players.length ? subTile : ''}</div>
    ${posRow}
    <div class="pad-head">${sel ? `Recording for <span style="color:var(--accent)">${esc(playerLabel(sel))}</span>` : '<span class="muted">Tap a player, then a stat</span>'}</div>
    <div class="pad">${pad}</div>
    <div class="opp-row">
      <span class="lbl">${esc(g.opponent)}<br>scored</span>
      <button data-action="opp" data-s="OPP1">+1</button>
      <button data-action="opp" data-s="OPP2">+2</button>
      <button data-action="opp" data-s="OPP3">+3</button>
    </div>
    <div class="row" style="margin-top:14px">
      <button class="grow" data-action="undo" ${g.events.length ? '' : 'disabled'}>↶ Undo last</button>
      <button class="grow btn-ghost" data-action="end-game">End game</button>
    </div>
    ${recent ? `<div class="log"><div class="muted small">Recent (tap ✕ to remove)</div>${recent}</div>` : ''}
  `;
}

function viewPlan(g) {
  const players = [...g.players].sort(byNumber);
  if (!players.length) return '<div class="empty">No players in this game. Use ⋯ → Players dressed.</div>';
  const counts = planCounts(g), played = quartersPlayed(g);
  const vals = players.map(p => counts[p.id]);
  const max = Math.max(...vals);
  const time = players.map(p => `
    <div class="pt-item ${max - counts[p.id] >= 2 ? 'low' : ''}">
      <b class="num" style="width:34px">#${esc(p.num)}</b><span class="grow">${esc(p.name)} ${roleTag(roleOf(g, p.id))}</span>
      <span class="num c">${counts[p.id]}</span><span class="num c muted">${played[p.id]}</span></div>`).join('');
  const shift = (q, part) => {
    const ids = planFor(g, q, part), on = new Set(ids);
    const five = ids.map(id => g.players.find(p => p.id === id)).sort(byNumber);
    const bench = players.filter(p => !on.has(p.id));
    return `<button class="plan-shift" data-action="plan-edit" data-q="${q}" data-part="${part}">
      <span class="small muted">${SHIFTS[part]}${ids.length < COURT_SIZE ? ` · ${ids.length}/${COURT_SIZE}` : ''}${missingPG(g, ids) ? ' <span class="pg-warn">⚠ No point guard</span>' : ''}</span>
      <span class="plan-five">${five.map(p => `<span class="pchip">#${esc(p.num)} ${esc(p.name)}${roleTag(roleOf(g, p.id))}</span>`).join('') || '<span class="muted">Tap to pick 5</span>'}</span>
      ${ids.length ? `<span class="small muted">Bench: ${bench.map(p => esc(p.name)).join(', ') || '—'}</span>` : ''}
    </button>`;
  };
  const cards = PLAN_QS.map(q => `<div class="card"><b>${q}</b>${Object.keys(SHIFTS).map(part => shift(q, part)).join('')}</div>`).join('');
  return `
    <div class="row">
      <button class="grow btn-primary" data-action="plan-auto">✨ Auto-fill fair rotation</button>
      <button class="btn-ghost" data-action="plan-clear">Clear</button>
    </div>
    <p class="muted small">Plan a starting five and a mid-quarter group for each quarter. Planned fives load when a quarter starts, and ⇄ Sub offers the planned change with one tap.
      ${players.some(p => roleOf(g, p.id) === 'PG') ? 'Auto-fill keeps a point guard in every group.' : 'Tag point guards on the Roster tab and auto-fill will keep one in every group.'}</p>
    <h2>Playing time</h2>
    <div class="card pt">
      <div class="pt-item small muted"><span class="grow">Player</span><span class="c">Planned<br>shifts</span><span class="c">Quarters<br>played</span></div>
      ${time}
    </div>
    ${cards}`;
}

function describe(g, e) {
  if (e.s in OPP) return `<span class="muted">${esc(g.opponent)} +${OPP[e.s]}</span>`;
  const p = g.players.find(x => x.id === e.p);
  return `<b>${esc(p ? playerLabel(p) : '?')}</b> · ${STATS[e.s] ? STATS[e.s].label : e.s}`;
}

function viewBox(g, b) {
  const cols = ['PTS', 'FG', 'FG%', '3PT', 'FT', 'REB', 'OR', 'DR', 'AST', 'STL', 'BLK', 'TO', 'PF'];
  const cells = L => [L.PTS, `${L.FGM}-${L.FGA}`, pct(L.FGM, L.FGA), `${L.TPM}-${L.TPA}`, `${L.FTM}-${L.FTA}`,
    L.OREB + L.DREB, L.OREB, L.DREB, L.AST, L.STL, L.BLK, L.TO, L.PF];
  const players = [...g.players].sort(byNumber);
  const top = players.reduce((m, p) => Math.max(m, (b.lines[p.id] || emptyLine()).PTS), 0);
  const rows = players.map(p => {
    const L = b.lines[p.id] || emptyLine();
    return `<tr><td class="name">${esc(playerLabel(p))}</td>${cells(L).map((c, i) => `<td class="${i === 0 && top > 0 && L.PTS === top ? 'hi' : ''}">${c}</td>`).join('')}</tr>`;
  }).join('');
  const qs = periodsPlayed(g, b);
  return `
    <div class="table-wrap"><table>
      <tr><th class="name">Player</th>${cols.map(c => `<th>${c}</th>`).join('')}</tr>
      ${rows}
      <tr class="total"><td class="name">Team</td>${cells(b.team).map(c => `<td>${c}</td>`).join('')}</tr>
    </table></div>
    <h2>By quarter</h2>
    <div class="table-wrap"><table>
      <tr><th class="name"></th>${qs.map(q => `<th>${q}</th>`).join('')}<th>T</th></tr>
      <tr><td class="name">${esc(db.teamName)}</td>${qs.map(q => `<td>${b.byQ[q].us}</td>`).join('')}<td><b>${b.team.PTS}</b></td></tr>
      <tr><td class="name">${esc(g.opponent)}</td>${qs.map(q => `<td>${b.byQ[q].them}</td>`).join('')}<td><b>${b.opp}</b></td></tr>
    </table></div>
    ${positionsTable(g, qs)}
    <p class="muted small">FG includes 2s and 3s. Swipe the table sideways to see every column.</p>
  `;
}
function positionsTable(g, qs) {
  const pos = g.pos || {};
  if (!qs.some(q => pos[q] && Object.keys(pos[q]).length)) return '';
  const rows = [...g.players].sort(byNumber).map(p => `<tr><td class="name">${esc(playerLabel(p))}</td>${qs.map(q =>
    `<td>${((pos[q] && pos[q][p.id]) || []).join('/') || '<span class="muted">–</span>'}</td>`).join('')}</tr>`).join('');
  return `
    <h2>Positions</h2>
    <div class="table-wrap"><table>
      <tr><th class="name">Player</th>${qs.map(q => `<th>${q}</th>`).join('')}</tr>
      ${rows}
    </table></div>`;
}

function viewShare(g, b) {
  return `
    <div class="stack">
      <button class="btn-primary btn-big" data-action="share-csv">📤 Share CSV file</button>
      <button data-action="share-text">💬 Share text summary</button>
      <button data-action="copy-text">📋 Copy text summary</button>
      <button class="btn-ghost" data-action="download-csv">⬇️ Download CSV</button>
    </div>
    <h2>Send to another coach</h2>
    <div class="stack">
      <button data-action="share-game">📦 Share game file</button>
      <p class="muted small" style="margin:0">A game file can be imported into another phone's JV Stats with <b>Games → Import game file</b>. It includes every stat, so the box score comes out identical.</p>
    </div>
    <h2>Preview</h2>
    <pre class="summary">${esc(summaryText(g, b))}</pre>
  `;
}

/* ---------- Export ---------- */
function summaryText(g, b = box(g)) {
  const r = result(g, b);
  const lines = [];
  lines.push(`${db.teamName} ${g.home ? 'vs' : '@'} ${g.opponent}${r ? ` — ${r}` : ''} ${b.team.PTS}-${b.opp}${g.final ? '' : ' (in progress)'}`);
  lines.push(fmtDate(g.date));
  lines.push('By quarter: ' + periodsPlayed(g, b).map(q => `${q} ${b.byQ[q].us}-${b.byQ[q].them}`).join(' | '));
  const T = b.team;
  lines.push(`Team: FG ${T.FGM}-${T.FGA} (${pct(T.FGM, T.FGA)}), 3PT ${T.TPM}-${T.TPA}, FT ${T.FTM}-${T.FTA} (${pct(T.FTM, T.FTA)}), REB ${T.OREB + T.DREB}, AST ${T.AST}, STL ${T.STL}, TO ${T.TO}`);
  lines.push('');
  const players = [...g.players].sort((a, c) => (b.lines[c.id] || emptyLine()).PTS - (b.lines[a.id] || emptyLine()).PTS || byNumber(a, c));
  for (const p of players) {
    const L = b.lines[p.id] || emptyLine();
    const parts = [`${L.PTS} pt${L.PTS === 1 ? '' : 's'}`];
    if (L.FGA) parts.push(`${L.FGM}-${L.FGA} FG`);
    if (L.TPA) parts.push(`${L.TPM}-${L.TPA} 3PT`);
    if (L.FTA) parts.push(`${L.FTM}-${L.FTA} FT`);
    if (L.OREB + L.DREB) parts.push(`${L.OREB + L.DREB} reb`);
    if (L.AST) parts.push(`${L.AST} ast`);
    if (L.STL) parts.push(`${L.STL} stl`);
    if (L.BLK) parts.push(`${L.BLK} blk`);
    if (L.TO) parts.push(`${L.TO} to`);
    if (L.PF) parts.push(`${L.PF} pf`);
    lines.push(`${playerLabel(p)}: ${parts.join(', ')}`);
  }
  return lines.join('\n');
}

function csvCell(v) { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
function gameCSV(g) {
  const b = box(g);
  const rows = [];
  rows.push(['Team', db.teamName], ['Opponent', g.opponent], ['Date', g.date], ['Location', g.home ? 'Home' : 'Away'],
    ['Final score', `${b.team.PTS}-${b.opp}`], ['Status', g.final ? 'Final' : 'In progress'], []);
  rows.push(['#', 'Player', 'PTS', 'FGM', 'FGA', 'FG%', '3PM', '3PA', '3P%', 'FTM', 'FTA', 'FT%', 'OREB', 'DREB', 'REB', 'AST', 'STL', 'BLK', 'TO', 'PF']);
  const cp = (m, a) => a ? Math.round((m / a) * 100) + '%' : '';
  const line = (num, name, L) => [num, name, L.PTS, L.FGM, L.FGA, cp(L.FGM, L.FGA), L.TPM, L.TPA, cp(L.TPM, L.TPA),
    L.FTM, L.FTA, cp(L.FTM, L.FTA), L.OREB, L.DREB, L.OREB + L.DREB, L.AST, L.STL, L.BLK, L.TO, L.PF];
  [...g.players].sort(byNumber).forEach(p => rows.push(line(p.num, p.name, b.lines[p.id] || emptyLine())));
  rows.push(line('', 'TEAM', b.team), []);
  const qs = periodsPlayed(g, b);
  rows.push(['Quarter', ...qs, 'Total']);
  rows.push([db.teamName, ...qs.map(q => b.byQ[q].us), b.team.PTS]);
  rows.push([g.opponent, ...qs.map(q => b.byQ[q].them), b.opp]);
  const pos = g.pos || {};
  if (qs.some(q => pos[q] && Object.keys(pos[q]).length)) {
    rows.push([], ['Positions', ...qs]);
    [...g.players].sort(byNumber).forEach(p => rows.push([playerLabel(p), ...qs.map(q => ((pos[q] && pos[q][p.id]) || []).join('/'))]));
  }
  return rows.map(r => r.map(csvCell).join(',')).join('\r\n');
}
function csvFileName(g, ext = 'csv') {
  const opp = g.opponent.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'game';
  return `${g.date}_${g.home ? 'vs' : 'at'}_${opp}.${ext}`;
}

/* ---------- Game files (send a game to another coach) ---------- */
const GAME_FILE = 'jvstats-game';
function gameFile(g) {
  return JSON.stringify({ format: GAME_FILE, version: 1, exported: Date.now(), teamName: db.teamName, game: g }, null, 2);
}
// Validates an imported game and links its players to this phone's roster (by number + name, then number).
function cleanImportedGame(raw) {
  const g = raw && raw.game;
  if (!g || !Array.isArray(g.players) || !Array.isArray(g.events) || typeof g.opponent !== 'string') return null;
  const idMap = {}, used = new Set();
  const players = g.players.filter(p => p && p.id).map(p => {
    const num = String(p.num ?? '').trim(), name = String(p.name ?? '').trim();
    const open = db.roster.filter(r => !used.has(r.id));
    const mine = open.find(r => r.num === num && r.name.toLowerCase() === name.toLowerCase())
      || (open.filter(r => r.num === num).length === 1 ? open.find(r => r.num === num) : null);
    idMap[p.id] = mine ? mine.id : p.id;
    used.add(idMap[p.id]);
    return { id: idMap[p.id], num, name, role: ROLES[p.role] ? p.role : '' };
  });
  const remap = ids => Array.isArray(ids) ? ids.map(id => idMap[id] || id) : [];
  const lineups = {}, played = {}, plan = {}, pos = {};
  PERIODS.forEach(q => {
    if (g.lineups && Array.isArray(g.lineups[q])) lineups[q] = remap(g.lineups[q]);
    if (g.played && Array.isArray(g.played[q])) played[q] = remap(g.played[q]);
    if (g.pos && g.pos[q] && typeof g.pos[q] === 'object') {
      pos[q] = Object.fromEntries(Object.entries(g.pos[q]).map(([id, list]) =>
        [idMap[id] || id, Array.isArray(list) ? list.filter(x => POSITIONS.includes(x)) : []]));
    }
  });
  PLAN_QS.forEach(q => { if (g.plan && g.plan[q]) plan[q] = { start: remap(g.plan[q].start), sub: remap(g.plan[q].sub) }; });
  return {
    id: typeof g.id === 'string' ? g.id : uid(),
    created: Number(g.created) || Date.now(),
    opponent: g.opponent.trim() || 'Opponent',
    date: /^\d{4}-\d{2}-\d{2}$/.test(g.date) ? g.date : today(),
    home: !!g.home,
    period: PERIODS.includes(g.period) ? g.period : 'Q1',
    final: !!g.final,
    players, lineups, played, plan, pos,
    events: g.events.filter(e => e && (e.s in STATS || e.s in OPP)).map(e => ({
      id: typeof e.id === 'string' ? e.id : uid(), p: e.p ? (idMap[e.p] || e.p) : null,
      s: e.s, q: PERIODS.includes(e.q) ? e.q : 'Q1', t: Number(e.t) || 0,
    })),
    importedFrom: typeof raw.teamName === 'string' ? raw.teamName : '',
    imported: Date.now(),
  };
}
async function importGameFiles(files) {
  let added = 0, lastId = null;
  for (const file of files) {
    let data;
    try { data = JSON.parse(await file.text()); } catch (e) { data = null; }
    if (data && Array.isArray(data.games) && Array.isArray(data.roster)) {
      toast('That is a full backup — use Settings → Restore'); continue;
    }
    const g = data && data.format === GAME_FILE ? cleanImportedGame(data) : null;
    if (!g) { toast(`${file.name} isn't a JV Stats game file`); continue; }
    const label = `${g.home ? 'vs' : '@'} ${g.opponent} (${fmtDate(g.date)})`;
    const same = db.games.find(x => x.id === g.id);
    if (same) {
      if (!confirm(`You already have the game ${label}. Replace it with the imported copy?`)) continue;
      db.games = db.games.filter(x => x.id !== g.id);
    } else if (db.games.some(x => x.date === g.date && x.opponent.toLowerCase() === g.opponent.toLowerCase())
      && !confirm(`You already have a game ${label}. Import this one as a separate game?`)) continue;
    db.games.push(g); added++; lastId = g.id;
  }
  if (!added) return;
  save();
  if (added === 1) {
    Object.assign(state, { view: 'game', gameId: lastId, sub: 'box', selected: null });
    window.scrollTo(0, 0);
  }
  render(); toast(added === 1 ? 'Game imported' : `${added} games imported`);
}
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
async function shareFile(name, text, type) {
  const file = new File([text], name, { type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); }
    catch (e) { if (e.name !== 'AbortError') { download(name, text, type); toast('Sharing failed — downloaded instead'); } }
  } else {
    download(name, text, type);
    toast('Sharing files not supported here — downloaded instead');
  }
}
const shareCSV = g => shareFile(csvFileName(g), gameCSV(g), 'text/csv');
const shareGame = g => shareFile(csvFileName(g, 'json'), gameFile(g), 'application/json');
async function shareText(g) {
  const text = summaryText(g);
  if (navigator.share) {
    try { await navigator.share({ text }); } catch (e) { if (e.name !== 'AbortError') copyText(text); }
  } else copyText(text);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied — paste into a text'); }
  catch (e) { toast('Could not copy on this device'); }
}

/* ---------- Modals ---------- */
function openModal(html) { $modal.innerHTML = html; $modal.showModal(); }
function closeModal() { $modal.close(); $modal.innerHTML = ''; }

function newGameModal() {
  if (!db.roster.length) { toast('Add players to your roster first'); state.view = 'roster'; render(); return; }
  const checks = [...db.roster].sort(byNumber).map(p => `
    <label><input type="checkbox" name="p" value="${p.id}" checked> <span class="num" style="width:36px;font-weight:700">#${esc(p.num)}</span> ${esc(p.name)}</label>`).join('');
  openModal(`
    <form data-form="new-game" autocomplete="off">
      <h2 style="margin-top:0">New game</h2>
      <label class="field"><span>Opponent</span><input name="opponent" type="text" maxlength="30" required></label>
      <div class="row">
        <label class="field grow"><span>Date</span><input name="date" type="date" value="${today()}" required></label>
        <label class="field grow"><span>Location</span><select name="home"><option value="1">Home</option><option value="0">Away</option></select></label>
      </div>
      <div class="field"><span class="muted small">Players dressed (uncheck anyone who isn't playing)</span></div>
      <div class="check-list">${checks}</div>
      <div class="row" style="margin-top:14px">
        <button type="button" class="grow btn-ghost" data-action="close-modal">Cancel</button>
        <button type="submit" class="grow btn-primary">Start game</button>
      </div>
    </form>`);
}

function editPlayerModal(id) {
  const p = db.roster.find(x => x.id === id); if (!p) return;
  openModal(`
    <form data-form="edit-player" data-id="${p.id}" autocomplete="off">
      <h2 style="margin-top:0">Edit player</h2>
      <div class="row">
        <label class="field" style="width:90px"><span>Number</span><input name="num" type="text" inputmode="numeric" maxlength="3" value="${esc(p.num)}" required></label>
        <label class="field grow"><span>Name</span><input name="name" type="text" maxlength="30" value="${esc(p.name)}" required></label>
      </div>
      <label class="field"><span>Role</span>${roleSelect(p.role)}</label>
      <p class="muted small">Name and number changes apply to future games; past box scores keep the ones used at the time. Role changes apply to rotation plans right away.</p>
      <div class="row">
        <button type="button" class="btn-danger" data-action="delete-player" data-id="${p.id}">Remove</button>
        <span class="grow"></span>
        <button type="button" class="btn-ghost" data-action="close-modal">Cancel</button>
        <button type="submit" class="btn-primary">Save</button>
      </div>
    </form>`);
}

function gameMenuModal() {
  const g = getGame(state.gameId); if (!g) return;
  openModal(`
    <h2 style="margin-top:0">${g.home ? 'vs' : '@'} ${esc(g.opponent)}</h2>
    <div class="stack">
      <button data-action="game-players">👥 Players dressed…</button>
      <button data-action="game-details">✏️ Edit opponent / date…</button>
      ${g.final ? '<button data-action="reopen">🔓 Reopen game</button>' : '<button data-action="end-game">🏁 End game</button>'}
      <button class="btn-danger" data-action="delete-game">🗑 Delete game</button>
      <button class="btn-ghost" data-action="close-modal">Close</button>
    </div>`);
}

function gamePlayersModal() {
  const g = getGame(state.gameId); if (!g) return;
  const inGame = new Set(g.players.map(p => p.id));
  const used = new Set(g.events.map(e => e.p));
  const all = [...g.players, ...db.roster.filter(p => !inGame.has(p.id))].sort(byNumber);
  const checks = all.map(p => {
    const locked = used.has(p.id);
    return `<label><input type="checkbox" name="p" value="${p.id}" ${inGame.has(p.id) ? 'checked' : ''} ${locked ? 'disabled' : ''}>
      <span class="num" style="width:36px;font-weight:700">#${esc(p.num)}</span> ${esc(p.name)} ${locked ? '<span class="muted small">(has stats)</span>' : ''}</label>`;
  }).join('');
  openModal(`
    <form data-form="game-players">
      <h2 style="margin-top:0">Players dressed</h2>
      <div class="check-list">${checks}</div>
      <div class="row" style="margin-top:14px">
        <button type="button" class="grow btn-ghost" data-action="close-modal">Cancel</button>
        <button type="submit" class="grow btn-primary">Save</button>
      </div>
    </form>`);
}

// Pending picks inside the Sub sheet; a swap happens once both sides are picked
let subPick = { out: null, in: null, last: '' };
function subModal() {
  const g = getGame(state.gameId); if (!g) return;
  const b = box(g);
  const court = onCourt(g);
  const onIds = new Set(court.map(p => p.id));
  const bench = g.players.filter(p => !onIds.has(p.id)).sort(byNumber);
  const chip = (p, side, slot) => {
    const L = b.lines[p.id] || emptyLine();
    const fcls = L.PF >= 5 ? 'f5' : L.PF >= 4 ? 'f4' : '';
    const pos = slot != null && court.length === COURT_SIZE ? `<span class="pos-txt">${POSITIONS[slot]}</span> ` : '';
    return `<button class="sub-chip ${subPick[side] === p.id ? 'sel' : ''} ${fcls}" data-action="sub-pick" data-side="${side}" data-id="${p.id}">
      <span>${pos}<b class="num">#${esc(p.num)}</b> ${esc(p.name)} ${roleTag(roleOf(g, p.id))}</span>
      <span class="muted small num">${L.PTS} pt${L.PTS === 1 ? '' : 's'}${L.PF ? ` · <span class="fouls-txt">${L.PF}F</span>` : ''}</span></button>`;
  };
  const names = ids => ids.map(id => esc(g.players.find(p => p.id === id).name)).join(', ');
  const planned = Object.keys(SHIFTS).map(part => {
    const ids = planFor(g, g.period, part);
    const goingIn = ids.filter(id => !onIds.has(id)), goingOut = court.map(p => p.id).filter(id => !ids.includes(id));
    if (ids.length !== COURT_SIZE || !goingIn.length) return '';
    return `<button class="btn-block plan-go" data-action="sub-plan" data-part="${part}">
      ▶ Planned ${esc(g.period)} ${part === 'start' ? 'start' : 'sub'}<br>
      <span class="small">In: ${names(goingIn)}${goingOut.length ? ` · Out: ${names(goingOut)}` : ''}</span>
      ${missingPG(g, ids) ? '<br><span class="small pg-warn">⚠ Leaves no point guard on the court</span>' : ''}</button>`;
  }).join('');
  const full = court.length >= COURT_SIZE;
  const hint = !full && !subPick.out ? `Tap bench players to put them on the court (${court.length}/${COURT_SIZE}).`
    : 'Tap who’s coming out, then who’s going in.';
  const html = `
    <h2 style="margin-top:0">Substitution · ${esc(g.period)}</h2>
    <p class="muted small" style="margin-top:-4px">${hint}</p>
    ${missingPG(g, [...onIds]) ? '<p class="pg-warn small" style="margin-top:-4px">⚠ No point guard on the court</p>' : ''}
    ${planned}
    <div class="sub-cols">
      <div><div class="sub-h">On court <span class="muted num">${court.length}/${COURT_SIZE}</span></div>
        ${court.map((p, i) => chip(p, 'out', i)).join('') || '<div class="muted small">Nobody yet</div>'}</div>
      <div><div class="sub-h">Bench</div>
        ${bench.map(p => chip(p, 'in')).join('') || '<div class="muted small">Nobody on the bench</div>'}</div>
    </div>
    <div class="sub-last small">${subPick.last}</div>
    <button class="btn-primary btn-block" data-action="close-modal">Done</button>`;
  if ($modal.open) $modal.innerHTML = html; else openModal(html);
}

// Which planned shift is being edited: { q, part, msg }
let planEdit = null;
function planModal() {
  const g = getGame(state.gameId); if (!g || !planEdit) return;
  const { q, part } = planEdit;
  const on = new Set(planFor(g, q, part));
  const counts = planCounts(g), lines = box(g).lines;
  const list = [...g.players].sort(byNumber).map(p => {
    const pf = (lines[p.id] || emptyLine()).PF;
    return `<button class="sub-chip ${on.has(p.id) ? 'sel' : ''} ${pf >= 5 ? 'f5' : ''}" data-action="plan-toggle" data-id="${p.id}">
      <span><b class="num">#${esc(p.num)}</b> ${esc(p.name)} ${roleTag(roleOf(g, p.id))}</span>
      <span class="muted small">${counts[p.id]} shift${counts[p.id] === 1 ? '' : 's'} planned</span></button>`;
  }).join('');
  const html = `
    <h2 style="margin-top:0">${q} · ${SHIFTS[part]}</h2>
    <p class="muted small" style="margin-top:-4px">${planEdit.msg || `Tap players to pick ${COURT_SIZE} (${on.size}/${COURT_SIZE}).`}</p>
    ${missingPG(g, [...on]) ? '<p class="pg-warn small" style="margin-top:-4px">⚠ No point guard in this group</p>' : ''}
    <div class="plan-pick">${list}</div>
    <div class="row" style="margin-top:12px">
      <button class="grow" data-action="plan-suggest">✨ Suggest</button>
      <button class="grow btn-primary" data-action="close-modal">Done</button>
    </div>`;
  if ($modal.open) $modal.innerHTML = html; else openModal(html);
}

function gameDetailsModal() {
  const g = getGame(state.gameId); if (!g) return;
  openModal(`
    <form data-form="game-details" autocomplete="off">
      <h2 style="margin-top:0">Game details</h2>
      <label class="field"><span>Opponent</span><input name="opponent" type="text" maxlength="30" value="${esc(g.opponent)}" required></label>
      <div class="row">
        <label class="field grow"><span>Date</span><input name="date" type="date" value="${g.date}" required></label>
        <label class="field grow"><span>Location</span><select name="home">
          <option value="1" ${g.home ? 'selected' : ''}>Home</option><option value="0" ${g.home ? '' : 'selected'}>Away</option></select></label>
      </div>
      <div class="row" style="margin-top:6px">
        <button type="button" class="grow btn-ghost" data-action="close-modal">Cancel</button>
        <button type="submit" class="grow btn-primary">Save</button>
      </div>
    </form>`);
}

/* ---------- Actions ---------- */
function record(g, s, p) {
  g.events.push({ id: uid(), p: p || null, s, q: g.period, t: Date.now() });
  save(); buzz();
}

const actions = {
  nav: el => { closeModalIfOpen(); state.view = el.dataset.view; state.selected = null; render(); window.scrollTo(0, 0); },
  'new-game': () => newGameModal(),
  'open-game': el => {
    state.gameId = el.dataset.id; state.view = 'game'; state.selected = null;
    state.sub = getGame(el.dataset.id).final ? 'box' : 'track';
    render(); window.scrollTo(0, 0);
  },
  'close-modal': () => closeModal(),
  'edit-player': el => editPlayerModal(el.dataset.id),
  'delete-player': el => {
    const p = db.roster.find(x => x.id === el.dataset.id);
    if (!p || !confirm(`Remove ${playerLabel(p)} from the roster? Past games are not affected.`)) return;
    db.roster = db.roster.filter(x => x.id !== p.id); save(); closeModal(); render();
  },
  sub: el => { state.sub = el.dataset.sub; render(); },
  period: el => {
    const g = getGame(state.gameId);
    const prev = onCourt(g).map(p => p.id);
    g.period = el.dataset.q;
    if (!(g.lineups && g.lineups[g.period])) {   // new quarter starts with its planned five, else the current five
      const planned = planFor(g, g.period, 'start');
      setCourt(g, planned.length ? placeLineup(g, planned, prev) : prev);
    }
    if (!onCourt(g).some(p => p.id === state.selected)) state.selected = null;
    save(); render();
  },
  'sub-modal': () => {
    const g = getGame(state.gameId);
    const sel = onCourt(g).some(p => p.id === state.selected) ? state.selected : null;
    subPick = { out: sel, in: null, last: '' };
    subModal();
  },
  'sub-pick': el => {
    const g = getGame(state.gameId);
    const side = el.dataset.side, id = el.dataset.id;
    subPick[side] = subPick[side] === id ? null : id;
    const court = onCourt(g).map(p => p.id);
    const name = pid => esc(playerLabel(g.players.find(p => p.id === pid)));
    if (subPick.out && subPick.in) {
      setCourt(g, court.map(x => x === subPick.out ? subPick.in : x));
      subPick.last = `⇄ <b>${name(subPick.in)}</b> in for ${name(subPick.out)}`;
      if (state.selected === subPick.out) state.selected = null;
      subPick.out = subPick.in = null;
      save(); buzz(); render();
    } else if (subPick.in && court.length < COURT_SIZE) {
      setCourt(g, placeLineup(g, [...court, subPick.in]));   // still forming the five: arrange by role
      subPick.last = `+ <b>${name(subPick.in)}</b> on the court`;
      subPick.in = null;
      save(); buzz(); render();
    }
    subModal();
  },
  'sub-plan': el => {
    const g = getGame(state.gameId);
    setCourt(g, placeLineup(g, planFor(g, g.period, el.dataset.part), onCourt(g).map(p => p.id)));
    if (!onCourt(g).some(p => p.id === state.selected)) state.selected = null;
    subPick = { out: null, in: null, last: `✓ Planned ${el.dataset.part === 'start' ? 'start' : 'sub'} is on the court` };
    save(); buzz(); render(); subModal();
  },
  'plan-edit': el => { planEdit = { q: el.dataset.q, part: el.dataset.part }; planModal(); },
  'plan-toggle': el => {
    const g = getGame(state.gameId);
    const ids = planFor(g, planEdit.q, planEdit.part), id = el.dataset.id;
    planEdit.msg = '';
    if (ids.includes(id)) setPlan(g, planEdit.q, planEdit.part, ids.filter(x => x !== id));
    else if (ids.length >= COURT_SIZE) planEdit.msg = `Already ${COURT_SIZE} picked — tap someone to take them off first.`;
    else setPlan(g, planEdit.q, planEdit.part, [...ids, id]);
    save(); render(); planModal();
  },
  'plan-suggest': () => {
    const g = getGame(state.gameId);
    setPlan(g, planEdit.q, planEdit.part, suggestShift(g, planEdit.q, planEdit.part));
    planEdit.msg = 'Suggested the players with the fewest planned shifts.';
    save(); render(); planModal();
  },
  'plan-auto': () => {
    const g = getGame(state.gameId);
    const hasPlan = shiftOrder().some(([q, part]) => planFor(g, q, part).length);
    if (hasPlan && !confirm('Replace your current plan with an evenly balanced rotation?')) return;
    g.plan = {};
    const season = seasonQuarters(g);
    shiftOrder().forEach(([q, part]) => setPlan(g, q, part, suggestShift(g, q, part, season)));
    save(); render(); toast('Rotation filled — tap any line to adjust');
  },
  'plan-clear': () => {
    if (!confirm('Clear the whole plan?')) return;
    getGame(state.gameId).plan = {}; save(); render();
  },
  select: el => { state.selected = state.selected === el.dataset.id ? null : el.dataset.id; state.posPick = null; render(); },
  pos: el => { state.posPick = state.posPick === el.dataset.id ? null : el.dataset.id; render(); },
  'pos-cancel': () => { state.posPick = null; render(); },
  'pos-to': el => {
    const g = getGame(state.gameId);
    const ids = onCourt(g).map(p => p.id);
    const from = ids.indexOf(state.posPick), to = Number(el.dataset.i);
    state.posPick = null;
    if (from < 0 || from === to) { render(); return; }
    // A position fix is a correction, so the two players drop the positions they're leaving this quarter
    const qp = (g.pos && g.pos[g.period]) || {};
    [[ids[from], POSITIONS[from]], [ids[to], POSITIONS[to]]].forEach(([id, old]) => {
      if (qp[id]) qp[id] = qp[id].filter(x => x !== old);
    });
    [ids[from], ids[to]] = [ids[to], ids[from]];
    setCourt(g, ids); save(); render();
    toast(`${g.players.find(p => p.id === ids[to]).name} → ${POSITIONS[to]}`);
  },
  stat: el => {
    const g = getGame(state.gameId);
    const p = g.players.find(x => x.id === state.selected);
    if (!p) return;
    record(g, el.dataset.s, p.id);
    const L = box(g).lines[p.id];
    state.selected = null;
    render();
    let msg = `✓ ${playerLabel(p)} · ${STATS[el.dataset.s].label}`;
    if (el.dataset.s === 'PF') msg = L.PF >= 5 ? `⛔ ${playerLabel(p)} has 5 fouls — OUT` : L.PF === 4 ? `⚠️ ${playerLabel(p)} has 4 fouls` : msg;
    toast(msg);
  },
  opp: el => { const g = getGame(state.gameId); record(g, el.dataset.s); render(); toast(`${g.opponent} +${OPP[el.dataset.s]}`); },
  undo: () => {
    const g = getGame(state.gameId); const e = g.events.pop();
    if (e) { save(); render(); toast('Undid: ' + (e.s in OPP ? `${g.opponent} +${OPP[e.s]}` : STATS[e.s].label)); }
  },
  'del-event': el => {
    const g = getGame(state.gameId);
    g.events = g.events.filter(e => e.id !== el.dataset.id); save(); render(); toast('Removed');
  },
  'game-menu': () => gameMenuModal(),
  'game-players': () => gamePlayersModal(),
  'game-details': () => gameDetailsModal(),
  'end-game': () => {
    if (!confirm('End this game and mark it final? You can reopen it later.')) return;
    const g = getGame(state.gameId); g.final = true; save(); closeModalIfOpen();
    state.sub = 'share'; state.selected = null; render(); window.scrollTo(0, 0);
  },
  reopen: () => { const g = getGame(state.gameId); g.final = false; save(); closeModalIfOpen(); state.sub = 'track'; render(); },
  'delete-game': () => {
    const g = getGame(state.gameId);
    if (!confirm(`Delete the game ${g.home ? 'vs' : '@'} ${g.opponent}? This can't be undone.`)) return;
    db.games = db.games.filter(x => x.id !== g.id); save(); closeModal(); state.view = 'games'; render();
  },
  'share-csv': () => shareCSV(getGame(state.gameId)),
  'share-game': () => shareGame(getGame(state.gameId)),
  'import-game': () => document.getElementById('import-file').click(),
  'share-text': () => shareText(getGame(state.gameId)),
  'copy-text': () => copyText(summaryText(getGame(state.gameId))),
  'download-csv': () => { const g = getGame(state.gameId); download(csvFileName(g), gameCSV(g), 'text/csv'); },
  backup: () => download(`jv-stats-backup_${today()}.json`, JSON.stringify(db, null, 2), 'application/json'),
  restore: () => document.getElementById('restore-file').click(),
  wipe: () => {
    if (!confirm('Delete ALL players and games from this phone?')) return;
    if (!confirm('Are you sure? Consider backing up first.')) return;
    db = defaultDB(); save(); render(); toast('All data deleted');
  },
};
function closeModalIfOpen() { if ($modal.open) closeModal(); }

const forms = {
  'add-player': (f, fd) => {
    const num = fd.get('num').trim(), name = fd.get('name').trim();
    if (!num || !name) return;
    if (db.roster.some(p => p.num === num) && !confirm(`#${num} is already on the roster. Add anyway?`)) return;
    db.roster.push({ id: uid(), num, name, role: fd.get('role') || '' }); save(); render();
    const input = $app.querySelector('[data-form="add-player"] input[name="num"]'); if (input) input.focus();
    toast(`Added #${num} ${name}`);
  },
  'edit-player': (f, fd) => {
    const p = db.roster.find(x => x.id === f.dataset.id); if (!p) return;
    p.num = fd.get('num').trim(); p.name = fd.get('name').trim(); p.role = fd.get('role') || '';
    save(); closeModal(); render();
  },
  'new-game': (f, fd) => {
    const ids = new Set(fd.getAll('p'));
    const players = db.roster.filter(p => ids.has(p.id)).map(gamePlayer);
    if (!players.length) { toast('Pick at least one player'); return; }
    const g = { id: uid(), created: Date.now(), opponent: fd.get('opponent').trim(), date: fd.get('date'),
      home: fd.get('home') === '1', period: 'Q1', final: false, players, lineups: {}, events: [] };
    db.games.push(g); save(); closeModal();
    Object.assign(state, { view: 'game', gameId: g.id, sub: 'track', selected: null }); render(); window.scrollTo(0, 0);
    actions['sub-modal']();   // pick the starting five right away
  },
  'game-players': (f, fd) => {
    const g = getGame(state.gameId);
    const keep = new Set([...fd.getAll('p'), ...g.events.map(e => e.p).filter(Boolean)]);
    const existing = g.players.filter(p => keep.has(p.id));
    const have = new Set(existing.map(p => p.id));
    const added = db.roster.filter(p => keep.has(p.id) && !have.has(p.id)).map(gamePlayer);
    g.players = [...existing, ...added]; save(); closeModal(); render();
  },
  'game-details': (f, fd) => {
    const g = getGame(state.gameId);
    g.opponent = fd.get('opponent').trim(); g.date = fd.get('date'); g.home = fd.get('home') === '1';
    save(); closeModal(); render();
  },
  'team-name': (f, fd) => { db.teamName = fd.get('teamName').trim() || 'JV Girls'; save(); render(); toast('Saved'); },
};

/* ---------- Event wiring ---------- */
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.action];
  if (fn) { e.preventDefault(); fn(el); }
});
document.addEventListener('submit', e => {
  const f = e.target.closest('form[data-form]');
  if (!f) return;
  e.preventDefault();
  const fn = forms[f.dataset.form];
  if (fn) fn(f, new FormData(f));
});
document.addEventListener('change', async e => {
  if (e.target.id === 'import-file' && e.target.files.length) {
    const files = [...e.target.files]; e.target.value = '';
    await importGameFiles(files); return;
  }
  if (e.target.id !== 'restore-file' || !e.target.files[0]) return;
  try {
    const data = JSON.parse(await e.target.files[0].text());
    if (!Array.isArray(data.roster) || !Array.isArray(data.games)) throw new Error('bad file');
    if (!confirm(`Restore ${data.games.length} games and ${data.roster.length} players? This replaces what's on this phone.`)) return;
    db = Object.assign(defaultDB(), data); save(); render(); toast('Restored');
  } catch (err) { toast("That doesn't look like a JV Stats backup"); }
  e.target.value = '';
});
$modal.addEventListener('click', e => { if (e.target === $modal) closeModal(); }); // tap outside to close

/* ---------- Keep screen awake while tracking (where supported) ---------- */
let wakeLock = null;
async function requestWakeLock() {
  if (wakeLock || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
  catch (e) { wakeLock = null; }
}
function releaseWakeLock() { if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; } }
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.view === 'game' && state.sub === 'track') requestWakeLock();
});

/* ---------- Offline support ---------- */
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;   // first install: no reload needed
    reloading = true; location.reload();         // new version installed: reload once
  });
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}
// Ask the browser not to clear our data when space is low
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

render();
