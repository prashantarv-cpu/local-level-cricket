/* Local Level Cricket — app.js
   Uses the existing Supabase tables and existing index.html element IDs. */
const { createClient } = window.supabase;
const sb = createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
const state = {
  tournaments: [], matches: [], teams: [], players: [], selectedMatch: null,
  innings: [], events: [], xi: [], selectedStriker: '', selectedNonStriker: '',
  selectedBowler: '', online: navigator.onLine, adminTab: 'setup', busy: false
};
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const num = n => Number(n || 0);
const isLegal = e => !['wide','noball','no-ball','no_ball'].includes(String(e.extras_type || '').toLowerCase());

function toast(message) {
  const el = $('status');
  if (el) el.textContent = message;
  window.setTimeout(() => { if (el) el.textContent = state.online ? 'Online' : 'Offline'; }, 3000);
}
function team(id) { return state.teams.find(x => x.id === id)?.name || '—'; }
function player(id) { return state.players.find(x => x.id === id)?.name || '—'; }
function selectedTeamPlayers(teamId) {
  const ids = new Set(state.xi.filter(x => x.team_id === teamId && !x.substitute).map(x => x.player_id));
  const chosen = state.players.filter(p => p.team_id === teamId && ids.has(p.id));
  return chosen.length ? chosen : state.players.filter(p => p.team_id === teamId);
}
function setOptions(el, list, selected, placeholder, labelFn) {
  if (!el) return;
  el.innerHTML = `<option value="">${esc(placeholder)}</option>` +
    list.map(x => `<option value="${esc(x.id)}" ${x.id === selected ? 'selected' : ''}>${esc(labelFn(x))}</option>`).join('');
}
function safeError(error) {
  if (error) { console.error(error); toast(error.message || 'Database error'); return true; }
  return false;
}

async function loadAll() {
  try {
    const [t, m, tm, p] = await Promise.all([
      sb.from('tournaments').select('*').order('created_at', {ascending:false}),
      sb.from('matches').select('*').order('scheduled_at', {ascending:true}),
      sb.from('teams').select('*').order('name'),
      sb.from('players').select('*').order('name')
    ]);
    if (t.error || m.error || tm.error || p.error) {
      [t,m,tm,p].forEach(r => { if (r.error) console.error(r.error); });
      toast('डेटाबेस पढ्न समस्या भयो');
    }
    state.tournaments = t.data || [];
    state.matches = m.data || [];
    state.teams = tm.data || [];
    state.players = p.data || [];
    renderLive();
    renderTournament();
    renderMatchSelect();
    renderAdmin();
    renderStats();
  } catch (e) {
    console.error(e);
    toast('लोड गर्न सकिएन');
  }
}

function nav(page) {
  document.querySelectorAll('.page').forEach(x => x.classList.add('hidden'));
  const target = $('page-' + page);
  if (target) target.classList.remove('hidden');
}
document.querySelectorAll('[data-page]').forEach(b => b.addEventListener('click', () => nav(b.dataset.page)));
document.querySelectorAll('[data-admin]').forEach(b => b.addEventListener('click', () => {
  state.adminTab = b.dataset.admin;
  renderAdmin();
}));

function renderLive() {
  const el = $('liveMatches');
  if (!el) return;
  const live = state.matches.filter(m => ['live','break'].includes(String(m.status || '').toLowerCase()));
  el.innerHTML = live.length
    ? live.map(m => `<div class="match"><span class="badge live">● LIVE</span>
        <h3>${esc(team(m.team_a))} vs ${esc(team(m.team_b))}</h3>
        <div>${esc(m.venue || 'Venue not set')}</div>
        <button onclick="openScore('${m.id}')">Open live score</button></div>`).join('')
    : '<div class="card">अहिले कुनै live match छैन।</div>';
}

function renderTournament() {
  const s = $('tournamentSelect');
  if (!s) return;
  const old = s.value;
  s.innerHTML = state.tournaments.map(t =>
    `<option value="${t.id}">${esc(t.name)} (${esc(t.status || 'upcoming')})</option>`).join('');
  if (state.tournaments.some(t => t.id === old)) s.value = old;
  const tid = s.value || state.tournaments[0]?.id;
  const ms = state.matches.filter(m => !tid || m.tournament_id === tid);
  const list = $('fixtureList');
  if (list) {
    list.innerHTML = '<h3>Fixtures</h3>' + (ms.length
      ? '<div class="grid">' + ms.map(m => `<div class="card"><b>${esc(m.round_name || 'Match')}</b><br>
          ${esc(team(m.team_a))} vs ${esc(team(m.team_b))}<br>
          <span class="mini">${esc(m.status || 'scheduled')} • ${esc(m.venue || '')}</span><br>
          <button onclick="openScore('${m.id}')">Score</button></div>`).join('') + '</div>'
      : '<p>No fixtures.</p>');
  }
  renderPoints(tid);
}

async function renderPoints(tid) {
  const el = $('pointsTable');
  if (!el) return;
  if (!tid) { el.innerHTML = ''; return; }
  const {data, error} = await sb.from('points_table').select('*')
    .eq('tournament_id', tid).order('points', {ascending:false}).order('nrr', {ascending:false});
  el.innerHTML = '<h3>Points Table</h3>' + (error
    ? `<p>${esc(error.message)}</p>`
    : `<table class="table"><tr><th>Team</th><th>P</th><th>W</th><th>L</th><th>Pts</th><th>NRR</th></tr>
       ${(data || []).map(x => `<tr><td>${esc(x.name || team(x.team_id))}</td>
       <td>${num(x.played)}</td><td>${num(x.won)}</td><td>${num(x.lost)}</td>
       <td>${num(x.points)}</td><td>${num(x.nrr).toFixed(3)}</td></tr>`).join('')}</table>`);
}
if ($('refreshTournament')) $('refreshTournament').onclick = renderTournament;
if ($('tournamentSelect')) $('tournamentSelect').onchange = renderTournament;

function renderMatchSelect() {
  const el = $('scoreMatch');
  if (!el) return;
  el.innerHTML = state.matches.map(m =>
    `<option value="${m.id}">${esc(team(m.team_a))} vs ${esc(team(m.team_b))} — ${esc(m.status || 'scheduled')}</option>`).join('');
  if (state.selectedMatch && state.matches.some(m => m.id === state.selectedMatch)) el.value = state.selectedMatch;
}
if ($('loadScore')) $('loadScore').onclick = () => {
  if ($('scoreMatch').value) openScore($('scoreMatch').value);
};

async function openScore(id) {
  if (!id) return;
  nav('scorer');
  state.selectedMatch = id;
  const [matchRes, inn, ev, xi] = await Promise.all([
    sb.from('matches').select('*').eq('id', id).single(),
    sb.from('innings').select('*').eq('match_id', id).order('innings_no'),
    sb.from('ball_events').select('*').eq('match_id', id).order('created_at', {ascending:true}),
    sb.from('playing_xi').select('*').eq('match_id', id)
  ]);
  if (matchRes.error) { toast(matchRes.error.message); return; }
  state.match = matchRes.data;
  if (inn.error || ev.error || xi.error) console.error(inn.error || ev.error || xi.error);
  state.innings = inn.data || [];
  state.events = ev.data || [];
  state.xi = xi.data || [];
  const current = currentInn();
  if (current) {
    const batters = selectedTeamPlayers(current.batting_team);
    if (!batters.some(p => p.id === state.selectedStriker)) state.selectedStriker = batters[0]?.id || '';
    if (!batters.some(p => p.id === state.selectedNonStriker) || state.selectedNonStriker === state.selectedStriker)
      state.selectedNonStriker = batters.find(p => p.id !== state.selectedStriker)?.id || '';
    const bowlers = selectedTeamPlayers(current.bowling_team);
    if (!bowlers.some(p => p.id === state.selectedBowler)) state.selectedBowler = bowlers[0]?.id || '';
  }
  renderScore();
}
function currentInn() {
  return state.innings.find(i => !i.completed) || state.innings[state.innings.length - 1] || null;
}
function totals(innId) {
  const ev = state.events.filter(e => e.innings_id === innId);
  return {
    runs: ev.reduce((a,e) => a + num(e.total_runs), 0),
    wickets: ev.filter(e => e.wicket).length,
    balls: ev.reduce((a,e) => a + (isLegal(e) ? 1 : 0), 0),
    fours: ev.filter(e => num(e.runs_bat) === 4).length,
    sixes: ev.filter(e => num(e.runs_bat) === 6).length
  };
}
function oversText(balls) { return `${Math.floor(balls / 6)}.${balls % 6}`; }
