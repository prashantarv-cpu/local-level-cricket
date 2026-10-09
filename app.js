/* Local Level Cricket — app.js */
const { createClient } = window.supabase;
const sb = createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

const state = {
  tournaments: [], matches: [], teams: [], players: [],
  selectedMatch: null, innings: [], events: [], xi: [],
  online: navigator.onLine, adminTab: "setup", busy: false,
  selectedStriker: "", selectedNonStriker: "", selectedBowler: ""
};

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({
  "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"
}[c]));
const n = v => Number(v || 0);
const msg = (s, error = false) => {
  const el = $("status");
  if (el) {
    el.textContent = s;
    el.style.color = error ? "#c62828" : "#16803d";
  }
};
const err = e => {
  console.error(e);
  msg(e?.message || "काम पूरा भएन। Supabase सेटिङ जाँच गर्नुहोस्।", true);
};
const db = async q => {
  const { data, error } = await q;
  if (error) throw error;
  return data;
};
const byId = (arr, id) => arr.find(x => x.id === id);
const teamName = id => byId(state.teams, id)?.name || "अज्ञात टिम";
const playerName = id => byId(state.players, id)?.name || "अज्ञात खेलाडी";
const currentInn = () =>
  state.innings.find(i => !i.completed) || state.innings[state.innings.length - 1];

function oversText(balls) {
  balls = n(balls);
  return `${Math.floor(balls / 6)}.${balls % 6}`;
}
function legalEvent(e) {
  return !["wide", "wd", "noball", "no-ball", "no_ball"]
    .includes(String(e.extras_type || "").toLowerCase());
}
function eventTotal(e) {
  return n(e.total_runs);
}
function totals(events) {
  return events.reduce((a, e) => {
    a.runs += eventTotal(e);
    if (e.wicket) a.wickets++;
    if (legalEvent(e)) a.balls++;
    if (n(e.runs_bat) === 4) a.fours++;
    if (n(e.runs_bat) === 6) a.sixes++;
    return a;
  }, { runs: 0, wickets: 0, balls: 0, fours: 0, sixes: 0 });
}
function matchEvents(inningsId) {
  return state.events.filter(e => e.innings_id === inningsId);
}
function inningsTotal(inn) {
  return totals(matchEvents(inn.id));
}
function inningsScore(inn) {
  const t = inningsTotal(inn);
  return `${t.runs}/${t.wickets} (${oversText(t.balls)} ओभर)`;
}
function getMatch(id) {
  return state.matches.find(m => m.id === id);
}
function playersForTeam(teamId, matchId = state.selectedMatch?.id) {
  const chosen = state.xi.filter(x =>
    x.team_id === teamId && (!matchId || x.match_id === matchId) && !x.substitute
  );
  const ids = chosen.map(x => x.player_id);
  return ids.length
    ? state.players.filter(p => ids.includes(p.id))
    : state.players.filter(p => p.team_id === teamId);
}
function options(items, value, label) {
  return items.map(x =>
    `<option value="${esc(value(x))}">${esc(label(x))}</option>`
  ).join("");
}
function selectHtml(id, items, value, label, selected = "") {
  return `<select id="${id}">
    <option value="">छान्नुहोस्</option>
    ${options(items, value, label)}
  </select>`;
}

async function loadAll() {
  try {
    const [tournaments, matches, teams, players] = await Promise.all([
      db(sb.from("tournaments").select("*").order("created_at", { ascending: false })),
      db(sb.from("matches").select("*").order("scheduled_at", { ascending: true })),
      db(sb.from("teams").select("*").order("name")),
      db(sb.from("players").select("*").order("name"))
    ]);
    state.tournaments = tournaments || [];
    state.matches = matches || [];
    state.teams = teams || [];
    state.players = players || [];
    renderAll();
    const params = new URLSearchParams(location.search);
    const matchId = params.get("match");
    if (matchId) await openScore(matchId);
  } catch (e) { err(e); }
}

function renderAll() {
  renderTournamentSelect();
  renderLive();
  renderTournament();
  renderPoints();
  renderMatchSelect();
  renderAdmin();
  renderStats();
}
function renderTournamentSelect() {
  const el = $("tournamentSelect");
  if (!el) return;
  const old = el.value;
  el.innerHTML = `<option value="">सबै टुर्नामेन्ट</option>` +
    options(state.tournaments, x => x.id, x => x.name);
  if (state.tournaments.some(x => x.id === old)) el.value = old;
}
function renderLive() {
  const el = $("liveMatches");
  if (!el) return;
  const live = state.matches.filter(m =>
    ["live", "in progress", "in_progress"].includes(String(m.status || "").toLowerCase())
  );
  el.innerHTML = live.length ? live.map(m => `
    <article class="match-card">
      <b>${esc(teamName(m.team_a))} vs ${esc(teamName(m.team_b))}</b>
      <p>${esc(m.venue || "")}</p>
      <p>${esc(m.result_text || "खेल जारी छ")}</p>
      <button onclick="openScore('${m.id}')">लाइभ स्कोर</button>
    </article>`).join("") : "<p>अहिले कुनै खेल लाइभ छैन।</p>";
}
function renderTournament() {
  const el = $("fixtureList");
  if (!el) return;
  const tid = $("tournamentSelect")?.value || "";
  const list = state.matches.filter(m => !tid || m.tournament_id === tid);
  el.innerHTML = list.length ? list.map(m => `
    <article class="match-card">
      <b>${esc(teamName(m.team_a))} vs ${esc(teamName(m.team_b))}</b>
      <p>${esc(m.round_name || "")} ${m.match_no ? " • खेल "+m.match_no : ""}</p>
      <p>${esc(m.venue || "")}</p>
      <p>${esc(m.scheduled_at ? new Date(m.scheduled_at).toLocaleString() : "")}</p>
      <p>${esc(m.status || "scheduled")} ${esc(m.result_text || "")}</p>
      <button onclick="openScore('${m.id}')">स्कोर खोल्नुहोस्</button>
    </article>`).join("") : "<p>खेल तालिका उपलब्ध छैन।</p>";
}
async function renderPoints() {
  const el = $("pointsTable");
  if (!el) return;
  const tid = $("tournamentSelect")?.value || "";
  try {
    let q = sb.from("points_table").select("*");
    if (tid) q = q.eq("tournament_id", tid);
    const rows = await db(q.order("points", { ascending: false }));
    el.innerHTML = `<table><thead><tr>
      <th>टिम</th><th>खेलेको</th><th>जित</th><th>हार</th><th>अङ्क</th><th>NRR</th>
    </tr></thead><tbody>${(rows || []).map(r => `<tr>
      <td>${esc(r.name || teamName(r.team_id))}</td>
      <td>${n(r.played)}</td><td>${n(r.won)}</td><td>${n(r.lost)}</td>
      <td>${n(r.points)}</td><td>${n(r.nrr).toFixed(3)}</td>
    </tr>`).join("")}</tbody></table>`;
  } catch (e) {
    el.innerHTML = "<p>अङ्क तालिका उपलब्ध छैन।</p>";
    console.warn(e);
  }
}
function renderMatchSelect() {
  const el = $("scoreMatch");
  if (!el) return;
  const old = el.value;
  el.innerHTML = `<option value="">खेल छान्नुहोस्</option>` +
    options(state.matches, m => m.id,
      m => `${teamName(m.team_a)} vs ${teamName(m.team_b)} (${m.status || "scheduled"})`);
  if (state.matches.some(m => m.id === old)) el.value = old;
}

async function openScore(id) {
  try {
    const match = await db(sb.from("matches").select("*").eq("id", id).single());
    state.selectedMatch = match;
    const [innings, events, xi] = await Promise.all([
      db(sb.from("innings").select("*").eq("match_id", id).order("innings_no")),
      db(sb.from("ball_events").select("*").eq("match_id", id).order("created_at")),
      db(sb.from("playing_xi").select("*").eq("match_id", id))
    ]);
    state.innings = innings || [];
    state.events = events || [];
    state.xi = xi || [];
    const inn = currentInn();
    state.selectedStriker = inn?.batting_team
      ? state.selectedStriker : "";
    renderScoreConsole();
    if ($("scoreMatch")) $("scoreMatch").value = id;
    msg("खेलको स्कोर खोलियो।");
  } catch (e) { err(e); }
}

function renderScoreConsole() {
  const el = $("scoreConsole");
  if (!el) return;
  const m = state.selectedMatch;
  if (!m) {
    el.innerHTML = "<p>स्कोर हेर्न खेल छान्नुहोस्।</p>";
    return;
  }
  const inn = currentInn();
  const allInnings = state.innings;
  const t = inn ? inningsTotal(inn) : totals([]);
  const battingId = inn?.batting_team || m.team_a;
  const bowlingId = inn?.bowling_team || (battingId === m.team_a ? m.team_b : m.team_a);
  const batters = playersForTeam(battingId);
  const bowlers = playersForTeam(bowlingId);
  if (state.selectedStriker && !batters.some(p => p.id === state.selectedStriker))
    state.selectedStriker = "";
  if (state.selectedNonStriker && !batters.some(p => p.id === state.selectedNonStriker))
    state.selectedNonStriker = "";
  if (state.selectedBowler && !bowlers.some(p => p.id === state.selectedBowler))
    state.selectedBowler = "";

  el.innerHTML = `
    <h3>${esc(teamName(m.team_a))} vs ${esc(teamName(m.team_b))}</h3>
    <p>मैदान: ${esc(m.venue || "तोकिएको छैन")}</p>
    ${allInnings.map(i => `
      <section class="innings-card">
        <b>${i.innings_no} औँ इनिङ्स — ${esc(teamName(i.batting_team))}</b>
        <p>${esc(inningsScore(i))}</p>
      </section>`).join("")}
    <h3>${inn ? esc(teamName(battingId)) + " : " + t.runs + "/" + t.wickets : "इनिङ्स सुरु गर्नुहोस्"}</h3>
    <p>ओभर: ${oversText(t.balls)} / ${n(state.tournaments.find(x => x.id === m.tournament_id)?.overs_per_innings || 20)}</p>
    <p>चौका: ${t.fours} | छक्का: ${t.sixes}</p>
    ${inn && !inn.completed ? `
      <div class="score-selectors">
        <label>स्ट्राइकर ${selectHtml("strikerSelect", batters, p => p.id, p => p.name, state.selectedStriker)}</label>
        <label>नन-स्ट्राइकर ${selectHtml("nonStrikerSelect", batters, p => p.id, p => p.name, state.selectedNonStriker)}</label>
        <label>बलर ${selectHtml("bowlerSelect", bowlers, p => p.id, p => p.name, state.selectedBowler)}</label>
      </div>
      <h4>रन</h4>
      <div class="score-buttons">
        ${[0,1,2,3,4,6].map(r => `<button onclick="addBall(${r},'')">${r}</button>`).join(" ")}
      </div>
      <h4>एक्स्ट्रा</h4>
      <button onclick="addBall(0,'wide')">Wide +1</button>
      <button onclick="addBall(0,'noball')">No-ball +1</button>
      <button onclick="addBall(0,'bye')">Bye +1</button>
      <button onclick="addBall(0,'legbye')">Leg bye +1</button>
      <h4>विकेट</h4>
      <label>विकेटको प्रकार
        <select id="wicketType">
          <option value="bowled">Bowled</option><option value="caught">Caught</option>
          <option value="lbw">LBW</option><option value="run out">Run out</option>
          <option value="stumped">Stumped</option><option value="hit wicket">Hit wicket</option>
          <option value="retired hurt">Retired hurt</option>
        </select>
      </label>
      <label>आउट भएको खेलाडी
        ${selectHtml("dismissedPlayer", batters, p => p.id, p => p.name)}
      </label>
      <button onclick="addWicket()">विकेट रेकर्ड गर्नुहोस्</button>
      <hr>
      <button onclick="swapBatters()">ब्याट्सम्यान परिवर्तन</button>
      <button onclick="undoBall()">अघिल्लो बल हटाउनुहोस्</button>
      <button onclick="endInnings()">इनिङ्स समाप्त</button>
      <button onclick="setDls()">DLS लक्ष्य राख्नुहोस्</button>
    ` : `
      <button onclick="startInnings()">इनिङ्स सुरु गर्नुहोस्</button>
      <button onclick="endMatch()">खेल समाप्त गर्नुहोस्</button>
    `}
    <h4>बल-बाइ-बल विवरण</h4>
    <ol>${matchEvents(inn?.id).slice().reverse().map(e => `
      <li>${esc(e.over_no)}.${esc(e.ball_no)} —
        ${esc(playerName(e.striker))}: ${n(e.runs_bat)} रन,
        अतिरिक्त ${n(e.extras_runs)} ${esc(e.extras_type || "")}
        ${e.wicket ? " • विकेट ("+esc(e.wicket_type || "")+")" : ""}
        ${e.commentary ? " • "+esc(e.commentary) : ""}
      </li>`).join("")}</ol>
  `;

  const s = $("strikerSelect");
  if (s) s.value = state.selectedStriker;
  const ns = $("nonStrikerSelect");
  if (ns) ns.value = state.selectedNonStriker;
  const b = $("bowlerSelect");
  if (b) b.value = state.selectedBowler;
  if (s) s.onchange = () => state.selectedStriker = s.value;
  if (ns) ns.onchange = () => state.selectedNonStriker = ns.value;
  if (b) b.onchange = () => state.selectedBowler = b.value;
}

function selectedBattingBowling() {
  const inn = currentInn();
  if (!inn) throw new Error("पहिले इनिङ्स सुरु गर्नुहोस्।");
  const striker = $("strikerSelect")?.value || state.selectedStriker;
  const non = $("nonStrikerSelect")?.value || state.selectedNonStriker;
  const bowler = $("bowlerSelect")?.value || state.selectedBowler;
  if (!striker || !non || !bowler) throw new Error("स्ट्राइकर, नन-स्ट्राइकर र बलर छान्नुहोस्।");
  if (striker === non) throw new Error("दुवै ब्याट्सम्यान फरक हुनुपर्छ।");
  state.selectedStriker = striker;
  state.selectedNonStriker = non;
  state.selectedBowler = bowler;
  return { inn, striker, non, bowler };
}

async function addBall(runs, extraType, wicket = false) {
  if (state.busy) return;
  state.busy = true;
  try {
    const { inn, striker, non, bowler } = selectedBattingBowling();
    const events = matchEvents(inn.id);
    const before = totals(events);
    const extras = extraType ? 1 : 0;
    const legal = !["wide", "noball"].includes(extraType);
    const overNo = Math.floor(before.balls / 6) + 1;
    const ballNo = before.balls % 6 + 1;
    const row = {
      match_id: state.selectedMatch.id,
      innings_id: inn.id,
      over_no: overNo,
      ball_no: ballNo,
      striker, non_striker: non, bowler,
      runs_bat: n(runs),
      extras_type: extraType || null,
      extras_runs: extras,
      total_runs: n(runs) + extras,
      wicket,
      wicket_type: wicket ? ($("wicketType")?.value || "bowled") : null,
      dismissed_player: wicket ? ($("dismissedPlayer")?.value || striker) : null,
      commentary: null
    };
    if (wicket && !row.dismissed_player) throw new Error("आउट भएको खेलाडी छान्नुहोस्।");
    await db(sb.from("ball_events").insert(row));
    const afterBalls = before.balls + (legal ? 1 : 0);
    const newTotal = before.runs + row.total_runs;
    const newWickets = before.wickets + (wicket ? 1 : 0);
    await db(sb.from("innings").update({
      runs: newTotal, wickets: newWickets, legal_balls: afterBalls
    }).eq("id", inn.id));
    if (legal && afterBalls % 6 === 0) {
      const temp = state.selectedStriker;
      state.selectedStriker = state.selectedNonStriker;
      state.selectedNonStriker = temp;
    }
    await openScore(state.selectedMatch.id);
    msg("बलको स्कोर सुरक्षित भयो।");
  } catch (e) { err(e); }
  finally { state.busy = false; }
}

async function addWicket() {
  try {
    const dismissed = $("dismissedPlayer")?.value;
    if (!dismissed) throw new Error("आउट भएको खेलाडी छान्नुहोस्।");
    await addBall(0, "", true);
  } catch (e) { err(e); }
}
function swapBatters() {
  const x = state.selectedStriker;
  state.selectedStriker = state.selectedNonStriker;
  state.selectedNonStriker = x;
  renderScoreConsole();
}
async function undoBall() {
  try {
    const inn = currentInn();
    if (!inn) throw new Error("इनिङ्स भेटिएन।");
    const events = matchEvents(inn.id);
    const last = events[events.length - 1];
    if (!last) throw new Error("हटाउन बल छैन।");
    if (!confirm("अघिल्लो बल हटाउने?")) return;
    await db(sb.from("ball_events").delete().eq("id", last.id));
    const remaining = events.filter(e => e.id !== last.id);
    const t = totals(remaining);
    await db(sb.from("innings").update({
      runs: t.runs, wickets: t.wickets, legal_balls: t.balls
    }).eq("id", inn.id));
    await openScore(state.selectedMatch.id);
    msg("अघिल्लो बल हटाइयो।");
  } catch (e) { err(e); }
}

async function startInnings() {
  try {
    const m = state.selectedMatch;
    if (!m) throw new Error("पहिले खेल छान्नुहोस्।");
    const incomplete = state.innings.find(i => !i.completed);
    if (incomplete) throw new Error("हालको इनिङ्स पहिले समाप्त गर्नुहोस्।");
    if (state.innings.length >= 2) throw new Error("दुवै इनिङ्स पूरा भइसकेका छन्।");
    const no = state.innings.length + 1;
    let batting, bowling;
    if (no === 1) {
      const tossA = m.toss_winner === m.team_a;
      const tossB = m.toss_winner === m.team_b;
      if (m.toss_winner && m.toss_decision) {
        const winner = m.toss_winner;
        batting = m.toss_decision.toLowerCase() === "bat"
          ? winner : (winner === m.team_a ? m.team_b : m.team_a);
      } else {
        batting = m.team_a;
      }
      bowling = batting === m.team_a ? m.team_b : m.team_a;
    } else {
      const first = state.innings[0];
      batting = first.bowling_team;
      bowling = first.batting_team;
    }
    const firstTotal = no === 2 ? inningsTotal(state.innings[0]).runs : 0;
    const tournament = byId(state.tournaments, m.tournament_id);
    await db(sb.from("innings").insert({
      match_id: m.id, innings_no: no,
      batting_team: batting, bowling_team: bowling,
      target: no === 2 ? firstTotal + 1 : null,
      runs: 0, wickets: 0, legal_balls: 0, completed: false,
      started_at: new Date().toISOString()
    }));
    await db(sb.from("matches").update({ status: "live" }).eq("id", m.id));
    state.selectedStriker = "";
    state.selectedNonStriker = "";
    state.selectedBowler = "";
    await openScore(m.id);
    msg(`${no} औँ इनिङ्स सुरु भयो।`);
  } catch (e) { err(e); }
}

async function endInnings() {
  try {
    const inn = currentInn();
    if (!inn) throw new Error("इनिङ्स भेटिएन।");
    const t = inningsTotal(inn);
    await db(sb.from("innings").update({
      completed: true, runs: t.runs, wickets: t.wickets, legal_balls: t.balls
    }).eq("id", inn.id));
    await openScore(state.selectedMatch.id);
    if (state.innings.length < 2) {
      msg("पहिलो इनिङ्स समाप्त भयो। अब दोस्रो इनिङ्स सुरु गर्नुहोस्।");
    } else {
      msg("दोस्रो इनिङ्स समाप्त भयो। खेल समाप्त गर्न सक्नुहुन्छ।");
    }
  } catch (e) { err(e); }
}

async function setDls() {
  try {
    const inn = currentInn();
    if (!inn) throw new Error("इनिङ्स भेटिएन।");
    const value = prompt("DLS लक्ष्य कति राख्ने?");
    if (value === null || value.trim() === "" || !Number.isFinite(Number(value)))
      return;
    await db(sb.from("matches").update({ dls_target: Number(value) })
      .eq("id", state.selectedMatch.id));
    await db(sb.from("innings").update({ target: Number(value) }).eq("id", inn.id));
    await openScore(state.selectedMatch.id);
    msg("DLS लक्ष्य सुरक्षित भयो।");
  } catch (e) { err(e); }
}

async function endMatch() {
  try {
    const m = state.selectedMatch;
    if (!m) throw new Error("खेल छान्नुहोस्।");
    if (!confirm("यो खेल समाप्त गर्ने?")) return;
    const a = state.innings.find(i => i.innings_no === 1);
    const b = state.innings.find(i => i.innings_no === 2);
    let winner = null, result = "खेल समाप्त";
    if (a && b) {
      const ta = inningsTotal(a).runs, tb = inningsTotal(b).runs;
      if (ta > tb) {
        winner = a.batting_team;
        result = `${teamName(winner)} ${ta - tb} रनले विजयी`;
      } else if (tb > ta) {
        winner = b.batting_team;
        result = `${teamName(winner)} ${10 - inningsTotal(b).wickets} विकेटले विजयी`;
      } else {
        result = "खेल बराबरी";
      }
    }
    await db(sb.from("matches").update({
      status: "completed", winner_team: winner, result_text: result
    }).eq("id", m.id));
    await loadAll();
    await openScore(m.id);
    msg(result);
  } catch (e) { err(e); }
}

/* ADMIN */
function renderAdmin() {
  const el = $("adminContent");
  if (!el) return;
  const tab = state.adminTab;
  if (tab === "setup") {
    el.innerHTML = `
      <h3>नयाँ टुर्नामेन्ट</h3>
      <input id="newTournament" placeholder="टुर्नामेन्टको नाम">
      <input id="newVenue" placeholder="मैदान">
      <input id="newSeason" placeholder="सिजन">
      <select id="newFormat"><option value="T20">T20</option><option value="ODI">ODI</option><option value="T10">T10</option><option value="Custom">अन्य</option></select>
      <input id="newOvers" type="number" value="20" min="1" placeholder="ओभर">
      <button onclick="createTournament()">टुर्नामेन्ट बनाउनुहोस्</button>
      <hr>
      <h3>नयाँ टिम</h3>
      ${selectHtml("teamTournament", state.tournaments, x => x.id, x => x.name)}
      <input id="newTeam" placeholder="टिमको नाम">
      <input id="newShort" placeholder="टिमको छोटो नाम">
      <button onclick="createTeam()">टिम थप्नुहोस्</button>
      <hr>
      <h3>नयाँ खेलाडी</h3>
      ${selectHtml("playerTeam", state.teams, x => x.id, x => x.name)}
      <input id="newPlayer" placeholder="खेलाडीको नाम">
      <input id="newJersey" type="number" placeholder="जर्सी नम्बर">
      <select id="newRole"><option value="Batter">Batter</option><option value="Bowler">Bowler</option><option value="All-rounder">All-rounder</option><option value="Wicketkeeper">Wicketkeeper</option></select>
      <button onclick="createPlayer()">खेलाडी थप्नुहोस्</button>
      <hr>
      <button onclick="generateFixtures()">राउन्ड रोबिन खेल तालिका बनाउनुहोस्</button>
      <button onclick="login()">Admin Login</button>
      <button onclick="logout()">Logout</button>`;
  } else if (tab === "teams") {
    el.innerHTML = `<h3>टिम र खेलाडी</h3>` + state.teams.map(t => `
      <p><b>${esc(t.name)}</b> — ${state.players.filter(p => p.team_id === t.id).length} खेलाडी</p>
      <ul>${state.players.filter(p => p.team_id === t.id).map(p =>
        `<li>${esc(p.name)} ${p.jersey_no ? "#"+esc(p.jersey_no) : ""}</li>`
      ).join("")}</ul>`).join("");
  } else if (tab === "fixtures") {
    el.innerHTML = `<h3>खेल तालिका</h3>` + state.matches.map(m => `
      <p>${esc(teamName(m.team_a))} vs ${esc(teamName(m.team_b))}
      — ${esc(m.status || "scheduled")}
      <button onclick="openScore('${m.id}')">स्कोर खोल्नुहोस्</button></p>`
    ).join("");
  } else {
    el.innerHTML = `<p>Admin सुविधाका लागि आफ्नो Supabase Auth प्रयोग गर्नुहोस्।</p>
      <button onclick="login()">Login</button><button onclick="logout()">Logout</button>`;
  }
}
async function createTournament() {
  try {
    const name = $("newTournament")?.value.trim();
    if (!name) throw new Error("टुर्नामेन्टको नाम लेख्नुहोस्।");
    await db(sb.from("tournaments").insert({
      name, venue: $("newVenue")?.value || null,
      season: $("newSeason")?.value || null,
      format: $("newFormat")?.value || "T20",
      overs_per_innings: n($("newOvers")?.value) || 20,
      points_win: 2, points_tie: 1, points_no_result: 1,
      points_loss: 0, status: "active"
    }));
    await loadAll(); msg("टुर्नामेन्ट थपियो।");
  } catch (e) { err(e); }
}
async function createTeam() {
  try {
    const name = $("newTeam")?.value.trim();
    const tid = $("teamTournament")?.value;
    if (!name) throw new Error("टिमको नाम लेख्नुहोस्।");
    await db(sb.from("teams").insert({
      name, tournament_id: tid || null,
      short_name: $("newShort")?.value.trim() || name.slice(0, 4).toUpperCase()
    }));
    await loadAll(); msg("टिम थपियो।");
  } catch (e) { err(e); }
}
async function createPlayer() {
  try {
    const name = $("newPlayer")?.value.trim();
    const teamId = $("playerTeam")?.value;
    if (!name || !teamId) throw new Error("टिम र खेलाडीको नाम छान्नुहोस्।");
    await db(sb.from("players").insert({
      name, team_id: teamId,
      jersey_no: $("newJersey")?.value ? n($("newJersey").value) : null,
      role: $("newRole")?.value || "Batter"
    }));
    await loadAll(); msg("खेलाडी थपियो।");
  } catch (e) { err(e); }
}
async function generateFixtures() {
  try {
    const tid = $("teamTournament")?.value || $("tournamentSelect")?.value ||
      prompt("टुर्नामेन्ट ID राख्नुहोस्:");
    if (!tid) throw new Error("टुर्नामेन्ट छान्नुहोस्।");
    const teams = state.teams.filter(t => t.tournament_id === tid);
    if (teams.length < 2) throw new Error("कम्तीमा २ टिम चाहिन्छ।");
    const existing = state.matches.filter(m => m.tournament_id === tid);
    if (existing.length && !confirm("यो टुर्नामेन्टमा खेलहरू पहिले नै छन्। नयाँ खेल तालिका थप्ने?"))
      return;
    const rows = [];
    let no = 1;
    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        rows.push({
          tournament_id: tid, team_a: teams[i].id, team_b: teams[j].id,
          match_no: no++, round_name: "League",
          status: "scheduled", venue: byId(state.tournaments, tid)?.venue || null
        });
      }
    }
    await db(sb.from("matches").insert(rows));
    await loadAll(); msg("राउन्ड रोबिन खेल तालिका बन्यो।");
  } catch (e) { err(e); }
}
async function login() {
  try {
    const email = prompt("Admin email:");
    if (!email) return;
    const password = prompt("Password:");
    if (!password) return;
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    msg("Login सफल भयो।");
  } catch (e) { err(e); }
}
async function logout() {
  try {
    const { error } = await sb.auth.signOut();
    if (error) throw error;
    msg("Logout भयो।");
  } catch (e) { err(e); }
}
function renderStats() {
  const el = $("statsContent");
  if (!el) return;
  el.innerHTML = `
    <h3>सारांश</h3>
    <p>टुर्नामेन्ट: ${state.tournaments.length}</p>
    <p>टिम: ${state.teams.length}</p>
    <p>खेलाडी: ${state.players.length}</p>
    <p>खेल: ${state.matches.length}</p>`;
}

/* NAVIGATION AND EVENTS */
function showPage(page) {
  document.querySelectorAll(".page").forEach(el => el.style.display = "none");
  const target = $("page-" + page);
  if (target) target.style.display = "";
  document.querySelectorAll("[data-page]").forEach(el => {
    el.classList.toggle("active", el.dataset.page === page);
  });
}
document.addEventListener("click", e => {
  const nav = e.target.closest("[data-page]");
  if (nav) showPage(nav.dataset.page);
  const tab = e.target.closest("[data-admin]");
  if (tab) {
    state.adminTab = tab.dataset.admin;
    renderAdmin();
  }
});
if ($("loadScore")) $("loadScore").addEventListener("click", () => {
  const id = $("scoreMatch")?.value;
  if (id) openScore(id);
  else msg("पहिले खेल छान्नुहोस्।", true);
});
if ($("refreshTournament")) $("refreshTournament").addEventListener("click", loadAll);
if ($("tournamentSelect")) $("tournamentSelect").addEventListener("change", () => {
  renderTournament(); renderPoints();
});
window.addEventListener("online", () => { state.online = true; msg("इन्टरनेट जोडियो।"); });
window.addEventListener("offline", () => { state.online = false; msg("इन्टरनेट छैन।", true); });

/* Inline onclick functions */
Object.assign(window, {
  openScore, addBall, addWicket, swapBatters, undoBall,
  startInnings, endInnings, setDls, endMatch,
  createTournament, createTeam, createPlayer, generateFixtures,
  login, logout, showPage
});

loadAll();
