const { createClient } = window.supabase;
const sb = createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
let state={tournaments:[],matches:[],teams:[],players:[],selectedMatch:null,innings:[],events:[],xi:[],online:navigator.onLine,adminTab:'setup'};

const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const money=n=>Number(n||0);
function toast(s){$('status').textContent=s; setTimeout(()=>$('status').textContent=state.online?'Online':'Offline',2500)}
function team(id){return state.teams.find(x=>x.id===id)?.name||'—'}
function player(id){return state.players.find(x=>x.id===id)?.name||'—'}

async function loadAll(){
 const [t,m,tm,p]=await Promise.all([
  sb.from('tournaments').select('*').order('created_at',{ascending:false}),
  sb.from('matches').select('*').order('scheduled_at'),
  sb.from('teams').select('*').order('name'),
  sb.from('players').select('*').order('name')
 ]);
 if(t.error) console.error(t.error); state.tournaments=t.data||[];
 state.matches=m.data||[]; state.teams=tm.data||[]; state.players=p.data||[];
 renderLive(); renderTournament(); renderMatchSelect(); renderAdmin(); renderStats();
}
function nav(page){
 document.querySelectorAll('.page').forEach(x=>x.classList.add('hidden'));
 $('page-'+page).classList.remove('hidden');
}
document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>nav(b.dataset.page));
document.querySelectorAll('[data-admin]').forEach(b=>b.onclick=()=>{state.adminTab=b.dataset.admin;renderAdmin()});

async function renderLive(){
 const live=state.matches.filter(m=>m.status==='live'||m.status==='break');
 $('liveMatches').innerHTML=live.length?live.map(m=>`<div class="match">
 <span class="badge live">● LIVE</span><h3>${esc(team(m.team_a))} vs ${esc(team(m.team_b))}</h3>
 <div>${esc(m.venue||'Venue not set')}</div><button onclick="openScore('${m.id}')">Open live score</button>
 </div>`).join(''):'<div class="card">अहिले कुनै live match छैन।</div>';
}
function renderTournament(){
 const s=$('tournamentSelect'); s.innerHTML=state.tournaments.map(t=>`<option value="${t.id}">${esc(t.name)} (${t.status})</option>`).join('');
 const tid=s.value||state.tournaments[0]?.id;
 const ms=state.matches.filter(m=>!tid||m.tournament_id===tid);
 $('fixtureList').innerHTML='<h3>Fixtures</h3>'+ (ms.length?'<div class="grid">'+ms.map(m=>`<div class="card"><b>${esc(m.round_name||'Match')}</b><br>${esc(team(m.team_a))} vs ${esc(team(m.team_b))}<br><span class="mini">${esc(m.status)} • ${esc(m.venue||'')}</span><br><button onclick="openScore('${m.id}')">Score</button></div>`).join('')+'</div>':'<p>No fixtures.</p>');
 renderPoints(tid);
}
async function renderPoints(tid){
 if(!tid){$('pointsTable').innerHTML='';return}
 const {data,error}=await sb.from('points_table').select('*').eq('tournament_id',tid).order('points',{ascending:false}).order('nrr',{ascending:false});
 $('pointsTable').innerHTML='<h3>Points Table</h3>'+(error?`<p>${esc(error.message)}</p>`:`<table class="table"><tr><th>Team</th><th>P</th><th>W</th><th>L</th><th>Pts</th><th>NRR</th></tr>${(data||[]).map(x=>`<tr><td>${esc(x.name)}</td><td>${x.played}</td><td>${x.won}</td><td>${x.lost}</td><td>${x.points}</td><td>${Number(x.nrr||0).toFixed(3)}</td></tr>`).join('')}</table>`);
}
$('refreshTournament').onclick=renderTournament;
$('tournamentSelect').onchange=renderTournament;

function renderMatchSelect(){
 $('scoreMatch').innerHTML=state.matches.map(m=>`<option value="${m.id}">${esc(team(m.team_a))} vs ${esc(team(m.team_b))} — ${m.status}</option>`).join('');
}
$('loadScore').onclick=()=>openScore($('scoreMatch').value);

async function openScore(id){
 nav('scorer'); state.selectedMatch=id;
 const {data:m}=await sb.from('matches').select('*').eq('id',id).single();
 const [inn,ev,xi]=await Promise.all([
  sb.from('innings').select('*').eq('match_id',id).order('innings_no'),
  sb.from('ball_events').select('*').eq('match_id',id).order('over_no').order('ball_no'),
  sb.from('playing_xi').select('*').eq('match_id',id)
 ]);
 state.innings=inn.data||[]; state.events=ev.data||[]; state.xi=xi.data||[];
 renderScore();
}

function currentInn(){return state.innings[state.innings.length-1]}
function totals(innId){
 const ev=state.events.filter(e=>e.innings_id===innId);
 return {runs:ev.reduce((a,e)=>a+money(e.total_runs),0),w:ev.filter(e=>e.wicket).length,
 balls:ev.reduce((a,e)=>a+(['wide','noball'].includes(e.extras_type)?0:1),0),
 fours:ev.filter(e=>e.runs_bat===4).length,sixes:ev.filter(e=>e.runs_bat===6).length};
}
function renderScore(){
 const inn=currentInn(), t=inn?totals(inn.id):{runs:0,w:0,balls:0};
 if(!inn){$('scoreConsole').innerHTML=`<div class="card"><p>पहिलो innings सुरु गरिएको छैन।</p><button onclick="startInnings()">Start 1st Innings</button></div>`;return}
 const over=Math.floor(t.balls/6), ball=t.balls%6;
 $('scoreConsole').innerHTML=`
 <div class="card"><span class="badge">Innings ${inn.innings_no}</span>
 <h3>${esc(team(inn.batting_team))}</h3><div class="score">${t.runs}/${t.w}</div>
 <div class="over">${over}.${ball} overs • Target: ${inn.target||'—'} • ${t.runs>=money(inn.target)&&inn.target?'TARGET REACHED':''}</div></div>
 <div class="card"><h3>Ball Entry</h3>
 <div class="balls">
 ${[0,1,2,3,4,6].map(n=>`<button onclick="addBall(${n},'none',0,false)">${n}</button>`).join('')}
 <button class="good" onclick="addBall(0,'wide',1,false)">Wd</button>
 <button class="wide" onclick="addBall(0,'noball',1,false)">Nb</button>
 <button onclick="addBall(0,'bye',1,false)">B</button>
 <button onclick="addBall(0,'legbye',1,false)">Lb</button>
 <button class="danger" onclick="addBall(0,'none',0,true)">W</button>
 </div>
 <div class="row"><button onclick="undoBall()">↩ Undo</button><button onclick="endInnings()">End Innings</button><button onclick="setDls()">Set DLS Target</button></div>
 </div>
 ${renderScorecard(inn.id)}
 ${renderXI()}
 <div class="card"><h3>Ball-by-ball</h3>${state.events.filter(e=>e.innings_id===inn.id).slice().reverse().map(e=>`<div>${e.over_no}.${e.ball_no} — ${e.runs_bat||0} ${e.extras_type!=='none'?e.extras_type:''} ${e.wicket?'WICKET':''}</div>`).join('')}</div>`;
}
function renderScorecard(innId){
 const ev=state.events.filter(e=>e.innings_id===innId), ids=[...new Set(ev.flatMap(e=>[e.striker,e.dismissed_player]).filter(Boolean))];
 const rows=ids.map(id=>{let es=ev.filter(e=>e.striker===id);return `<tr><td>${esc(player(id))}</td><td>${es.reduce((a,e)=>a+money(e.runs_bat),0)}</td><td>${es.length}</td><td>${es.filter(e=>e.runs_bat===4).length}</td><td>${es.filter(e=>e.runs_bat===6).length}</td></tr>`}).join('');
 return `<div class="scorecard"><h3>Batting Scorecard</h3><table class="table"><tr><th>Batter</th><th>R</th><th>B</th><th>4s</th><th>6s</th></tr>${rows||'<tr><td colspan=5>No balls yet</td></tr>'}</table></div>`;
}
function renderXI(){
 const inn=currentInn(); if(!inn)return '';
 const xs=state.xi.filter(x=>x.team_id===inn.batting_team);
 return `<div class="card"><h3>Playing XI</h3><div class="xi">${xs.map(x=>`<label><input type="checkbox" checked disabled> ${esc(player(x.player_id))}${x.captain?' (C)':''}${x.wicketkeeper?' (WK)':''}</label>`).join('')||'<p>XI not selected yet. Add XI in Admin.</p>'}</div></div>`;
}
async function startInnings(){
 const m=state.matches.find(x=>x.id===state.selectedMatch); if(!m)return;
 const no=state.innings.length+1;
 const batting=no===1?m.toss_decision==='bowl'?m.team_b:m.team_a:m.toss_decision==='bowl'?m.team_a:m.team_b;
 const bowling=batting===m.team_a?m.team_b:m.team_a;
 const target=no===2&&state.innings[0]?totals(state.innings[0].id).runs+1:null;
 const {data,error}=await sb.from('innings').insert({match_id:m.id,innings_no:no,batting_team:batting,bowling_team:bowling,target}).select().single();
 if(error)return toast(error.message);
 await sb.from('matches').update({status:'live'}).eq('id',m.id);
 state.innings.push(data);renderScore();loadAll();
}
async function addBall(runs,extra,extraRuns,wicket){
 const inn=currentInn(); if(!inn)return;
 const t=totals(inn.id); const over=Math.floor(t.balls/6)+1, ball=t.balls+1;
 const {error}=await sb.from('ball_events').insert({
  match_id:state.selectedMatch,innings_id:inn.id,over_no:over,ball_no:ball,
  runs_bat:runs,extras_type:extra,extras_runs:extraRuns,total_runs:runs+extraRuns,wicket,
  commentary:wicket?'Wicket':extra!=='none'?extra:''
 });
 if(error){toast(error.message);return}
 await openScore(state.selectedMatch);
}
async function undoBall(){
 const inn=currentInn(); if(!inn)return;
 const ev=state.events.filter(e=>e.innings_id===inn.id).slice(-1)[0];
 if(!ev)return;
 await sb.from('ball_events').delete().eq('id',ev.id); await openScore(state.selectedMatch);
}
async function endInnings(){
 const inn=currentInn(); if(!inn)return;
 await sb.from('innings').update({completed:true}).eq('id',inn.id);
 if(inn.innings_no<2) await startInnings();
 else {await sb.from('matches').update({status:'completed'}).eq('id',state.selectedMatch);await openScore(state.selectedMatch);loadAll();}
}
async function setDls(){
 const x=prompt('DLS/adjusted target number:'); if(x===null)return;
 await sb.from('matches').update({dls_target:Number(x)}).eq('id',state.selectedMatch);
 const inn=currentInn(); if(inn)await sb.from('innings').update({target:Number(x)}).eq('id',inn.id);
 await openScore(state.selectedMatch);
}

function renderAdmin(){
 const c=$('adminContent');
 if(state.adminTab==='setup') c.innerHTML=`<div class="card"><h3>Create Tournament</h3>
 <input id="tn" placeholder="Tournament name" value="Inter School Cricket Championship">
 <input id="tv" placeholder="Venue">
 <input id="ts" placeholder="Season e.g. 2083">
 <select id="tf"><option value="league">League</option><option value="groups">Groups</option><option value="knockout">Knockout</option><option value="hybrid">Hybrid</option></select>
 <input id="to" type="number" value="20" placeholder="Overs">
 <button onclick="createTournament()">Create</button></div>`;
 if(state.adminTab==='teams') c.innerHTML=`<div class="card"><h3>Add School/Team</h3>
 <select id="teamTid">${state.tournaments.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select>
 <input id="teamName" placeholder="School name"><input id="teamShort" placeholder="Short name"><button onclick="createTeam()">Add Team</button>
 </div><div class="card"><h3>Add Player</h3><select id="playerTeam">${state.teams.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select><input id="playerName" placeholder="Player name"><input id="jersey" type="number" placeholder="Jersey no"><select id="role"><option>player</option><option>captain</option><option>wicketkeeper</option></select><button onclick="createPlayer()">Add Player</button></div>`;
 if(state.adminTab==='fixtures') c.innerHTML=`<div class="card"><h3>Generate Fixtures</h3><select id="fixtureTid">${state.tournaments.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select><input id="roundName" placeholder="Round name" value="League"><button onclick="generateFixtures()">Generate round-robin fixtures</button><p class="mini">Existing fixtures are preserved; duplicate pair fixtures are avoided.</p></div>`;
 if(state.adminTab==='users') c.innerHTML=`<div class="card"><h3>Session</h3><button onclick="login()">Login</button><button onclick="logout()">Logout</button><div id="sessionInfo">Checking…</div></div>`;
}
async function createTournament(){
 const {error}=await sb.from('tournaments').insert({name:$('tn').value,venue:$('tv').value,season:$('ts').value,format:$('tf').value,overs_per_innings:Number($('to').value)});
 toast(error?error.message:'Tournament created');loadAll();
}
async function createTeam(){
 const {error}=await sb.from('teams').insert({tournament_id:$('teamTid').value,name:$('teamName').value,short_name:$('teamShort').value});
 toast(error?error.message:'Team added');loadAll();
}
async function createPlayer(){
 const {error}=await sb.from('players').insert({team_id:$('playerTeam').value,name:$('playerName').value,jersey_no:Number($('jersey').value)||null,role:$('role').value});
 toast(error?error.message:'Player added');loadAll();
}
async function generateFixtures(){
 const tid=$('fixtureTid').value, round=$('roundName').value||'League';
 const teams=state.teams.filter(t=>t.tournament_id===tid), existing=state.matches.filter(m=>m.tournament_id===tid);
 let made=0;
 for(let i=0;i<teams.length;i++)for(let j=i+1;j<teams.length;j++){
  const a=teams[i],b=teams[j];
  const exists=existing.some(m=>(m.team_a===a.id&&m.team_b===b.id)||(m.team_a===b.id&&m.team_b===a.id));
  if(!exists){await sb.from('matches').insert({tournament_id:tid,round_name:round,match_no:existing.length+made+1,team_a:a.id,team_b:b.id,status:'scheduled'});made++}
 }
 toast(`${made} fixtures generated`);loadAll();
}
async function login(){
 const email=prompt('Email');const password=prompt('Password');if(!email)return;
 const {error}=await sb.auth.signInWithPassword({email,password});toast(error?error.message:'Logged in');
}
async function logout(){await sb.auth.signOut();toast('Logged out')}

async function renderStats(){
 const tid=state.tournaments[0]?.id;
 if(!tid){$('statsContent').innerHTML='No tournament';return}
 const {data}=await sb.from('tournament_player_stats').select('*').eq('tournament_id',tid).order('runs',{ascending:false}).limit(100);
 $('statsContent').innerHTML=`<div class="card"><h3>Player Stats</h3><table class="table"><tr><th>Player</th><th>Runs</th><th>Wickets</th><th>4s</th><th>6s</th></tr>${(data||[]).map(x=>`<tr><td>${esc(x.player_name)}</td><td>${x.runs}</td><td>${x.wickets}</td><td>${x.fours}</td><td>${x.sixes}</td></tr>`).join('')}</table></div>`;
}
async function setupRealtime(){
 sb.channel('live').on('postgres_changes',{event:'*',schema:'public',table:'ball_events'},()=>{if(state.selectedMatch)openScore(state.selectedMatch);loadAll()})
 .on('postgres_changes',{event:'*',schema:'public',table:'matches'},()=>loadAll()).subscribe();
}
function openScoreFromQuery(){const id=new URLSearchParams(location.search).get('match');if(id)openScore(id)}
window.openScore=openScore;window.startInnings=startInnings;window.addBall=addBall;window.undoBall=undoBall;window.endInnings=endInnings;window.setDls=setDls;window.createTournament=createTournament;window.createTeam=createTeam;window.createPlayer=createPlayer;window.generateFixtures=generateFixtures;window.login=login;window.logout=logout;

window.addEventListener('online',()=>{state.online=true;toast('Online')});
window.addEventListener('offline',()=>{state.online=false;toast('Offline')});
loadAll().then(setupRealtime).then(openScoreFromQuery);
