// ════════════════════════════════════════════════════════════════
//  KeyZen — Application Logic  v2
//  Features: heatmap · sound · animated results · streak · sparkline
//            live WPM chart · caps lock warning · smooth caret
//  Requires: exercises.js loaded before this file
// ════════════════════════════════════════════════════════════════

// ════════════════════════════════════════
//  STATE
// ════════════════════════════════════════
const S = {
  mode:'exercises', level:'easy', exIdx:0, timeLimit:30,
  punctuation:false, numbers:false, currentText:'', charIdx:0,
  errors:0, totalTyped:0, started:false, finished:false,
  timer:null, timeLeft:0, startTime:0, wpm:0, accuracy:100,
  tabDown:false, pb:{wpm:0,acc:0}, sessionTests:[], caretTick:null,
  completed:new Set(), browserOpen:false,
  // new v2 state
  streak:0, soundOn:true,
  keyErrors:{},          // key -> error count
  liveWpmHistory:[],     // [{t, wpm}] sampled every ~5 chars
  wpmSampleCount:0,      // chars since last wpm sample
  heatmapVisible:false,
};

// ════════════════════════════════════════
//  SOUND ENGINE  (Web Audio API, no deps)
// ════════════════════════════════════════
let _audioCtx = null;
function getAudioCtx(){
  if(!_audioCtx) _audioCtx = new (window.AudioContext||window.webkitAudioContext)();
  return _audioCtx;
}
function playTick(isError){
  if(!S.soundOn) return;
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    if(isError){
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(120, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(60, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.06, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
      osc.start(); osc.stop(ctx.currentTime + 0.1);
    } else {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.04);
      gain.gain.setValueAtTime(0.03, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
      osc.start(); osc.stop(ctx.currentTime + 0.05);
    }
  } catch(e){}
}
function toggleSound(){
  S.soundOn = !S.soundOn;
  const on = document.getElementById('icon-sound-on');
  const off = document.getElementById('icon-sound-off');
  const btn = document.getElementById('sound-btn');
  on.style.display  = S.soundOn ? '' : 'none';
  off.style.display = S.soundOn ? 'none' : '';
  btn.setAttribute('data-tip', S.soundOn ? 'Sound on' : 'Sound off');
  btn.style.color = S.soundOn ? '' : 'var(--text3)';
  // resume AudioContext if suspended (browser autoplay policy)
  if(S.soundOn && _audioCtx && _audioCtx.state === 'suspended') _audioCtx.resume();
}

// ════════════════════════════════════════
//  CAPS LOCK DETECTION
// ════════════════════════════════════════
document.addEventListener('keydown', e => {
  if(e.getModifierState){
    const cl = e.getModifierState('CapsLock');
    const w  = document.getElementById('caps-warning');
    w.style.display = cl ? 'flex' : 'none';
  }
});
document.addEventListener('keyup', e => {
  if(e.getModifierState){
    const cl = e.getModifierState('CapsLock');
    const w  = document.getElementById('caps-warning');
    w.style.display = cl ? 'flex' : 'none';
  }
});

// ════════════════════════════════════════
//  TEXT GENERATION
// ════════════════════════════════════════
function genText() {
  if(S.mode==='exercises'){ const pool=EX[S.level]; return (pool[S.exIdx]||pool[0]).text; }
  if(S.mode==='quotes') return QUOTES[~~(Math.random()*QUOTES.length)];
  if(S.mode==='code')   return CODE[~~(Math.random()*CODE.length)];
  const n = S.timeLimit<=15?40:S.timeLimit<=30?80:S.timeLimit<=60?160:320; let w=[];
  for(let i=0;i<n;i++){
    let word=WORDS[~~(Math.random()*WORDS.length)];
    if(S.numbers && Math.random()<.12) word=String(~~(Math.random()*999)+1);
    if(S.punctuation && Math.random()<.14) word+=[',','.',';',':','!','?'][~~(Math.random()*6)];
    w.push(word);
  }
  return w.join(' ');
}

// ════════════════════════════════════════
//  RENDER
// ════════════════════════════════════════
function render() {
  const ct = document.getElementById('typing-text');
  ct.innerHTML = '';
  [...S.currentText].forEach((c,i)=>{
    const sp=document.createElement('span');
    sp.className='char'; sp.dataset.i=i; sp.textContent=c;
    ct.appendChild(sp);
  });
  moveCaret();
  if(S.mode==='exercises') {
    const pool=EX[S.level]; const ex=pool[S.exIdx];
    document.getElementById('ex-num').textContent = S.exIdx+1;
    document.getElementById('ex-of').textContent  = '/ '+pool.length;
    const badge=document.getElementById('ex-badge');
    badge.textContent = S.level.charAt(0).toUpperCase()+S.level.slice(1);
    badge.className   = 'level-badge '+S.level;
    document.getElementById('prog-label').textContent = ex?ex.title:'Exercise';
    document.getElementById('btn-prev').disabled = S.exIdx===0;
    document.getElementById('btn-next').disabled = S.exIdx===pool.length-1;
    document.getElementById('act-prev').style.opacity = S.exIdx===0?'0.4':'1';
    document.getElementById('act-next').style.opacity = S.exIdx===pool.length-1?'0.4':'1';
    refreshGrid();
  }
}

// ════════════════════════════════════════
//  CARET  (smooth CSS-transition based)
// ════════════════════════════════════════
function moveCaret() {
  const car=document.getElementById('caret');
  const ct=document.getElementById('typing-text');
  const chars=ct.querySelectorAll('.char');
  car.style.display='block';
  const target = S.charIdx < chars.length ? chars[S.charIdx] : chars[chars.length-1];
  if(!target) return;
  const r=target.getBoundingClientRect(), p=ct.getBoundingClientRect();
  car.style.left = (S.charIdx<chars.length ? r.left-p.left : r.right-p.left)+'px';
  car.style.top  = (r.top-p.top+2)+'px';
  car.style.height = (r.height-4)+'px';
  clearTimeout(S.caretTick);
  car.classList.add('typing');
  S.caretTick = setTimeout(()=>car.classList.remove('typing'),400);
}

// ════════════════════════════════════════
//  INPUT
// ════════════════════════════════════════
const HI = document.getElementById('hidden-input');

HI.addEventListener('input', e=>{
  if(S.finished) return;
  const v=HI.value; if(!v) return;
  const c=v[v.length-1]; HI.value='';
  if(!S.started) startTest();
  const exp=S.currentText[S.charIdx];
  if(c===exp){
    mark(S.charIdx,'correct');
    S.charIdx++; S.totalTyped++;
    playTick(false);
  } else {
    mark(S.charIdx,'error');
    S.charIdx++; S.totalTyped++; S.errors++;
    flashErr();
    playTick(true);
    // record which key was expected (what they should have hit)
    const expected = exp.toLowerCase();
    S.keyErrors[expected] = (S.keyErrors[expected]||0) + 1;
    if(S.heatmapVisible) updateHeatmap();
  }
  moveCaret(); liveStats(); updateProg(); sampleLiveWpm();
  if(S.charIdx>=S.currentText.length) endTest();
  document.getElementById('click-hint').classList.add('hide');
});

HI.addEventListener('keydown', e=>{
  if(e.key==='Backspace'){
    e.preventDefault();
    if(S.charIdx>0&&!S.finished){
      S.charIdx--;
      const el=document.querySelector(`.char[data-i="${S.charIdx}"]`);
      if(el&&el.classList.contains('error')){S.errors=Math.max(0,S.errors-1);S.totalTyped=Math.max(0,S.totalTyped-1);}
      else S.totalTyped=Math.max(0,S.totalTyped-1);
      mark(S.charIdx,''); moveCaret(); liveStats(); updateProg();
    }
    return;
  }
  if(e.key==='Tab'){e.preventDefault();S.tabDown=true;return;}
  if(e.key==='Enter'&&S.tabDown){restartTest();return;}
  if(e.key==='ArrowRight'&&!S.started){nextEx();return;}
  if(e.key==='ArrowLeft' &&!S.started){prevEx();return;}
  S.tabDown=false;
  if(e.key==='Escape') closeResults();
});

function mark(i,cls){
  const el=document.querySelector(`.char[data-i="${i}"]`);
  if(!el) return;
  el.classList.remove('correct','error');
  if(cls) el.classList.add(cls);
}

let _flashTimer = null;
function flashErr(){
  const card=document.getElementById('typing-card');
  clearTimeout(_flashTimer);
  card.style.boxShadow='0 0 0 2px var(--error),0 4px 32px rgba(224,64,42,.1)';
  _flashTimer=setTimeout(()=>card.style.boxShadow='',200);
}

// ════════════════════════════════════════
//  LIVE WPM CHART  (canvas in top corner)
// ════════════════════════════════════════
function sampleLiveWpm(){
  S.wpmSampleCount++;
  if(S.wpmSampleCount < 5) return; // sample every 5 chars
  S.wpmSampleCount = 0;
  const elapsed = Math.max(1,(Date.now()-S.startTime)/1000);
  const wpm = Math.round((S.totalTyped/5)/(elapsed/60)) || 0;
  S.liveWpmHistory.push(wpm);
  if(S.liveWpmHistory.length > 24) S.liveWpmHistory.shift();
  drawLiveChart();
}

function drawLiveChart(){
  const canvas = document.getElementById('live-chart');
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0,0,W,H);
  const data = S.liveWpmHistory;
  if(data.length < 2) return;
  const max = Math.max(...data, 10);
  const min = 0;
  const range = max - min || 1;
  const step = W / (data.length - 1);

  // accent color from CSS var
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const lineColor = isDark ? '#F5C800' : '#D4A000';
  const fillColor = isDark ? 'rgba(245,200,0,0.15)' : 'rgba(200,160,0,0.12)';

  ctx.beginPath();
  data.forEach((v,i)=>{
    const x = i * step;
    const y = H - ((v-min)/range) * (H-4) - 2;
    i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
  });
  // fill area under line
  const lastX = (data.length-1)*step;
  ctx.lineTo(lastX, H); ctx.lineTo(0, H); ctx.closePath();
  ctx.fillStyle = fillColor;
  ctx.fill();
  // draw line
  ctx.beginPath();
  data.forEach((v,i)=>{
    const x = i * step;
    const y = H - ((v-min)/range) * (H-4) - 2;
    i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
  });
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

// ════════════════════════════════════════
//  LIFECYCLE
// ════════════════════════════════════════
function startTest(){
  S.started=true; S.startTime=Date.now();
  S.liveWpmHistory=[]; S.wpmSampleCount=0;
  document.getElementById('typing-card').classList.add('started');
  if(S.mode==='words'){
    S.timeLeft=S.timeLimit;
    document.getElementById('stat-timer').textContent=S.timeLeft;
    S.timer=setInterval(()=>{
      S.timeLeft--;
      document.getElementById('stat-timer').textContent=S.timeLeft;
      liveStats();
      if(S.timeLeft<=0) endTest();
    },1000);
  }
}

function endTest(){
  if(S.finished) return;
  S.finished=true; clearInterval(S.timer); HI.blur();
  const elapsed = S.mode==='words' ? (S.timeLimit-S.timeLeft)||S.timeLimit : Math.max(1,(Date.now()-S.startTime)/1000);
  const wpm=Math.round((S.totalTyped/5)/(elapsed/60));
  const acc=S.totalTyped>0?Math.round(((S.totalTyped-S.errors)/S.totalTyped)*100):100;
  S.wpm=wpm; S.accuracy=acc;
  document.getElementById('stat-wpm').textContent=wpm;
  document.getElementById('stat-acc').textContent=acc+'%';

  // streak
  if(S.mode==='exercises'){
    const ex=EX[S.level][S.exIdx];
    if(ex){ S.completed.add(ex.id); saveComp(); updateCompBars(); refreshGrid(); }
    S.streak++;
    updateStreak();
  }

  S.sessionTests.push({wpm,acc}); updateSession();

  const isNewPB = wpm > S.pb.wpm;
  if(isNewPB){ S.pb={wpm,acc}; localStorage.setItem('kz_pb_wpm',wpm); localStorage.setItem('kz_pb_acc',acc); updatePB(); }

  setTimeout(()=>showResults(isNewPB), 600);
}

function restartTest(){
  clearInterval(S.timer);
  Object.assign(S,{charIdx:0,errors:0,totalTyped:0,started:false,finished:false,wpm:0,accuracy:100,tabDown:false,liveWpmHistory:[],wpmSampleCount:0});
  S.timeLeft=S.timeLimit;
  S.currentText=genText();
  render();
  // clear live chart
  const canvas = document.getElementById('live-chart');
  if(canvas){ const ctx=canvas.getContext('2d'); ctx.clearRect(0,0,canvas.width,canvas.height); }
  document.getElementById('typing-card').classList.remove('started');
  document.getElementById('stat-timer').textContent = S.mode==='words'?S.timeLimit:'—';
  document.getElementById('stat-wpm').textContent='—';
  document.getElementById('stat-acc').textContent='—';
  document.getElementById('stat-errors').textContent='0';
  document.getElementById('progress-fill').style.width='0%';
  document.getElementById('prog-pct').textContent='0%';
  document.getElementById('click-hint').classList.remove('hide');
  document.getElementById('typing-card').classList.remove('focused');
  HI.blur();
}

// ════════════════════════════════════════
//  STATS
// ════════════════════════════════════════
function liveStats(){
  if(!S.started) return;
  const elapsed = S.mode==='words' ? Math.max(1,S.timeLimit-S.timeLeft) : Math.max(1,(Date.now()-S.startTime)/1000);
  const wpm = Math.round((S.totalTyped/5)/(elapsed/60)) || 0;
  document.getElementById('stat-wpm').textContent    = wpm || '—';
  document.getElementById('stat-acc').textContent    = (S.totalTyped>0?Math.round(((S.totalTyped-S.errors)/S.totalTyped)*100):100)+'%';
  document.getElementById('stat-errors').textContent = S.errors;
}
function updateProg(){
  const pct=Math.round((S.charIdx/S.currentText.length)*100);
  document.getElementById('progress-fill').style.width=pct+'%';
  document.getElementById('prog-pct').textContent=pct+'%';
}
function updatePB(){
  const w=S.pb.wpm||localStorage.getItem('kz_pb_wpm')||'—';
  const a=S.pb.acc||localStorage.getItem('kz_pb_acc')||'—';
  document.getElementById('pb-wpm').textContent=w;
  document.getElementById('pb-acc').textContent=a!=='—'?a+'%':'—';
}
function updateSession(){
  const t=S.sessionTests;
  document.getElementById('tests-count').textContent=t.length;
  if(t.length){
    document.getElementById('avg-wpm').textContent=Math.round(t.reduce((a,b)=>a+b.wpm,0)/t.length)+' WPM';
    document.getElementById('avg-acc').textContent=Math.round(t.reduce((a,b)=>a+b.acc,0)/t.length)+'%';
    drawSparkline(t.map(x=>x.wpm));
  }
}
function updateCompBars(){
  [{k:'easy',n:50},{k:'normal',n:50},{k:'hard',n:40}].forEach(({k,n})=>{
    const done=EX[k].filter(ex=>S.completed.has(ex.id)).length;
    const pct=Math.round((done/n)*100);
    document.getElementById(`done-${k}`).textContent=done;
    document.getElementById(`fill-${k}`).style.width=pct+'%';
    document.getElementById(`pct-${k}`).textContent=pct+'%';
  });
}
function updateStreak(){
  const badge = document.getElementById('streak-badge');
  const count = document.getElementById('streak-count');
  if(S.streak >= 2){
    badge.style.display = 'flex';
    count.textContent = S.streak;
    // re-trigger animation
    badge.style.animation='none'; void badge.offsetWidth;
    badge.style.animation='streakPop .4s cubic-bezier(.34,1.56,.64,1) both';
  } else {
    badge.style.display = 'none';
  }
}

// ════════════════════════════════════════
//  SESSION SPARKLINE
// ════════════════════════════════════════
function drawSparkline(data){
  const canvas = document.getElementById('sparkline');
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0,0,W,H);
  if(data.length < 2) return;
  const max = Math.max(...data, 10);
  const step = W / (data.length - 1);
  const isDark = document.documentElement.getAttribute('data-theme')==='dark';
  ctx.strokeStyle = isDark ? '#F5C800' : '#D4A000';
  ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
  ctx.beginPath();
  data.forEach((v,i)=>{
    const x = i * step;
    const y = H - (v/max)*(H-3) - 1;
    i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
  });
  ctx.stroke();
  // draw dot at latest value
  const lx = (data.length-1)*step;
  const ly = H - (data[data.length-1]/max)*(H-3) - 1;
  ctx.beginPath(); ctx.arc(lx,ly,2.5,0,Math.PI*2);
  ctx.fillStyle = isDark ? '#F5C800' : '#D4A000';
  ctx.fill();
}

// ════════════════════════════════════════
//  RESULTS  (animated counters + accuracy arc)
// ════════════════════════════════════════
function animateCount(el, target, suffix, duration){
  const start = performance.now();
  const startVal = 0;
  function step(now){
    const p = Math.min((now-start)/duration, 1);
    const ease = 1 - Math.pow(1-p, 3); // cubic ease-out
    el.textContent = Math.round(startVal + (target-startVal)*ease) + suffix;
    if(p < 1) requestAnimationFrame(step);
    else el.textContent = target + suffix;
  }
  requestAnimationFrame(step);
}

function animateArc(accuracy){
  const circumference = 157; // arc length of our SVG path
  const fill = document.getElementById('arc-fill');
  const val  = document.getElementById('arc-value');
  // offset: 157 = 0%, 0 = 100%
  const targetOffset = circumference * (1 - accuracy/100);
  fill.style.strokeDashoffset = circumference; // start from empty
  void fill.getBoundingClientRect(); // force reflow
  setTimeout(()=>{ fill.style.strokeDashoffset = targetOffset; }, 80);

  // color the arc by accuracy
  if(accuracy >= 95) fill.style.stroke = 'var(--easy)';
  else if(accuracy >= 80) fill.style.stroke = 'var(--accent)';
  else fill.style.stroke = 'var(--error)';

  animateCount(val, accuracy, '%', 900);
}

function showResults(isNewPB=false){
  const levels = [
    {min:120,t:'🔥 Supersonic!',        s:'Faster than 99% of typists. Truly elite.'},
    {min:100,t:'⚡ Lightning Fast!',     s:'Exceptional — top-tier typist territory!'},
    {min:80, t:'🚀 Excellent Speed!',    s:'Well above average. You\'re a serious typist.'},
    {min:60, t:'✓ Great Performance',   s:'Above average! Keep pushing every day.'},
    {min:40, t:'↑ Good Progress',       s:'Building real momentum — stay consistent.'},
    {min:20, t:'Keep Practicing',       s:'Every keystroke builds muscle memory.'},
    {min:0,  t:'Just Getting Started',  s:'Every expert began exactly where you are.'},
  ];
  const lv = levels.find(l=>S.wpm>=l.min)||levels[levels.length-1];
  document.getElementById('res-title').textContent = lv.t;
  document.getElementById('res-sub').textContent   = lv.s;

  const pbBanner = document.getElementById('pb-banner');
  pbBanner.style.display = isNewPB ? 'block' : 'none';

  document.getElementById('results-overlay').classList.add('show');

  // animated counters (start after overlay appears)
  setTimeout(()=>{
    animateCount(document.getElementById('res-wpm'),    S.wpm,        '',  800);
    animateCount(document.getElementById('res-acc'),    S.accuracy,   '%', 900);
    animateCount(document.getElementById('res-chars'),  S.totalTyped, '',  700);
    animateCount(document.getElementById('res-errors'), S.errors,     '',  600);
    animateArc(S.accuracy);
  }, 150);
}
function closeResults(){ document.getElementById('results-overlay').classList.remove('show'); }

// ════════════════════════════════════════
//  KEYBOARD HEATMAP
// ════════════════════════════════════════
const KB_ROWS = [
  ['`','1','2','3','4','5','6','7','8','9','0','-','='],
  ['q','w','e','r','t','y','u','i','o','p','[',']','\\'],
  ['a','s','d','f','g','h','j','k','l',';',"'"],
  ['z','x','c','v','b','n','m',',','.','/',],
  [' '],
];
const KB_DISPLAY = {
  '`':'`','1':'1','2':'2','3':'3','4':'4','5':'5','6':'6','7':'7','8':'8','9':'9','0':'0','-':'-','=':'=',
  'q':'Q','w':'W','e':'E','r':'R','t':'T','y':'Y','u':'U','i':'I','o':'O','p':'P','[':'[',']':']','\\':'\\',
  'a':'A','s':'S','d':'D','f':'F','g':'G','h':'H','j':'J','k':'K','l':'L',';':';',"'":"'",
  'z':'Z','x':'X','c':'C','v':'V','b':'B','n':'N','m':'M',',':',','.':'.','/':`/`,
  ' ':'Space',
};

function buildKeyboard(){
  const wrap = document.getElementById('keyboard-wrap');
  wrap.innerHTML = '';
  KB_ROWS.forEach(row => {
    const rowEl = document.createElement('div');
    rowEl.className = 'kb-row';
    row.forEach(k => {
      const keyEl = document.createElement('div');
      const disp = KB_DISPLAY[k] || k;
      keyEl.className = 'kb-key' + (disp==='Space' ? ' wider' : disp.length > 2 ? ' wide' : '');
      keyEl.id = 'kbkey-' + (k===' ' ? 'space' : k.replace(/[^a-z0-9]/gi, cc => 'c'+cc.charCodeAt(0)));
      keyEl.dataset.key = k;
      keyEl.dataset.count = '0';
      keyEl.innerHTML = `${disp}<span class="key-count" id="kc-${keyEl.id}"></span>`;
      rowEl.appendChild(keyEl);
    });
    wrap.appendChild(rowEl);
  });
}

function updateHeatmap(){
  const counts = Object.values(S.keyErrors);
  const maxCount = Math.max(...counts, 1);
  Object.entries(S.keyErrors).forEach(([k, count])=>{
    const keyId = 'kbkey-' + (k===' ' ? 'space' : k.replace(/[^a-z0-9]/gi, cc => 'c'+cc.charCodeAt(0)));
    const el = document.getElementById(keyId);
    if(!el) return;
    const ratio = count / maxCount;
    el.dataset.count = count;
    // interpolate: green(0) → yellow(0.5) → red(1)
    let r,g,b;
    const isDark = document.documentElement.getAttribute('data-theme')==='dark';
    if(ratio < 0.5){
      const t = ratio * 2;
      r = Math.round(isDark ? 76 + (255-76)*t : 45 + (232-45)*t);
      g = Math.round(isDark ? 175 - (175-184)*t : 158 - (158-160)*t);
      b = Math.round(isDark ? 130 - 130*t : 95 - 95*t);
    } else {
      const t = (ratio - 0.5) * 2;
      r = Math.round(isDark ? 255 + (255-255)*t : 232 + (224-232)*t);
      g = Math.round(isDark ? 184 - (184-107)*t : 160 - (160-64)*t);
      b = Math.round(isDark ? 48 - (48-85)*t : 0 + (42-0)*t);
    }
    el.style.background = `rgb(${r},${g},${b})`;
    el.style.color = ratio > 0.35 ? '#fff' : '';
    el.style.borderColor = `rgb(${Math.min(r+20,255)},${Math.min(g+10,255)},${b})`;
    const kc = document.getElementById('kc-'+keyId);
    if(kc) kc.textContent = count > 0 ? count : '';
  });
}

function resetHeatmap(){
  S.keyErrors = {};
  document.querySelectorAll('.kb-key').forEach(el=>{
    el.style.background=''; el.style.color=''; el.style.borderColor=''; el.dataset.count='0';
  });
  document.querySelectorAll('.key-count').forEach(el=>el.textContent='');
}

function toggleHeatmap(){
  S.heatmapVisible = !S.heatmapVisible;
  const panel = document.getElementById('heatmap-panel');
  const btn   = document.getElementById('heatmap-btn');
  panel.style.display = S.heatmapVisible ? 'block' : 'none';
  btn.style.cssText   = S.heatmapVisible ? 'background:var(--accent);color:#1A1000;border-color:var(--accent)' : '';
  if(S.heatmapVisible) updateHeatmap();
}

// ════════════════════════════════════════
//  EXERCISE NAV
// ════════════════════════════════════════
function prevEx(){ if(S.exIdx>0){S.exIdx--;S.streak=0;updateStreak();restartTest();} }
function nextEx(){ const p=EX[S.level]; if(S.exIdx<p.length-1){S.exIdx++;restartTest();} }
function randEx(){ S.exIdx=~~(Math.random()*EX[S.level].length); restartTest(); }
function gotoEx(lvl,idx){ S.level=lvl; S.exIdx=idx; updateLvlBtns(); restartTest(); if(S.browserOpen) toggleBrowser(); }

// ════════════════════════════════════════
//  GRID BROWSER
// ════════════════════════════════════════
function buildGrid(){
  ['easy','normal','hard'].forEach(lvl=>{
    const g=document.getElementById('grid-'+lvl);
    g.innerHTML='';
    EX[lvl].forEach((ex,i)=>{
      const ch=document.createElement('button');
      ch.className='ex-chip'; ch.id='chip-'+ex.id;
      ch.textContent=`${i+1}. ${ex.title}`;
      ch.onclick=()=>gotoEx(lvl,i);
      g.appendChild(ch);
    });
  });
}
function refreshGrid(){
  document.querySelectorAll('.ex-chip').forEach(c=>{
    const id=c.id.replace('chip-','');
    c.classList.toggle('done',S.completed.has(id));
    c.classList.remove('active-chip');
  });
  const activeId=EX[S.level][S.exIdx]?.id;
  if(activeId){ const el=document.getElementById('chip-'+activeId); if(el){ el.classList.add('active-chip'); el.scrollIntoView({block:'nearest',behavior:'smooth'}); } }
}
function toggleBrowser(){
  S.browserOpen=!S.browserOpen;
  document.getElementById('ex-grid-panel').classList.toggle('show',S.browserOpen);
  const btn=document.getElementById('browse-btn');
  btn.style.cssText=S.browserOpen?'background:var(--accent);color:#1A1000;border-color:var(--accent)':'';
}

// ════════════════════════════════════════
//  FOCUS
// ════════════════════════════════════════
function focusInput(){ HI.focus(); document.getElementById('typing-card').classList.add('focused'); }
HI.addEventListener('blur',()=>{
  document.getElementById('typing-card').classList.remove('focused');
  document.getElementById('caret').classList.remove('typing');
});
document.addEventListener('keydown', e=>{
  if(document.activeElement!==HI &&
     !['F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12'].includes(e.key) &&
     !e.ctrlKey && !e.metaKey)
  { HI.focus(); document.getElementById('typing-card').classList.add('focused'); }
});

// ════════════════════════════════════════
//  SETTERS
// ════════════════════════════════════════
function setMode(m){
  S.mode=m; S.streak=0; updateStreak();
  ['exercises','words','quotes','code'].forEach(x=>document.getElementById('mode-'+x).classList.toggle('active',x===m));
  const isEx=m==='exercises', isW=m==='words';
  document.getElementById('level-group').style.display  = isEx?'':'none';
  document.getElementById('sep-lv').style.display       = isEx?'':'none';
  document.getElementById('time-group').style.display   = isW?'':'none';
  document.getElementById('punc-group').style.display   = isW?'':'none';
  document.getElementById('num-group').style.display    = isW?'':'none';
  document.getElementById('browse-btn').style.display   = isEx?'':'none';
  document.getElementById('exercise-panel').classList.toggle('show',isEx);
  document.getElementById('ex-completion').style.display= isEx?'':'none';
  restartTest();
}
function setLevel(l){ S.level=l; S.exIdx=0; S.streak=0; updateStreak(); updateLvlBtns(); restartTest(); }
function updateLvlBtns(){
  ['easy','normal','hard'].forEach(l=>{
    const btn=document.getElementById('lv-'+l);
    btn.className='ctrl-btn'+(l===S.level?' '+l+'-active':'');
  });
}
function setTime(s){ S.timeLimit=s; [15,30,60,120].forEach(t=>document.getElementById('t'+t).classList.toggle('active',t===s)); restartTest(); }
function setPunctuation(v){ S.punctuation=v; document.getElementById('punc-off').classList.toggle('active',!v); document.getElementById('punc-on').classList.toggle('active',v); restartTest(); }
function setNumbers(v){ S.numbers=v; document.getElementById('num-off').classList.toggle('active',!v); document.getElementById('num-on').classList.toggle('active',v); restartTest(); }

// ════════════════════════════════════════
//  THEME
// ════════════════════════════════════════
function toggleTheme(){
  const d=document.documentElement.getAttribute('data-theme')==='dark';
  document.documentElement.setAttribute('data-theme',d?'light':'dark');
  document.getElementById('icon-sun').style.display  = d?'':'none';
  document.getElementById('icon-moon').style.display = d?'none':'';
  localStorage.setItem('kz_theme',d?'light':'dark');
  // redraw charts with updated colors
  if(S.sessionTests.length) drawSparkline(S.sessionTests.map(x=>x.wpm));
  if(S.liveWpmHistory.length) drawLiveChart();
  if(S.heatmapVisible) updateHeatmap();
}

// ════════════════════════════════════════
//  PERSISTENCE
// ════════════════════════════════════════
function saveComp(){ try{localStorage.setItem('kz_done',JSON.stringify([...S.completed]));}catch{} }
function loadComp(){ try{const d=JSON.parse(localStorage.getItem('kz_done')||'[]');S.completed=new Set(d);}catch{} }

// ════════════════════════════════════════
//  INIT
// ════════════════════════════════════════
(function init(){
  // theme
  const th=localStorage.getItem('kz_theme');
  if(th){
    document.documentElement.setAttribute('data-theme',th);
    document.getElementById('icon-sun').style.display  = th==='dark'?'none':'';
    document.getElementById('icon-moon').style.display = th==='dark'?'':'none';
  }
  // personal best
  const pW=localStorage.getItem('kz_pb_wpm'), pA=localStorage.getItem('kz_pb_acc');
  if(pW) S.pb={wpm:parseInt(pW),acc:parseInt(pA)};
  updatePB();
  // load completed set and build UI
  loadComp(); buildGrid(); buildKeyboard(); updateCompBars();
  setMode('exercises'); updateLvlBtns();
})();

window.addEventListener('resize',()=>moveCaret());
