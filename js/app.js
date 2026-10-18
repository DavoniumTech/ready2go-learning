import { readRecord, writeRecord, deleteRecord } from "./store.js";
import { R2_CONTENT_API_BASE } from "./content-config.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (v="") => String(v).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const CATEGORY_NAMES = { science:"Science", "humanities-arts":"Humanities & Arts", commerce:"Commerce" };
const RECOMMENDED = {
  science: ["mathematics","physics","chemistry","biology","computer-studies","agricultural-science"],
  "humanities-arts": ["government","literature-in-english","history","geography","islamic-studies","christian-religious-knowledge","fine-art","french","arabic","hausa","igbo","yoruba"],
  commerce: ["economics","commerce","principles-of-accounts","mathematics","government","home-economics"]
};
let subjects = [];
let packs = {};
let institutionsData = { states: [], institutions: [], additionalChoices: [] };
let coursesData = { courses: [] };
let questionArchive = { records: [] };
let remoteContentManifest = null;
let deferredInstallPrompt = null;
let profile = { displayName:"", category:"", selectedSubjects:["use-of-english","mathematics"], onboardingCompleted:false, isPreparingForJamb:"yes", state:"", institutionType:"", institutionId:"", institutionName:"", courseId:"", courseName:"", admissionYear:"2026" };
let authUser = null;
let page = "home";
let pendingPage = "home";
let practice = null;
let timerInterval = null;
let authUnsubscribe = null;
let authWatchStarted = false;
let onboardingStep = 0;
let installNudgeTimer = null;
let offlineCacheReady = false;
let institutionResultLimit = 24;
let courseResultLimit = 24;
let activeCatalogTab = "institutions";


async function loadContent() {
  const [subjectData, localManifest, institutionData, courseData, archiveData] = await Promise.all([
    fetch("./data/subjects.json").then(r => { if(!r.ok) throw new Error("Subjects could not be loaded"); return r.json(); }),
    fetch("./data/manifest.json").then(r => { if(!r.ok) throw new Error("Question manifest could not be loaded"); return r.json(); }),
    fetch("./data/institutions.json").then(r => r.ok ? r.json() : {states:[],institutions:[],additionalChoices:[]}).catch(()=>({states:[],institutions:[],additionalChoices:[]})),
    fetch("./data/courses.json").then(r => r.ok ? r.json() : {courses:[]}).catch(()=>({courses:[]})),
    fetch("./data/question-archive.json").then(r => r.ok ? r.json() : {records:[]}).catch(()=>({records:[]}))
  ]);
  subjects = subjectData.subjects || [];
  institutionsData = institutionData;
  coursesData = courseData;
  questionArchive = archiveData;
  packs = {};
  // Load the modest local shell packs first. Remote R2 packs are fetched only when requested.
  await Promise.all((localManifest.packs || []).map(async item => {
    try {
      const response = await fetch(`./data/${encodeURIComponent(item.file)}`);
      if (!response.ok) return;
      const pack = await response.json();
      if (Array.isArray(pack.questions) && pack.questions.every(validQuestion)) packs[item.subjectId] = pack.questions;
    } catch (error) { console.warn(`Question pack ${item.subjectId} unavailable`, error); }
  }));
  if (R2_CONTENT_API_BASE) {
    try {
      const response = await fetch(`${R2_CONTENT_API_BASE.replace(/\/$/, "")}/v1/manifest.json`, { cache: "no-cache" });
      if (response.ok) remoteContentManifest = await response.json();
    } catch (error) { console.info("Remote question manifest is not available; local packs remain usable.", error); }
  }
}
function validQuestion(q) {
  return Boolean(q && typeof q.id === "string" && typeof q.subjectId === "string" && typeof q.question === "string" && q.options && ["A","B","C","D"].every(k => typeof q.options[k] === "string") && ["A","B","C","D"].includes(q.correctAnswer) && typeof q.explanation === "string");
}
async function loadPackIfNeeded(subjectId) {
  const localQuestions = Array.isArray(packs[subjectId]) ? packs[subjectId] : [];
  const cached = await readRecord(`question-pack:${subjectId}`, null);
  const cachedValid = Boolean(cached && cached.subjectId === subjectId && Array.isArray(cached.questions) && cached.questions.every(validQuestion));
  const remoteEntry = remotePackEntry(subjectId);
  const canFetchPublishedRemote = Boolean(R2_CONTENT_API_BASE && navigator.onLine && remoteEntry);

  // When online, prefer an explicitly published R2 version so editors can update packs without a frontend rebuild.
  if (canFetchPublishedRemote) {
    try {
      const base = R2_CONTENT_API_BASE.replace(/\/$/, "");
      const response = await fetch(`${base}/v1/packs/${encodeURIComponent(subjectId)}.json`, { cache: "no-cache" });
      if (!response.ok) throw new Error(`Pack request returned ${response.status}`);
      const pack = await response.json();
      const ids = new Set();
      if (pack.status !== "published" || pack.subjectId !== subjectId || !Array.isArray(pack.questions) || !pack.questions.every(q => validQuestion(q) && q.subjectId === subjectId && q.reviewStatus === "approved" && !ids.has(q.id) && (ids.add(q.id), true))) {
        throw new Error("The downloaded pack is not approved for release or failed schema, subject or duplicate-ID validation.");
      }
      if (remoteEntry.version && pack.packVersion && remoteEntry.version !== pack.packVersion) {
        throw new Error("The downloaded pack version does not match the published manifest.");
      }
      packs[subjectId] = pack.questions;
      await writeRecord(`question-pack:${subjectId}`, { ...pack, downloadedAt: new Date().toISOString() });
      return packs[subjectId];
    } catch (error) {
      console.warn("Published R2 pack could not be downloaded; using available local content.", subjectId, error);
      if (!localQuestions.length && !(cachedValid && cached.status === "published")) {
        toast("This question pack could not be downloaded. Check your connection and try again.");
      }
    }
  }

  // Previously downloaded and published content remains available offline.
  if (cachedValid && cached.status === "published") {
    packs[subjectId] = cached.questions;
    return packs[subjectId];
  }
  if (localQuestions.length) return localQuestions;
  if (cachedValid) {
    packs[subjectId] = cached.questions;
    return packs[subjectId];
  }
  return [];
}

async function boot() {
  // Installation is invited with a visible, non-blocking in-app banner; never obscure the first screen.
  // Start the offline cache immediately instead of waiting for all question JSON fetches first.
  let serviceWorkerReady = Promise.resolve(false);
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    serviceWorkerReady = navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).then(reg => {
      if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
      return Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise(resolve => window.setTimeout(() => resolve(false), 10000))]);
    }).catch(err => { console.warn("Offline worker registration failed", err); return false; });
  }
  try { await loadContent(); }
  catch (error) { console.error(error); toast("Some learning content could not be loaded. Reload while connected to the internet."); }
  await serviceWorkerReady;
  offlineCacheReady = await checkOfflineCache();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("controllerchange", async () => {
      offlineCacheReady = await checkOfflineCache();
      updateConnectivityChip();
      if (offlineCacheReady) toast("Ready2Go is saved for offline practice on this device.");
    });
  }
  profile = { ...profile, ...(await readRecord("profile", profile) || {}) };
  const savedTheme = await readRecord("theme", "light");
  setTheme(savedTheme, false);
  if (!Array.isArray(profile.selectedSubjects) || !profile.selectedSubjects.length) profile.selectedSubjects = ["use-of-english","mathematics","physics","chemistry"];
  if (!profile.selectedSubjects.includes("use-of-english")) profile.selectedSubjects = ["use-of-english", ...profile.selectedSubjects].slice(0,4);
  profile.admissionYear = String(profile.admissionYear || "2026");
  onboardingStep = 0;
  page = profile.onboardingCompleted ? "home" : "welcome";
  await render();
  updateConnectivityChip();
}
function setTheme(theme, rerender=true) {
  const next = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) themeMeta.setAttribute("content", next === "dark" ? "#18151d" : "#F7F5FB");
  const button = $("#themeToggle");
  if (button) { button.innerHTML = next === "dark" ? '<span aria-hidden="true">☼</span><span>Light mode</span>' : '<span aria-hidden="true">☾</span><span>Dark mode</span>'; button.setAttribute("aria-label", `Switch to ${next === "dark" ? "light" : "dark"} mode`); }
  if (rerender && page !== "practice") render();
}
function toast(message) {
  let node = $("#toast");
  if (!node) { node = document.createElement("div"); node.id="toast"; node.className="toast"; node.setAttribute("role","status"); document.body.append(node); }
  node.textContent = message; node.classList.add("show"); clearTimeout(node._t); node._t=setTimeout(()=>node.classList.remove("show"),3600);
}
function remotePackEntry(subjectId) {
  return (remoteContentManifest?.packs || []).find(p => (p.subjectId === subjectId || p.id === subjectId) && p.status === "published") || null;
}
function hasRemotePack(subjectId) { return Boolean(remotePackEntry(subjectId)); }
function hasPackAvailable(subjectId) { return Boolean(packs[subjectId]?.length || hasRemotePack(subjectId)); }
function availableSubjects() { return subjects.filter(s => s.available || hasPackAvailable(s.id)); }
function getSessions() { return readRecord("sessions", []); }
function fmtDate(value) { try { return new Intl.DateTimeFormat(undefined,{dateStyle:"medium"}).format(new Date(value)); } catch { return "Recent"; } }
async function render() {
  const view = $("#view");
  const userLabel = $("#userLabel"); if (userLabel) userLabel.textContent = authUser?.displayName || profile.displayName || "Learner";
  $$("[data-page]").forEach(b=>b.classList.toggle("active",b.dataset.page===page));
  const labels={welcome:"Welcome",home:"Learning home",subjects:"My subjects","practice-setup":"Build a practice session",practice:"CBT practice",results:"Session results",progress:"Progress & analysis",profile:"Study plan & account","course-guide":"Course & institution finder",syllabus:"Syllabus planner","question-library":"Question library","study-coach":"Study Boost"};
  const sectionLabel=$("#currentSection"); if(sectionLabel) sectionLabel.textContent=labels[page]||"Overview";
  const backButton=$("#pageBack"); if(backButton){backButton.hidden=page==="welcome";backButton.setAttribute("aria-label",`Go back from ${labels[page]||page}`);}
  const avatar=$(".avatar-button"); if(avatar) avatar.textContent=(authUser?.displayName||profile.displayName||"R").trim().charAt(0).toUpperCase()||"R";
  if (page === "welcome") view.innerHTML = welcomeView();
  else if (page === "home") view.innerHTML = await homeView();
  else if (page === "subjects") view.innerHTML = await subjectsView();
  else if (page === "practice-setup") view.innerHTML = setupView();
  else if (page === "practice") view.innerHTML = practiceView();
  else if (page === "results") view.innerHTML = resultsView();
  else if (page === "progress") view.innerHTML = await progressView();
  else if (page === "profile") view.innerHTML = await profileView();
  else if (page === "study-coach") view.innerHTML = studyCoachView();
  else if (page === "course-guide") view.innerHTML = courseGuideView();
  else if (page === "syllabus") view.innerHTML = syllabusView();
  else if (page === "question-library") view.innerHTML = questionLibraryView();
  else view.innerHTML = await homeView();
  if (page === "profile") { refreshInstitutionOptions(); refreshCourseOptions(); }
  if (page === "practice-setup") { refreshTopics(); refreshSingleCountChoices(); syncSetupMode(); }
}
function welcomeView() {
 return `<section class="welcome-screen pro-welcome"><div class="welcome-copy pro-welcome-copy"><a href="https://www.davoniumtech.com/" class="welcome-company" target="_blank" rel="noopener noreferrer"><span class="brand-icon"><img src="./assets/r2g-app-icon.svg" alt=""></span><span><strong>Ready2Go</strong><small>BY DAVONIUM TECHNOLOGIES</small></span></a><p class="eyebrow">YOUR UTME PREPARATION SPACE</p><h1>Less panic.<br><em>More preparation.</em></h1><p class="lead">Build exam confidence one question at a time—with focused practice, clear explanations and progress you can actually understand.</p><div class="welcome-install-invite welcome-install-invite-top">${installBannerView()}</div><div class="welcome-highlight-grid"><span><b>01</b><strong>Practice</strong><small>Build speed and accuracy</small></span><span><b>02</b><strong>Understand</strong><small>Review why answers work</small></span><span><b>03</b><strong>Improve</strong><small>See patterns over time</small></span></div><div class="welcome-cta-row">${profile.onboardingCompleted?`<button class="button button-primary" data-page="home">Continue to dashboard <span>→</span></button>`:`<button class="button button-primary" data-action="start-onboarding">Set up my study space <span>→</span></button>`}<button class="button button-outline" data-action="open-auth">Sign in / create account</button></div><div class="welcome-trust-row"><span>✓ No payment needed to start</span><span>✓ Offline after first load and cache</span><span>✓ Your practice history stays on this device</span></div><p class="small-note welcome-disclaimer">A Davonium Technologies learning product, built to help you prepare with focus.</p></div><div class="pro-welcome-visual"><img src="./assets/study-buddies.webp" alt="Two students studying together at a desk"/><div class="welcome-photo-wash"></div><div class="welcome-floating-card floating-progress"><span class="float-symbol">↗</span><span><strong>Every session counts</strong><small>Track your own progress</small></span></div><div class="welcome-floating-card floating-offline"><span class="offline-check">✓</span><span><strong>Study on your schedule</strong><small>Local practice works offline after caching</small></span></div><div class="welcome-orbit orbit-a"></div><div class="welcome-orbit orbit-b"></div><div class="welcome-quote"><span>“Small steps still move you forward.”</span><small>THE READY2GO RULE</small></div></div></section>`;
}

function dashboardTrendMarkup(sessions) {
 const values = sessions.slice(0,7).reverse().map(s => Math.round((Number(s.score||0)/Math.max(1,Number(s.total||0)))*100));
 const hasData = values.length > 0;
 const W=360,H=152,L=28,R=12,T=14,B=25;
 const x=i => values.length===1 ? (L+W-R)/2 : L+i*((W-L-R)/Math.max(1,values.length-1));
 const y=v => T+(100-v)*(H-T-B)/100;
 const points=values.map((v,i)=>`${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
 const area=hasData?`M ${x(0).toFixed(1)} ${H-B} L ${values.map((v,i)=>`${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' L ')} L ${x(values.length-1).toFixed(1)} ${H-B} Z`:'';
 const circles=values.map((v,i)=>`<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3.5" fill="var(--chart-line)" stroke="var(--surface)" stroke-width="2"><title>Session ${i+1}: ${v}% accuracy</title></circle>`).join('');
 const grid=[0,25,50,75,100].map(v=>`<g><line x1="${L}" y1="${y(v).toFixed(1)}" x2="${W-R}" y2="${y(v).toFixed(1)}" stroke="var(--chart-grid)" stroke-dasharray="3 5"/><text x="${L-7}" y="${(y(v)+3).toFixed(1)}" text-anchor="end" fill="var(--muted)" font-size="8">${v}</text></g>`).join('');
 return `<div class="dashboard-chart" role="img" aria-label="Accuracy graph for your ${values.length} most recent sessions"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="r2gAreaFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--chart-line)" stop-opacity=".28"/><stop offset="100%" stop-color="var(--chart-line)" stop-opacity=".015"/></linearGradient></defs>${grid}${hasData?`<path d="${area}" fill="url(#r2gAreaFill)"/><polyline points="${points}" fill="none" stroke="var(--chart-line)" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>${circles}`:`<text x="180" y="67" text-anchor="middle" fill="var(--muted)" font-size="10">Your graph starts with session one</text><text x="180" y="83" text-anchor="middle" fill="var(--muted)" font-size="8">Finish a practice session to add a data point</text>`}<text x="${L}" y="${H-6}" fill="var(--muted)" font-size="8">${hasData?'Older':'Start'}</text><text x="${W-R}" y="${H-6}" text-anchor="end" fill="var(--muted)" font-size="8">${hasData?'Latest':'Your progress'}</text></svg></div>`;
}

async function homeView() {
 const sessions = await getSessions();
 const attempts = sessions.reduce((n,s)=>n+(s.answered ?? s.total),0);
 const correct = sessions.reduce((n,s)=>n+s.score,0);
 const accuracy = attempts ? Math.round(correct/attempts*100) : 0;
 const chosenSubjects = (profile.selectedSubjects||[]).slice(0,4).map(id=>subjects.find(s=>s.id===id)).filter(Boolean);
 const totalLocalQuestions = Object.values(packs).reduce((n,p)=>n+p.length,0);
 const recent = sessions[0];
 const greetingName = (profile.displayName || authUser?.displayName || "Learner").trim().split(/\s+/)[0];
 const trend = sessions.slice(0,7).map(s=>Math.round((s.score/Math.max(1,s.total))*100));
 const avgRecent = trend.length ? Math.round(trend.reduce((a,b)=>a+b,0)/trend.length) : 0;
 const circumference=2*Math.PI*34;
 const donutProgress=circumference*accuracy/100;
 const subjectTiles = chosenSubjects.map((s,i)=>`<button class="subject-quick-card subject-accent-${i%4}" data-action="start-subject" data-subject="${esc(s.id)}"><span class="subject-quick-icon">${esc(subjectIcon(s))}</span><span class="subject-quick-copy"><strong>${esc(s.name)}</strong><small>${(packs[s.id]||[]).length} practice questions</small></span><span class="subject-quick-arrow">↗</span></button>`).join("");
 const subjectButtons = [
  {title:"Course finder",sub:"Map your next step",glyph:"⌖",tone:"hex-green",page:"course-guide",spot:"hex-course"},
  {title:"Study Boost",sub:"Focus tricks & mini-challenges",glyph:"✦",tone:"hex-violet",page:"study-coach",spot:"hex-boost"},
  {title:"Progress",sub:"See your growth",glyph:"↗",tone:"hex-coral",page:"progress",spot:"hex-progress"},
  {title:"My subjects",sub:"Choose your set",glyph:"▦",tone:"hex-sky",page:"subjects",spot:"hex-subjects"},
  {title:"CBT Practice",sub:"Enter exam mode",glyph:"▣",tone:"hex-main",page:"practice-setup",spot:"hex-practice"},
  {title:"Question library",sub:"Browse your content",glyph:"▤",tone:"hex-gold",page:"question-library",spot:"hex-library"},
  {title:"Syllabus planner",sub:"Study topic by topic",glyph:"◷",tone:"hex-plum",page:"syllabus",spot:"hex-syllabus"}
 ];
 return `<section class="r2g-dashboard pro-dashboard">
  <header class="pro-dashboard-head"><div><p class="eyebrow"><span class="live-dot"></span> READY2GO LEARNING SPACE</p><h1>You're building momentum, ${esc(greetingName)} <span class="hello-sparkle">✦</span></h1><p>Show up, do the work, learn from the result. One session at a time.</p></div><div class="pro-head-actions"><span class="system-state ${navigator.onLine?'state-online':'state-offline'}"><i></i>${esc(connectionStatusText())}</span><button class="button button-primary pro-start-button" data-page="practice-setup"><span>▣</span> Start CBT <b>→</b></button></div></header>
  <div class="dashboard-metrics pro-metrics"><article class="dash-metric pro-metric"><span class="dash-metric-icon mint">▣</span><div><strong>${attempts.toLocaleString()}</strong><small>Questions attempted</small></div><span class="metric-side-note">Total</span></article><article class="dash-metric pro-metric"><span class="dash-metric-icon lilac">◉</span><div><strong>${accuracy}%</strong><small>Overall accuracy</small></div><span class="metric-side-note">${sessions.length?'Personal':'Not rated'}</span></article><article class="dash-metric pro-metric"><span class="dash-metric-icon peach">▤</span><div><strong>${totalLocalQuestions.toLocaleString()}</strong><small>Practice questions</small></div><span class="metric-side-note">Study bank</span></article><article class="dash-metric pro-metric"><span class="dash-metric-icon sky">▦</span><div><strong>${chosenSubjects.length}/4</strong><small>Subjects in your plan</small></div><button class="mini-edit" data-action="open-profile" aria-label="Edit my study plan">↗</button></article></div>
  ${installBannerView()}
  <div class="pro-dashboard-grid">
   <section class="pro-panel pro-launch-panel"><div class="pro-panel-heading"><div><p class="eyebrow">PICK YOUR NEXT MOVE</p><h2>Your study tools</h2></div><span class="panel-status">READY WHEN YOU ARE</span></div><div class="hex-launcher">${subjectButtons.map(c=>`<button class="hex-action ${c.spot} ${c.tone}" data-page="${c.page}" aria-label="${c.title}: ${c.sub}"><span class="hex-icon">${c.glyph}</span><strong>${c.title}</strong><small>${c.sub}</small></button>`).join('')}</div><div class="pro-panel-heading subject-heading-inline"><div><p class="eyebrow">YOUR UTME SET</p><h2>Jump back into a subject</h2></div><button class="text-button" data-page="subjects">Manage subjects ↗</button></div><div class="quick-subject-grid">${subjectTiles||`<button class="subject-quick-card" data-action="open-profile"><span class="subject-quick-icon">＋</span><span class="subject-quick-copy"><strong>Set up your subjects</strong><small>Choose your study combination</small></span></button>`}</div></section>
   <section class="pro-panel pro-performance-panel"><div class="pro-panel-heading"><div><p class="eyebrow">YOUR PRACTICE DATA</p><h2>Performance snapshot</h2></div><button class="square-link" data-page="progress" aria-label="Open detailed progress">↗</button></div><div class="accuracy-overview"><div class="accuracy-donut"><svg viewBox="0 0 88 88" aria-hidden="true"><circle cx="44" cy="44" r="34" fill="none" stroke="var(--chart-grid)" stroke-width="8"/><circle cx="44" cy="44" r="34" fill="none" stroke="var(--chart-line)" stroke-width="8" stroke-linecap="round" stroke-dasharray="${donutProgress.toFixed(1)} ${circumference.toFixed(1)}" transform="rotate(-90 44 44)"/><text x="44" y="42" text-anchor="middle" fill="var(--text)" font-size="17" font-weight="800">${accuracy}%</text><text x="44" y="55" text-anchor="middle" fill="var(--muted)" font-size="7">ACCURACY</text></svg></div><div class="accuracy-copy"><span class="accuracy-label">${sessions.length?'YOUR CURRENT AVERAGE':'YOUR JOURNEY STARTS HERE'}</span><strong>${sessions.length?(accuracy>=80?'Strong momentum':accuracy>=50?'Room to improve':'Every mistake teaches'):'No score pressure'}</strong><p>${sessions.length?`${attempts} answered questions across ${sessions.length} completed sessions.`:'Complete a short drill to build your personal baseline.'}</p></div></div><div class="chart-heading"><div><strong>Accuracy trend</strong><small>Last ${Math.min(7,sessions.length)} sessions</small></div><span class="chart-key"><i></i> Accuracy</span></div>${dashboardTrendMarkup(sessions)}<div class="chart-footnote"><span>↗ ${sessions.length?`${avgRecent}% average in recent sessions`:'Your first result will appear here'}</span><button class="text-button" data-page="progress">Detailed analysis ↗</button></div><div class="performance-facts"><div><span>⏱</span><strong>${sessions.filter(s=>s.timed).length}</strong><small>Timed sessions</small></div><div><span>✓</span><strong>${sessions.length}</strong><small>Sessions done</small></div><div><span>⚑</span><strong>${sessions.reduce((n,s)=>n+(s.flaggedCount||0),0)}</strong><small>Items flagged</small></div></div></section>
   <aside class="pro-dashboard-rail"><section class="student-photo-card"><img src="./assets/study-buddies.webp" alt="Students studying together"/><div class="photo-shade"></div><div class="photo-card-content"><span class="photo-label">THE READY2GO MINDSET</span><h2>No zero days.<br/>Even 5 questions count.</h2><p>Little effort today beats big plans for tomorrow.</p><button class="button button-light" data-page="practice-setup">Do a quick drill <span>→</span></button></div><span class="photo-sticker">R2G ✦</span></section><section class="recent-session-panel"><div class="pro-panel-heading"><div><p class="eyebrow">LAST SESSION</p><h2>Pick up where you left off</h2></div><button class="square-link" data-page="progress" aria-label="Open practice history">↗</button></div>${recent?`<div class="last-session-result"><span class="last-session-icon">✓</span><div><strong>${esc(recent.subjectName||'Practice session')}</strong><small>${fmtDate(recent.completedAt)} · ${recent.total} questions</small></div><b>${recent.score}/${recent.total}<small>${Math.round(recent.score/Math.max(1,recent.total)*100)}%</small></b></div><button class="button button-outline button-wide" data-page="practice-setup">Try another round ↗</button>`:`<div class="first-session-prompt"><span>▣</span><strong>Your first session is waiting.</strong><p>Start small. Finish strong. Check your answers after.</p><button class="button button-primary button-wide" data-page="practice-setup">Start your first session →</button></div>`}</section><a class="powered-by-link" href="https://www.davoniumtech.com/" target="_blank" rel="noopener noreferrer"><span class="powered-mark">D</span><span><strong>Made by Davonium Technologies</strong><small>Build your future, one step at a time ↗</small></span></a></aside>
  </div>
 </section>`;
}

function studyCoachView() {
 const tips = [
  {icon:"◷", tone:"tip-violet", title:"The 20-minute rescue plan", detail:"2 min: pick one topic. 12 min: solve questions without checking notes. 4 min: study the explanations. 2 min: write down the one thing to revise next."},
  {icon:"⚑", tone:"tip-coral", title:"Flag it, don't fight it", detail:"If a question steals more than 60–90 seconds, mark it for review and move on. The aim is to protect time for questions you can still answer."},
  {icon:"↻", tone:"tip-green", title:"Turn mistakes into marks", detail:"After each session, explain the correct answer in your own words. Then attempt a fresh question on the same topic later—recognising an answer is not the same as understanding it."},
  {icon:"✎", tone:"tip-blue", title:"English is a daily habit", detail:"Read a short passage, identify its main idea, and learn why each incorrect option is wrong. A few focused minutes often beat one long weekend cram."}
 ];
 return `<section class="study-boost-page"><header class="study-boost-hero"><div class="study-boost-copy"><p class="eyebrow">A LITTLE BOOST FOR THE BIG GOAL</p><h1>Study Boost <span class="hello-sparkle">✦</span></h1><p>Practical exam habits, tiny challenges and study ideas you can use right away.</p><div class="boost-hero-actions"><button class="button button-primary" data-page="practice-setup">Start a 5-question warm-up →</button><button class="button button-outline" data-action="study-tip">Give me a random tip ✦</button></div></div><div class="boost-hero-art" aria-hidden="true"><div class="boost-orbit boost-orbit-one"></div><div class="boost-orbit boost-orbit-two"></div><div class="boost-student-note"><span>R2G</span><strong>Small steps.</strong><strong>Big goals.</strong><small>MISSION: UNDERSTAND IT</small></div><div class="boost-star boost-star-one">✦</div><div class="boost-star boost-star-two">✎</div><div class="boost-star boost-star-three">✓</div></div></header><div class="study-boost-section-head"><div><p class="eyebrow">YOUR TOOLKIT</p><h2>Pick a move. Make it count.</h2></div><span class="panel-status">OFFLINE FRIENDLY</span></div><div class="study-tip-grid">${tips.map((t,i)=>`<article class="study-tip-card ${t.tone}"><div class="tip-card-top"><span class="tip-icon">${t.icon}</span><span class="tip-number">0${i+1}</span></div><h3>${t.title}</h3><p>${t.detail}</p><button class="tip-action" data-action="study-tip" data-tip-index="${i}">Use this tip <span>→</span></button></article>`).join('')}</div><section class="boost-challenge-panel"><div class="challenge-badge">⚡</div><div><p class="eyebrow">TODAY'S MINI-CHALLENGE</p><h2>Beat the 5-question warm-up</h2><p>Choose one subject, answer five questions, then read every explanation. No leaderboard, no pressure—just you getting a little stronger.</p></div><button class="button button-primary" data-page="practice-setup">Accept challenge →</button></section><p class="small-note">No magic tricks—just practical moves. The marks come from practice.</p></section>`;
}

function subjectIcon(subject) { const icons={"Mathematics":"∑","Use of English":"Aa","Physics":"ϕ","Biology":"⌘","Chemistry":"⚗","Computer Studies":"⌘","Arabic":"ع","French":"Fr","Music":"♫","Art":"✧","History":"◷","Agriculture":"♧"};return icons[subject.name]||"✦"; }
async function subjectsView() {
  const grouped = {science:[],"humanities-arts":[],commerce:[]};
  for (const s of subjects) if(grouped[s.category]) grouped[s.category].push(s);
  const list = items => [...items].sort((a,b)=>a.name.localeCompare(b.name)).map(s=>`<article class="subject-card is-available searchable-subject-card" data-subject-name="${esc(s.name.toLowerCase())}" data-subject-category="${esc(s.category)}"><div class="subject-icon">${subjectIcon(s)}</div><div class="subject-info"><h3>${esc(s.name)}</h3><p>${s.compulsory?"Compulsory subject · ":""}${packs[s.id]?.length||0} practice questions available</p></div><button class="icon-button" title="Practise ${esc(s.name)}" data-action="start-subject" data-subject="${s.id}">→</button></article>`).join("");
  const english = subjects.find(s=>s.id==="use-of-english");
  return `<section class="page-intro"><p class="eyebrow">SUBJECT LIBRARY</p><h1>Explore your subjects</h1><p class="muted lead">Find a subject instantly, check its available question count, and launch a focused practice session.</p></section>
  <div class="catalog-filter-bar subject-catalog-filters"><label class="search-field"><span aria-hidden="true">⌕</span><input id="subjectLibrarySearch" type="search" class="field" placeholder="Search mathematics, physics, literature…" autocomplete="off"></label><select id="subjectCategoryFilter" class="field" aria-label="Filter subject category"><option value="">All study areas</option><option value="compulsory">Compulsory</option><option value="science">Science</option><option value="humanities-arts">Humanities &amp; Arts</option><option value="commerce">Commerce</option></select><span id="subjectFilterCount" class="catalog-match-count">${subjects.length} subjects</span></div>
  <div class="subjects-summary-strip"><div><strong>${subjects.length}</strong><span>subject options</span></div><div><strong>${Object.values(packs).reduce((n,p)=>n+p.length,0)}</strong><span>practice questions</span></div><div><strong>4</strong><span>subjects in your plan</span></div></div>
  ${english?`<section class="subject-group compulsory-subject-group"><div class="group-heading"><h2>Compulsory subject</h2><span class="count-pill">Required for UTME</span></div><div class="subject-grid">${list([english])}</div></section>`:""}
  <section class="subject-group"><div class="group-heading"><h2>Science</h2><span class="count-pill">${grouped.science.length} subjects</span></div><div class="subject-grid">${list(grouped.science)}</div></section>
  <section class="subject-group"><div class="group-heading"><h2>Humanities &amp; Arts</h2><span class="count-pill">${grouped["humanities-arts"].length} subjects</span></div><div class="subject-grid">${list(grouped["humanities-arts"])}</div></section>
  <section class="subject-group"><div class="group-heading"><h2>Commerce</h2><span class="count-pill">${grouped.commerce.length} subjects</span></div><div class="subject-grid">${list(grouped.commerce)}</div></section>
  <p class="catalog-data-note">Question availability varies by subject. Open any subject to choose a topic, question count and practice timer.</p>`;
}
function setupView() {
  const active=[...availableSubjects()].sort((a,b)=>a.name.localeCompare(b.name));
  const defaultSubject=practice?.subjectId && practice.subjectId!=='mixed' ? practice.subjectId : ((profile.selectedSubjects||[]).find(id=>id!=='use-of-english')||'mathematics');
  // A learner starts with one subject. A four-subject session is an explicit choice.
  const defaultCombined=practice?.mode==='combined';
  const planned=(profile.selectedSubjects||[]).filter(id=>active.some(s=>s.id===id));
  const mixIds=(practice?.subjectIds?.length>1?practice.subjectIds:(planned.length>=4?planned:['use-of-english','mathematics','physics','chemistry'])).slice(0,4);
  const subjectOptions=active.map(s=>`<option value="${esc(s.id)}" ${defaultSubject===s.id?'selected':''}>${esc(s.name)}</option>`).join('');
  const countOption=(value,selected,label)=>`<option value="${value}" ${String(selected)===String(value)?'selected':''}>${label}</option>`;
  const mixOptions=active.map(s=>{
    const qs=packs[s.id]||[]; const availableCount=qs.length; const selected=mixIds.includes(s.id); const isEnglish=s.id==='use-of-english';
    const allowed=[5,10,20,30,40,50,60,70,80,100].filter(n=>n<=Math.max(availableCount,5));
    if(!allowed.length)allowed.push(5);
    const suggested=isEnglish?Math.min(60,Math.max(5,availableCount)):Math.min(40,Math.max(5,availableCount));
    const topicOptions=[...new Set(qs.map(q=>q.topic).filter(Boolean))].sort((a,b)=>a.localeCompare(b)).map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join('');
    return `<article class="mix-subject-option ${selected?'selected':''}" data-mix-subject-card data-subject-name="${esc(s.name.toLocaleLowerCase())}"><label class="subject-check mix-subject-check ${selected?'selected':''} ${isEnglish?'required-subject':''}"><input type="checkbox" name="mixSubjects" value="${esc(s.id)}" ${selected?'checked':''} ${isEnglish?'checked disabled':''}><span>${esc(s.name)}${isEnglish?' <small>Required</small>':''}</span><small>${availableCount} available</small></label><div class="mix-subject-controls ${selected?'':'hidden'}"><label>Question count<select name="subjectCount__${esc(s.id)}" class="field mix-count-select" ${selected?'':'disabled'}>${allowed.map(n=>countOption(n,suggested,`${n} questions`)).join('')}<option value="all">All ${availableCount} available</option><option value="custom">Custom count…</option></select><input name="subjectCustomCount__${esc(s.id)}" class="field mix-custom-count hidden" type="number" min="1" max="${availableCount}" step="1" placeholder="1–${availableCount}" aria-label="Custom count for ${esc(s.name)}" ${selected?'':'disabled'}></label><label>Topic<select name="subjectTopic__${esc(s.id)}" class="field mix-topic-select" ${selected?'':'disabled'}><option value="all">All available topics</option>${topicOptions}</select></label></div></article>`;
  }).join('');
  return `<section class="practice-wizard-page">
   <header class="page-intro practice-page-intro"><p class="eyebrow">PRACTICE SESSION BUILDER</p><h1>Build your practice session</h1><p class="muted lead">Choose exactly what you want to practise. Set question counts per subject, filter by topic, and choose a timer up to two hours.</p><div class="page-step-track"><span class="done">01 · Choose</span><i></i><span>02 · Configure</span><i></i><span>03 · Practise</span></div></header>
   <form id="setupForm" class="setup-layout rebuilt-setup-layout"><div class="setup-main"><div class="form-card setup-form-card rebuilt-setup-card">
    <div class="setup-mode-grid"><label class="setup-mode-card ${defaultCombined?'':'selected'}"><input type="radio" name="mode" value="single" ${defaultCombined?'':'checked'}><span class="setup-mode-icon">◈</span><span class="mode-text"><strong>One subject</strong><small>Focused topic practice</small></span></label><label class="setup-mode-card ${defaultCombined?'selected':''}"><input type="radio" name="mode" value="combined" ${defaultCombined?'checked':''}><span class="setup-mode-icon coral">✦</span><span class="mode-text"><strong>Combine subjects</strong><small>Move between subject tabs</small></span></label></div>
    <details class="setup-accordion" id="singleSubjectAccordion" ${defaultCombined?'':'open'}><summary><span class="accordion-step">01</span><span><strong>Choose your subject</strong><small>Find a subject, select a topic and choose how many questions</small></span><span class="accordion-chevron">⌄</span></summary>
    <section id="singleSubjectGroup" class="single-subject-group ${defaultCombined?'hidden':''}"><div class="setup-section-heading"><div><p class="eyebrow">STEP 1</p><h2>Choose your subject</h2><p>Search by name instead of scrolling through the full list.</p></div><span class="setup-count-badge">${active.length} subjects</span></div><label for="singleSubjectSearch">Search subjects</label><input id="singleSubjectSearch" type="search" class="field" placeholder="Type Mathematics, English, Biology…" autocomplete="off"><label for="subjectSelect">Selected subject</label><select id="subjectSelect" name="subject" class="field">${subjectOptions}</select><div class="setup-topic-grid"><div><label for="topicSelect">Topic filter</label><select id="topicSelect" name="topic" class="field"><option value="all">All available topics</option></select></div><div><label for="countSelect">Question count</label><select id="countSelect" name="count" class="field">${[5,10,20,30,40,50,60,70,80,100].map(n=>`<option value="${n}" ${n===5?'selected':''} ${n>(packs[defaultSubject]||[]).length?'disabled':''}>${n} questions${n>(packs[defaultSubject]||[]).length?' (not available yet)':''}</option>`).join('')}<option value="all">All available questions</option><option value="custom">Custom count…</option></select><input id="customCount" name="customCount" class="field custom-count-input hidden" type="number" min="1" max="${(packs[defaultSubject]||[]).length}" step="1" inputmode="numeric" placeholder="Enter a number up to ${(packs[defaultSubject]||[]).length}" aria-label="Custom question count"><small class="count-availability-hint">${(packs[defaultSubject]||[]).length} questions currently available in this subject</small></div></div></section></details>
    <details class="setup-accordion" id="mixedSubjectAccordion" ${defaultCombined?'open':''}><summary><span class="accordion-step">01</span><span><strong>Build a subject mix</strong><small>Search each subject and set its own question count</small></span><span class="accordion-chevron">⌄</span></summary>
    <section id="mixedSubjectsGroup" class="mixed-subjects-group ${defaultCombined?'':'hidden'}"><div class="field-section-heading"><div><p class="eyebrow">STEP 1</p><h2>Build your subject mix</h2><p>Choose up to four. Each subject has its own question count and optional topic filter.</p></div><span class="count-pill" id="mixCount">${mixIds.length}/4 selected</span></div><label for="mixSubjectSearch">Search subjects</label><input id="mixSubjectSearch" type="search" class="field" placeholder="Find a subject…" autocomplete="off"><div class="mix-subject-grid rebuilt-mix-grid" id="mixSubjectGrid">${mixOptions}</div><button type="button" class="button button-outline full-mock-preset" data-action="use-full-mock">Use full-length practice preset <span>180 questions · 120 minutes</span></button></section></details>
    <details class="setup-accordion" id="setupConditionsAccordion"><summary><span class="accordion-step">02</span><span><strong>Exam conditions</strong><small>Set difficulty, countdown and duration</small></span><span class="accordion-chevron">⌄</span></summary>
    <section class="setup-config-section"><div class="setup-section-heading"><div><p class="eyebrow">STEP 2</p><h2>Set your exam conditions</h2><p>Keep mixed difficulty for a more balanced practice session.</p></div></div><label>Difficulty</label><div class="choice-row difficulty-choices"><label class="choice"><input type="radio" name="difficulty" value="all" checked><span>Mixed</span></label><label class="choice"><input type="radio" name="difficulty" value="easy"><span>Easy</span></label><label class="choice"><input type="radio" name="difficulty" value="medium"><span>Medium</span></label><label class="choice"><input type="radio" name="difficulty" value="challenging"><span>Challenging</span></label></div><label class="check-row setup-timer-toggle"><input type="checkbox" name="timed" checked><span><strong>Use a countdown timer</strong><small>When time ends, your answers are submitted automatically.</small></span></label><div class="duration-field"><label for="durationMinutes">Session duration</label><div class="duration-control"><input id="durationMinutes" name="durationMinutes" class="field" type="number" min="1" max="120" step="1" value="60" inputmode="numeric"><span>minutes · maximum 2 hours</span></div><div class="duration-presets"><button type="button" data-action="set-duration" data-minutes="15">15 min</button><button type="button" data-action="set-duration" data-minutes="30">30 min</button><button type="button" data-action="set-duration" data-minutes="60">60 min</button><button type="button" data-action="set-duration" data-minutes="120">120 min</button></div></div></section></details>
    <div class="setup-submit-footer"><div><strong>Ready when you are</strong><small>Questions will not repeat inside one session.</small></div><button type="submit" class="button button-primary">Continue to practice <span>→</span></button></div>
   </div></div><aside class="setup-aside practice-aside rebuilt-setup-aside"><div class="setup-aside-photo"><img src="./assets/study-buddies.webp" alt="Students preparing together" loading="lazy"></div><span class="aside-mark">R2G</span><h3>Train with a plan.</h3><p>Focused practice, clear correction, no unnecessary distractions.</p><div class="setup-aside-stat-grid"><div><strong>${Object.values(packs).reduce((n,p)=>n+p.length,0).toLocaleString()}</strong><small>local practice items</small></div><div><strong>25</strong><small>subject areas</small></div><div><strong>120 min</strong><small>maximum timer</small></div></div><p class="small-note">Choose a focused topic, work through each question, then review every explanation before your next session.</p></aside></form></section>`;
}

function refreshTopics() {
  const subjectId=$("#subjectSelect")?.value; const topicSelect=$("#topicSelect"); if(!topicSelect)return;
  const qs=packs[subjectId]||[]; const topics=[...new Set(qs.map(q=>q.topic).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  topicSelect.innerHTML='<option value="all">All available topics</option>'+topics.map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join("");
}
function refreshSingleCountChoices() {
  const subjectId=$("#subjectSelect")?.value;
  const countSelect=$("#countSelect");
  const custom=$("#customCount");
  const available=(packs[subjectId]||[]).length;
  if(!countSelect)return;
  [...countSelect.options].forEach(option=>{
    if(option.value==="all"||option.value==="custom") { option.disabled=available===0; return; }
    const n=Number(option.value);
    option.disabled=n>available;
    option.textContent=n>available?`${n} questions (not available yet)`: `${n} questions`;
  });
  if(custom){custom.max=String(available);custom.placeholder=`Enter a number up to ${available}`;custom.classList.toggle("hidden",countSelect.value!=="custom");}
  const hint=$(".count-availability-hint"); if(hint)hint.textContent=`${available} questions currently available in this subject`;
  if(countSelect.selectedOptions[0]?.disabled)countSelect.value=available>=5?"5":"all";
}

async function startPractice(form) {
  const fd=new FormData(form); const mode=String(fd.get("mode")||"single");
  let subjectIds=mode==="combined"?[...new Set(fd.getAll("mixSubjects").map(String))].slice(0,4):[String(fd.get("subject")||"mathematics")];
  if(mode==="combined"){
    if(!subjectIds.includes("use-of-english")){subjectIds=["use-of-english",...subjectIds].slice(0,4);}
    if(subjectIds.length<2){toast("Choose at least two subjects for a combined session, including Use of English.");return;}
    if(subjectIds.length>4){toast("Choose no more than four subjects.");return;}
  }
  const selectedNames=subjectIds.map(id=>subjects.find(s=>s.id===id)?.name||id);
  const perSubject=[];
  for(const id of subjectIds){
    await loadPackIfNeeded(id);
    const topicName=mode==="combined"?String(fd.get(`subjectTopic__${id}`)||"all"):String(fd.get("topic")||"all");
    let questions=(packs[id]||[]).map(q=>({...q,id:`${id}::${q.id}`,subjectId:id,subjectName:subjects.find(s=>s.id===id)?.name||id}));
    if(topicName!=="all")questions=questions.filter(q=>q.topic===topicName);
    if(fd.get("difficulty")&&fd.get("difficulty")!=="all")questions=questions.filter(q=>q.difficulty===fd.get("difficulty"));
    if(!questions.length){toast(`No questions currently match ${subjects.find(s=>s.id===id)?.name||id} with those filters. Change its topic or difficulty.`);return;}
    const countValue=mode==="combined"?String(fd.get(`subjectCount__${id}`)||"all"):String(fd.get("count")||"5");
    const customValue=mode==="single"?String(fd.get("customCount")||"").trim():String(fd.get(`subjectCustomCount__${id}`)||"").trim();
    if(countValue==="custom"&&!customValue){toast("Enter a custom question count, or choose one of the presets.");return;}
    const requested=countValue==="all"?questions.length:Math.max(1,Number(customValue||countValue||5));
    if(!Number.isFinite(requested)||requested>questions.length||!Number.isInteger(requested)){toast(`${subjects.find(s=>s.id===id)?.name||id} currently has ${questions.length} matching questions. Reduce the count or choose all available.`);return;}
    const selected=shuffleQuestions(questions).slice(0,Math.min(requested,questions.length));
    if(selected.length<requested)toast(`${subjects.find(s=>s.id===id)?.name||id}: only ${selected.length} questions match. No questions have been invented or repeated.`);
    perSubject.push(...selected);
  }
  function shuffleQuestions(list){const a=[...list];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
  const pool=mode==="combined"?perSubject:shuffleQuestions(perSubject);
  if(!pool.length){toast("No questions match those filters yet.");return;}
  const enteredMinutes=Number(fd.get("durationMinutes")||60);
  if(!Number.isFinite(enteredMinutes)||enteredMinutes<1||enteredMinutes>120){toast("Set a timer between 1 and 120 minutes (maximum two hours).");return;}
  const requestedMinutes=Math.max(1,Math.min(120,enteredMinutes));
  const counts=subjectIds.map(id=>({id,count:pool.filter(q=>q.subjectId===id).length}));
  practice={subjectId:mode==="combined"?"mixed":subjectIds[0],subjectIds,subjectName:mode==="combined"?"Combined subject practice":selectedNames[0],mode,questions:pool,answers:{},flagged:[],index:0,timed:fd.has("timed"),durationMinutes:requestedMinutes,startedAt:Date.now(),secondsLeft:requestedMinutes*60,submitted:false,score:0,perSubjectCounts:counts};
  page="practice";await render();if(practice.timed)startTimer();
}

function startTimer() {
  clearInterval(timerInterval); timerInterval=setInterval(()=>{
    if(!practice||practice.submitted||!practice.timed){clearInterval(timerInterval);return;}
    practice.secondsLeft--; const node=$("#timerValue"); if(node)node.textContent=formatTime(practice.secondsLeft);
    if(practice.secondsLeft<=0){clearInterval(timerInterval);finishPractice(true);}
  },1000);
}
function formatTime(sec){const s=Math.max(0,sec);return `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;}
function practiceView() {
  if(!practice)return setupView();
  const q=practice.questions[practice.index]; const i=practice.index+1; const n=practice.questions.length;
  const answered=Object.keys(practice.answers).length;
  return `<div class="cbt-top"><div><p class="eyebrow">READY2GO CBT</p><h1>${esc(q.subjectName||practice.subjectName)}</h1><p class="muted small">Question ${i} of ${n} · ${esc(q.topic)}</p></div><div class="cbt-top-right">${practice.timed?`<div class="timer ${practice.secondsLeft<60?'timer-warning':''}"><span>Time left</span><strong id="timerValue">${formatTime(practice.secondsLeft)}</strong></div>`:`<div class="status-chip"><span class="status-dot"></span> No timer</div>`}<button class="button button-outline" data-action="confirm-end">Finish</button></div></div>${practice.mode==="combined"?`<div class="cbt-subject-tabs" aria-label="Switch subject">${practice.subjectIds.map(id=>{const sub=subjects.find(x=>x.id===id);const count=practice.questions.filter(x=>x.subjectId===id).length;return `<button type="button" class="cbt-subject-tab ${q.subjectId===id?'active':''}" data-action="switch-subject" data-subject="${esc(id)}">${esc(sub?.name||id)} <small>${count}</small></button>`}).join("")}</div>`:""}<div class="cbt-progress"><span style="width:${Math.round(i/n*100)}%"></span></div><div class="cbt-layout"><section class="question-panel"><div class="question-meta"><span class="question-number">QUESTION ${String(i).padStart(2,"0")}</span><button class="flag-button ${practice.flagged.includes(q.id)?'flagged':''}" data-action="flag-question">${practice.flagged.includes(q.id)?'⚑ Marked for review':'⚐ Mark for review'}</button></div><h2 class="question-text">${esc(q.question)}</h2><div class="options-list">${Object.entries(q.options).map(([key,value])=>`<label class="answer-option ${practice.answers[q.id]===key?'selected':''}"><input type="radio" name="answer" value="${key}" ${practice.answers[q.id]===key?'checked':''}><span class="option-key">${key}</span><span class="option-text">${esc(value)}</span></label>`).join("")}</div><div class="question-nav"><button class="button button-outline" data-action="prev-question" ${practice.index===0?'disabled':''}>← Previous</button><span class="answered-count">${answered} of ${n} answered</span>${practice.index<n-1?`<button class="button button-primary" data-action="next-question">Next question →</button>`:`<button class="button button-primary" data-action="confirm-end">Review &amp; submit</button>`}</div></section><aside class="question-map"><div class="map-heading"><h3>Question navigator</h3><span>${answered}/${n}</span></div><p class="small-note">Select a number to move directly to that question.</p><div class="number-grid question-number-grid">${practice.questions.map((question,idx)=>`<button class="number-button ${idx===practice.index?'current':''} ${practice.answers[question.id]?'answered':''} ${practice.flagged.includes(question.id)?'flagged':''}" data-action="go-question" data-index="${idx}" aria-label="Go to question ${idx+1}">${idx+1}</button>`).join("")}</div><div class="legend"><span><i class="legend-current"></i>Current</span><span><i class="legend-answered"></i>Answered</span><span><i class="legend-flagged"></i>Review</span></div><button class="button button-primary button-wide" data-action="confirm-end">Submit answers</button></aside></div>`;
}
function confirmFinish() {
  const answered=Object.keys(practice.answers).length;
  const missing=practice.questions.length-answered;
  const confirmed=window.confirm(`Submit this session?\n\nAnswered: ${answered}/${practice.questions.length}\nUnanswered: ${missing}\n\nYou cannot change answers after submission.`);
  if(confirmed) finishPractice(false);
}
async function finishPractice(auto=false) {
  if(!practice||practice.submitted)return;
  clearInterval(timerInterval); practice.submitted=true;
  practice.score=practice.questions.reduce((score,q)=>score+(practice.answers[q.id]===q.correctAnswer?1:0),0);
  const sessions=await getSessions();
  const session={id:`session-${Date.now()}`,subjectId:practice.subjectId,subjectName:practice.subjectName,total:practice.questions.length,score:practice.score,answered:Object.keys(practice.answers).length,completedAt:new Date().toISOString(),timed:practice.timed,autoSubmitted:auto,items:practice.questions.map(q=>({id:q.id,subjectId:q.subjectId||practice.subjectId,subjectName:q.subjectName||practice.subjectName,topic:q.topic||"Uncategorised",answer:practice.answers[q.id]||null,correctAnswer:q.correctAnswer}))};
  sessions.unshift(session); await writeRecord("sessions",sessions.slice(0,200));
  let cloudSync = "local";
  if (authUser && navigator.onLine && practice.subjectId !== "mixed") {
    try {
      const { recordPracticeSummaryRemote } = await import("./firebase.js");
      await recordPracticeSummaryRemote({ sessionId: session.id, subjectId: session.subjectId, subjectIds: practice.subjectIds || [session.subjectId], subjectName: session.subjectName, total: session.total, answered: session.answered, score: session.score, timed: session.timed, completedAt: session.completedAt });
      cloudSync = "synced";
    } catch (error) { console.info("Practice summary stays local until cloud functions are ready", error); }
  }
  page="results"; await render(); if(auto)toast("Time ended. Your answers have been submitted."); else if(cloudSync === "synced") toast("Practice summary synced to your account.");
}
function resultsView() {
  if(!practice||!practice.submitted)return `<section class="empty-state"><h2>No completed session</h2><button class="button button-primary" data-page="practice-setup">Start practice</button></section>`;
  const score=practice.score; const total=practice.questions.length; const pct=Math.round(score/total*100);
  const headline=pct>=80?"Strong work. Keep practising.":pct>=50?"Good effort. Review the explanations and strengthen the gaps.":"This score is a starting point, not a verdict. Review the solutions and try again.";
  const bySubject=[...new Set(practice.questions.map(q=>q.subjectId))].map(id=>{const qs=practice.questions.filter(q=>q.subjectId===id);const got=qs.filter(q=>practice.answers[q.id]===q.correctAnswer).length;return {id,name:subjects.find(x=>x.id===id)?.name||qs[0]?.subjectName||id,total:qs.length,got,pct:Math.round(got/Math.max(1,qs.length)*100)}});
  const graphW=520,graphH=164,graphLeft=40,graphRight=15,graphTop=17,graphBottom=136;
  const graphX=i=>bySubject.length===1?((graphW+graphLeft-graphRight)/2):graphLeft+i*((graphW-graphLeft-graphRight)/Math.max(1,bySubject.length-1));
  const graphY=pct=>graphTop+(100-pct)*(graphBottom-graphTop)/100;
  const graphPoints=bySubject.map((x,i)=>`${graphX(i).toFixed(1)},${graphY(x.pct).toFixed(1)}`).join(" ");
  const graphArea=`M ${graphX(0).toFixed(1)} ${graphBottom} L ${bySubject.map((x,i)=>`${graphX(i).toFixed(1)} ${graphY(x.pct).toFixed(1)}`).join(" L ")} L ${graphX(bySubject.length-1).toFixed(1)} ${graphBottom} Z`;
  const graphGrid=[0,25,50,75,100].map(v=>{const y=graphY(v).toFixed(1);return `<g><line x1="${graphLeft}" y1="${y}" x2="${graphW-graphRight}" y2="${y}" stroke="var(--chart-grid)" stroke-dasharray="4 5"/><text x="${graphLeft-8}" y="${Number(y)+3}" text-anchor="end" fill="var(--muted)" font-size="9">${v}%</text></g>`;}).join("");
  const graphDots=bySubject.map((x,i)=>`<circle cx="${graphX(i).toFixed(1)}" cy="${graphY(x.pct).toFixed(1)}" r="4.2" fill="var(--chart-line)" stroke="var(--surface)" stroke-width="2"><title>${esc(x.name)}: ${x.pct}%</title></circle>`).join("");
  const graphLabels=bySubject.map((x,i)=>{const label=x.name==="Use of English"?"English":x.name.length>12?x.name.slice(0,11)+"…":x.name;return `<text x="${graphX(i).toFixed(1)}" y="157" fill="var(--muted)" text-anchor="middle" font-size="9">${esc(label)}</text>`;}).join("");
  const resultGraph=`<section class="result-analytics analytics-panel"><div class="section-head"><div><p class="eyebrow">YOUR SESSION</p><h2>Performance by subject</h2><p class="muted small">Correct answers as a percentage of questions attempted in this session.</p></div></div>${bySubject.map(x=>`<div class="analytics-row"><div class="analytics-row-label"><strong>${esc(x.name)}</strong><span>${x.got}/${x.total} correct</span></div><div class="analytics-track"><span style="width:${x.pct}%"></span></div><b>${x.pct}%</b></div>`).join("")}<div class="result-graph session-area-graph" role="img" aria-label="Area graph of accuracy by subject for this session"><svg viewBox="0 0 ${graphW} ${graphH}" preserveAspectRatio="none"><defs><linearGradient id="sessionAreaFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--chart-line)" stop-opacity=".27"/><stop offset="100%" stop-color="var(--chart-line)" stop-opacity=".015"/></linearGradient></defs>${graphGrid}<path d="${graphArea}" fill="url(#sessionAreaFill)"/><polyline points="${graphPoints}" fill="none" stroke="var(--chart-line)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>${graphDots}${graphLabels}</svg></div></section>`;
  return `<section class="results-hero"><div class="result-symbol">${pct>=80?'✓':pct>=50?'↗':'R2G'}</div><p class="eyebrow">SESSION COMPLETE</p><h1>${score} <span>/ ${total}</span></h1><div class="result-pct">${pct}% correct</div><p class="result-message">${headline}</p><div class="result-stats"><div><strong>${Object.keys(practice.answers).length}</strong><span>Answered</span></div><div><strong>${total-Object.keys(practice.answers).length}</strong><span>Unanswered</span></div><div><strong>${total-score}</strong><span>To review</span></div></div><div class="result-actions"><button class="button button-primary" data-action="review-answers">Review answers</button><button class="button button-outline" data-action="retry">Practise again</button><button class="text-button" data-page="home">Back to dashboard</button></div></section>${resultGraph}<section id="answerReview" class="answer-review hidden"><div class="section-head"><div><p class="eyebrow">LEARN FROM EVERY QUESTION</p><h2>Answer review</h2></div></div>${practice.questions.map((q,i)=>{const user=practice.answers[q.id];const ok=user===q.correctAnswer;return `<article class="review-card"><div class="review-title"><span class="review-badge ${ok?'correct':'incorrect'}">${ok?'Correct':'Review'}</span><span>Question ${i+1} · ${esc(q.topic)}</span></div><h3>${esc(q.question)}</h3><p class="your-answer">Your answer: <strong>${user?esc(user)+'. '+esc(q.options[user]):'Not answered'}</strong></p><p class="correct-answer">Correct answer: <strong>${q.correctAnswer}. ${esc(q.options[q.correctAnswer])}</strong></p><p class="explanation">${esc(q.explanation)}</p></article>`}).join("")}</section>`;
}
function progressAreaGraph(values) {
 const W=520,H=174,L=35,R=14,T=15,B=28;
 const x=i=>values.length===1?(L+W-R)/2:L+i*((W-L-R)/Math.max(1,values.length-1));
 const y=v=>T+(100-v)*(H-T-B)/100;
 const grid=[0,25,50,75,100].map(v=>`<g><line x1="${L}" y1="${y(v)}" x2="${W-R}" y2="${y(v)}" stroke="var(--chart-grid)" stroke-dasharray="4 5"/><text x="${L-9}" y="${y(v)+3}" text-anchor="end" fill="var(--muted)" font-size="9">${v}%</text></g>`).join('');
 if(!values.length) return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="No accuracy data yet"><text x="${W/2}" y="${H/2-4}" text-anchor="middle" fill="var(--muted)" font-size="12">Your progress chart starts here</text><text x="${W/2}" y="${H/2+14}" text-anchor="middle" fill="var(--muted)" font-size="9">Complete a session to create your first data point</text></svg>`;
 const pts=values.map((v,i)=>`${x(i)},${y(v)}`).join(' ');
 const area=`M ${x(0)} ${H-B} L ${values.map((v,i)=>`${x(i)} ${y(v)}`).join(' L ')} L ${x(values.length-1)} ${H-B} Z`;
 return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Accuracy percentages for recent practice sessions"><defs><linearGradient id="progressAreaFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--chart-line)" stop-opacity=".25"/><stop offset="100%" stop-color="var(--chart-line)" stop-opacity=".01"/></linearGradient></defs>${grid}<path d="${area}" fill="url(#progressAreaFill)"/><polyline points="${pts}" fill="none" stroke="var(--chart-line)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>${values.map((v,i)=>`<circle cx="${x(i)}" cy="${y(v)}" r="4" fill="var(--chart-line)" stroke="var(--surface)" stroke-width="2"><title>Session ${i+1}: ${v}%</title></circle>`).join('')}<text x="${L}" y="${H-7}" fill="var(--muted)" font-size="9">Older sessions</text><text x="${W-R}" y="${H-7}" text-anchor="end" fill="var(--muted)" font-size="9">Latest session</text></svg>`;
}

async function progressView() {
 const sessions=await getSessions(); const attempts=sessions.reduce((a,s)=>a+(s.answered ?? s.total),0);const correct=sessions.reduce((a,s)=>a+s.score,0);
 const subjectStats=new Map(), topicStats=new Map();
 for(const session of sessions){for(const item of (session.items||[])){if(!item.answer)continue;const ok=item.answer===item.correctAnswer;const sid=item.subjectId||session.subjectId||"unknown";const sname=item.subjectName||session.subjectName||sid;const sr=subjectStats.get(sid)||{name:sname,attempts:0,correct:0};sr.attempts++;sr.correct+=ok?1:0;subjectStats.set(sid,sr);const tk=`${sid}::${item.topic||"Uncategorised"}`;const tr=topicStats.get(tk)||{name:item.topic||"Uncategorised",subject:sname,attempts:0,correct:0};tr.attempts++;tr.correct+=ok?1:0;topicStats.set(tk,tr);}}
 const subjectBars=[...subjectStats.values()].sort((a,b)=>(a.correct/Math.max(1,a.attempts))-(b.correct/Math.max(1,b.attempts))).map(x=>`<div class="analytics-row"><div class="analytics-row-label"><strong>${esc(x.name)}</strong><span>${x.correct}/${x.attempts} correct</span></div><div class="analytics-track"><span style="width:${Math.round(x.correct/Math.max(1,x.attempts)*100)}%"></span></div><b>${Math.round(x.correct/Math.max(1,x.attempts)*100)}%</b></div>`).join("");
 const weakTopics=[...topicStats.values()].filter(x=>x.attempts>=2).sort((a,b)=>(a.correct/Math.max(1,a.attempts))-(b.correct/Math.max(1,b.attempts))).slice(0,5);
 const weakMarkup=weakTopics.length?weakTopics.map(x=>`<article class="weak-topic-card"><span class="weak-topic-mark">↗</span><div><strong>${esc(x.name)}</strong><small>${esc(x.subject)} · ${x.correct}/${x.attempts} correct</small></div><span class="weak-topic-score">${Math.round(x.correct/Math.max(1,x.attempts)*100)}%</span></article>`).join(""):`<p class="muted small">Complete a few sessions to identify topics that may need more revision. Topic diagnostics only use saved question-level attempts.</p>`;
 const recentTrend=sessions.slice(0,7).reverse().map(x=>Math.round((x.score/Math.max(1,x.total))*100));
 const trendMarkup=`<section class="analytics-panel trend-panel"><div class="section-head"><div><p class="eyebrow">LAST ${recentTrend.length} SESSIONS</p><h2>Accuracy trend</h2></div><span class="panel-status">${recentTrend.length?'PERSONAL DATA':'START HERE'}</span></div><div class="result-graph trend-graph">${progressAreaGraph(recentTrend)}</div><p class="muted small">Each point is one completed practice session, ordered from oldest to newest. This is a learning metric, not an official JAMB score prediction.</p></section>`;
 return `${installBannerView()}<section class="page-intro"><p class="eyebrow">YOUR PROGRESS</p><h1>Your learning history</h1><p class="muted lead">See how your practice is going and what to revisit next.</p></section><section class="metric-grid"><article class="metric-card"><span class="metric-label">Completed sessions</span><strong>${sessions.length}</strong></article><article class="metric-card"><span class="metric-label">Questions answered</span><strong>${attempts}</strong></article><article class="metric-card"><span class="metric-label">Overall accuracy</span><strong>${attempts?Math.round(correct/attempts*100):0}%</strong></article></section>${trendMarkup}<section class="analytics-panel"><div class="section-head"><div><p class="eyebrow">SUBJECT-BY-SUBJECT</p><h2>Accuracy overview</h2></div></div>${subjectBars||'<p class="muted small">Subject performance appears after you complete a practice session.</p>'}</section><section class="analytics-panel"><div class="section-head"><div><p class="eyebrow">REVISION PRIORITIES</p><h2>Topics to revisit</h2></div></div>${weakMarkup}</section><section class="section-head spaced"><div><h2>Recent sessions</h2></div><button class="text-button" data-action="export-data">Export my local data</button></section>${sessions.length?sessions.map(s=>`<article class="recent-card"><div class="recent-icon">✓</div><div class="recent-copy"><strong>${esc(s.subjectName)}</strong><span>${fmtDate(s.completedAt)} · ${s.total} questions${s.timed?' · timed':''}${s.autoSubmitted?' · auto-submitted':''}</span></div><div class="recent-score"><strong>${s.score}/${s.total}</strong><span>${Math.round(s.score/Math.max(1,s.total)*100)}%</span></div></article>`).join(""):`<div class="empty-state"><div class="empty-symbol">↗</div><h2>No practice history yet</h2><p>Finish your first session to see your results here.</p><button class="button button-primary" data-page="practice-setup">Start a session</button></div>`}<section class="danger-zone"><div><h3>Clear local practice history</h3><p>This removes the saved sessions from this browser only.</p></div><button class="button button-danger" data-action="clear-history">Clear history</button></section>`;
}
async function profileView() {
 const selected=new Set((profile.selectedSubjects||[]).filter(id=>id!=="use-of-english"));
 const subjectChecks=subjects.filter(s=>s.id!=="use-of-english").map(s=>`<label class="subject-check"><input type="checkbox" name="selectedSubjects" value="${s.id}" ${selected.has(s.id)?'checked':''}><span>${esc(s.name)}</span><small>${packs[s.id]?.length||0} Q</small></label>`).join("");
 const categoryMarkup=Object.entries(CATEGORY_NAMES).map(([id,name])=>`<label class="category-card ${profile.category===id?'selected':''}"><input type="radio" name="category" value="${id}" ${profile.category===id?'checked':''} required><span class="category-symbol">${id==='science'?'∑':id==='commerce'?'₦':'Aa'}</span><strong>${name}</strong><small>${id==='science'?'Science, technology and health':id==='commerce'?'Business, accounting and economics':'Arts, languages, society and culture'}</small></label>`).join("");
 const stateOpts=(institutionsData.states||[]).map(state=>`<option value="${esc(state)}" ${profile.state===state?'selected':''}>${esc(state)}</option>`).join("");
 const courseOpts=[...(coursesData.courses||[])].sort((a,b)=>a.name.localeCompare(b.name)).map(c=>`<option value="${esc(c.id)}" ${profile.courseId===c.id?'selected':''}>${esc(c.name)}</option>`).join("");
 const stepTitles=["Start with you","Choose your destination","Build your four-subject plan"];
 const stepDescriptions=["A few details help us tailor your study space.","Pick your preferred university and course. You can change them later.","Use of English stays in the UTME set; choose up to three other subjects."];
 const progress=`<div class="wizard-progress" aria-label="Onboarding step ${onboardingStep+1} of 3">${[0,1,2].map(i=>`<span class="wizard-step ${i===onboardingStep?'current':i<onboardingStep?'done':''}"><b>${i<onboardingStep?'✓':String(i+1).padStart(2,'0')}</b><small>${['You','Destination','Subjects'][i]}</small></span>`).join('<i></i>')}</div>`;
 let stepFields="";
 if(onboardingStep===0){
  stepFields=`<label for="displayName">What should we call you?</label><input id="displayName" name="displayName" class="field" value="${esc(profile.displayName||authUser?.displayName||'')}" placeholder="Your name" maxlength="80" autocomplete="name">
  <label for="isPreparingForJamb">Are you preparing for JAMB UTME?</label><select id="isPreparingForJamb" name="isPreparingForJamb" class="field"><option value="yes" ${profile.isPreparingForJamb!=='no'&&profile.isPreparingForJamb!=='exploring'?'selected':''}>Yes, I am preparing for UTME</option><option value="exploring" ${profile.isPreparingForJamb==='exploring'?'selected':''}>I'm exploring my options</option><option value="no" ${profile.isPreparingForJamb==='no'?'selected':''}>Not yet</option></select>
  <label>Which study area sounds closest to your goal?</label><div class="category-cards">${categoryMarkup}</div>
  <label for="admissionYear">Admission guidance year</label><select id="admissionYear" name="admissionYear" class="field"><option value="2026" ${String(profile.admissionYear||'2026')==='2026'?'selected':''}>2026 admission guidance (verified national benchmarks)</option><option value="2027" ${String(profile.admissionYear)==='2027'?'selected':''}>2027 — verify latest guidance when published</option></select>
  <p class="small-note">Your plan is saved on this device as you set it up. You can edit your subjects later, even offline.</p>`;
 } else if(onboardingStep===1){
  stepFields=`<label for="profileState">State / FCT where the institution is located</label><select id="profileState" name="state" class="field"><option value="">All states and FCT</option>${stateOpts}</select>
  <label for="profileInstitutionType">Institution ownership / type</label><select id="profileInstitutionType" name="institutionType" class="field"><option value="">All university types</option><option value="Federal" ${profile.institutionType==='Federal'?'selected':''}>Federal university</option><option value="State" ${profile.institutionType==='State'?'selected':''}>State university</option><option value="Private" ${profile.institutionType==='Private'?'selected':''}>Private university</option><option value="other-tertiary" ${profile.institutionType==='other-tertiary'?'selected':''}>Polytechnic / College / other tertiary</option><option value="undecided" ${profile.institutionType==='undecided'?'selected':''}>I haven't chosen an institution</option></select>
  <label for="profileInstitutionSearch">Search institution by name</label><input id="profileInstitutionSearch" type="search" class="field" placeholder="Type part of the institution name…" value="${esc(profile.institutionName||'')}" autocomplete="off"><select id="profileInstitution" name="institutionId" class="field"><option value="">Choose an institution (optional)</option></select>
  <label for="profileInstitutionName">Or enter an institution name not listed</label><input id="profileInstitutionName" name="institutionName" class="field" value="${esc(profile.institutionName||'')}" placeholder="Enter exact institution name" maxlength="160">
  <label for="profileCourseSearch">Search course or programme</label><input id="profileCourseSearch" type="search" class="field" placeholder="Search Medicine, Law, Engineering…" autocomplete="off"><label for="profileCourse">Course / programme</label><select id="profileCourse" name="courseId" class="field"><option value="">Choose a course or programme (optional)</option>${courseOpts}<option value="other-course" ${profile.courseId==='other-course'?'selected':''}>Other / not listed</option></select>
  <label for="profileCourseName">Or enter a programme name</label><input id="profileCourseName" name="courseName" class="field" value="${esc(profile.courseName||'')}" placeholder="e.g. Computer Science" maxlength="120">
  <div class="guidance-alert"><strong>2026 admission guidance</strong><p>JAMB’s 2026 national minimum admissible score is 150 for universities and Colleges of Nursing, and 100 for polytechnics, monotechnics, colleges of agriculture and IEIs. These are national floors, not course-specific cut-off marks. Institutions can set higher requirements.</p><span class="small-note">Confirm the latest course and subject requirements through the relevant official admissions guidance.</span></div>`;
 } else {
  stepFields=`<div class="subject-pick-heading"><div><h2>Choose your subjects</h2><p class="muted small">Choose three electives. Use of English is always included in this UTME study set.</p></div><button type="button" class="text-button" data-action="use-recommendations">Recommend for me</button></div>
  <div class="required-english-card"><span class="required-english-icon">Aa</span><div><strong>Use of English</strong><small>Compulsory subject included automatically</small></div><span class="required-pill">Required</span></div>
  <div class="subject-check-grid onboarding-subject-grid">${subjectChecks}</div>
  <div class="selection-summary"><span class="summary-check">✓</span><div><strong>Four-subject plan</strong><p>Use of English + up to three of the subjects above. You can edit the plan offline at any time.</p></div><span class="count-pill">Max 4</span></div>
  <p class="small-note">The category suggestion is only a starting point. The exact combination depends on your selected institution and programme. Use IBASS to verify before registration.</p>`;
 }
 const actionButtons=onboardingStep===0?`<button type="button" class="button button-primary button-wide" data-action="onboarding-next">Continue to your destination →</button>`:onboardingStep===1?`<div class="wizard-buttons"><button type="button" class="button button-outline" data-action="onboarding-back">← Back</button><button type="button" class="button button-primary" data-action="onboarding-next">Continue to subjects →</button></div>`:`<div class="wizard-buttons"><button type="button" class="button button-outline" data-action="onboarding-back">← Back</button><button type="submit" class="button button-primary">Save my study plan ✓</button></div>`;
 return `<section class="onboarding-shell"><div class="onboarding-main"><div class="onboarding-heading"><p class="eyebrow">YOUR PERSONAL STUDY PLAN · STEP ${onboardingStep+1} OF 3</p><h1>${stepTitles[onboardingStep]}.</h1><p class="muted lead">${stepDescriptions[onboardingStep]}</p></div>${progress}
 <form id="profileForm" class="profile-layout wizard-layout"><div class="form-card onboarding-card wizard-card">${stepFields}${actionButtons}</div>
 <aside class="setup-aside polygon-aside onboarding-side"><div class="onboarding-side-photo"><img src="./assets/study-buddies.webp" alt="Students preparing for a study session" loading="lazy"></div><span class="side-kicker">YOUR NEXT CHAPTER</span><h3>A plan that grows with you.</h3><p>Ready2Go remembers your study preferences on this device, so you can change subjects or revisit your goal—even offline.</p><div class="side-stat-list"><span>✦ <b>25</b> subject choices</span><span>◈ <b>328</b> NUC directory entries</span><span>✓ <b>4</b> subjects in your plan</span></div><span class="small-note">Check current admission eligibility using official guidance before applying.</span></aside></form>
 <p class="onboarding-footnote">No payment is needed to begin practising. <a href="./privacy.html">Privacy</a> · <a href="./terms.html">Terms</a></p></div></section>`;
}
function refreshInstitutionOptions() {
 const state=$("#profileState")?.value||"";
 const type=$("#profileInstitutionType")?.value||"";
 const query=String($("#profileInstitutionSearch")?.value||"").trim().toLocaleLowerCase();
 const select=$("#profileInstitution"); if(!select)return;
 const rows=[...(institutionsData.institutions||[])].filter(i=>(!state||i.state===state)&&(!["Federal","State","Private"].includes(type)||i.ownership===type)&&(!query||`${i.name} ${i.state} ${i.ownership}`.toLocaleLowerCase().includes(query))).sort((a,b)=>a.name.localeCompare(b.name));
 const selected=profile.institutionId||"";
 let html='<option value="">Choose an institution (optional)</option>';
 for(const institution of rows.slice(0,200))html+=`<option value="${esc(institution.id)}" ${selected===institution.id?'selected':''}>${esc(institution.name)} — ${esc(institution.ownership)}</option>`;
 if(rows.length>200)html+=`<option disabled>${rows.length-200} more results — refine the search above</option>`;
 if(type==='other-tertiary')for(const choice of institutionsData.additionalChoices||[])html+=`<option value="${esc(choice.id)}" ${selected===choice.id?'selected':''}>${esc(choice.name)}</option>`;
 html+=`<option value="other-university" ${selected==='other-university'?'selected':''}>Other / not listed — enter name manually</option>`;
 if(type==='undecided')html='<option value="undecided-institution" selected>Not chosen yet</option>'+html;
 select.innerHTML=html;
}
function refreshCourseOptions(){
 const select=$("#profileCourse");if(!select)return;
 const query=String($("#profileCourseSearch")?.value||"").trim().toLocaleLowerCase();
 const rows=[...(coursesData.courses||[])].filter(c=>!query||`${c.name} ${c.field||''}`.toLocaleLowerCase().includes(query)).sort((a,b)=>a.name.localeCompare(b.name));
 const selected=profile.courseId||"";
 let html='<option value="">Choose a course or programme (optional)</option>';
 for(const c of rows.slice(0,150))html+=`<option value="${esc(c.id)}" ${selected===c.id?'selected':''}>${esc(c.name)}</option>`;
 if(rows.length>150)html+=`<option disabled>${rows.length-150} more programmes — refine your search</option>`;
 html+=`<option value="other-course" ${selected==='other-course'?'selected':''}>Other / not listed — enter programme manually</option>`;
 select.innerHTML=html;
}

function sizeType(type) { return ["Other", "other-tertiary", "undecided"].includes(type); }

function courseGuideView() {
 const inst=(institutionsData.institutions||[]).length;
 const count=(coursesData.courses||[]).length;
 const fieldOptions=[...new Set((coursesData.courses||[]).map(c=>c.field).filter(Boolean))].sort((a,b)=>a.localeCompare(b)).map(f=>`<option value="${esc(f)}">${esc(f.replace(/-/g," ").replace(/\b\w/g,m=>m.toUpperCase()))}</option>`).join("");
 return `<section class="page-intro catalog-page-intro"><p class="eyebrow">PLAN YOUR NEXT STEP</p><h1>Course &amp; institution explorer</h1><p class="muted lead">Search the institution directory and explore programmes without scrolling through a giant list. Search is instant; results are alphabetical.</p></section>
 <div class="catalog-overview-metrics"><article><span class="catalog-metric-icon violet">⌕</span><div><strong>${inst.toLocaleString()}</strong><small>Institutions in directory</small></div></article><article><span class="catalog-metric-icon teal">▤</span><div><strong>${count.toLocaleString()}</strong><small>Course names to explore</small></div></article><article><span class="catalog-metric-icon coral">↗</span><div><strong>Alphabetical</strong><small>Sorted for fast discovery</small></div></article></div>
 <div class="catalog-workspace">
  <div class="catalog-tabs" role="tablist" aria-label="Explore admission options"><button type="button" role="tab" data-action="catalog-tab" data-catalog="institutions" class="${activeCatalogTab==='institutions'?'active':''}" aria-selected="${activeCatalogTab==='institutions'}">Institutions <span>${inst}</span></button><button type="button" role="tab" data-action="catalog-tab" data-catalog="courses" class="${activeCatalogTab==='courses'?'active':''}" aria-selected="${activeCatalogTab==='courses'}">Courses &amp; programmes <span>${count}</span></button></div>
  <section id="catalogInstitutions" class="catalog-results-pane ${activeCatalogTab==='institutions'?'':'hidden'}" role="tabpanel">
   <header class="catalog-pane-heading"><div><p class="eyebrow">INSTITUTION DIRECTORY</p><h2>Find your university or college</h2><p class="muted small">Search by name, state or ownership, then narrow results with the filters.</p></div><button class="button button-outline" data-action="open-profile">Save to study plan ↗</button></header>
   <div class="catalog-filter-bar"><label class="search-field"><span aria-hidden="true">⌕</span><input id="universitySearch" class="field" type="search" placeholder="Search institution, city, state…" autocomplete="off"></label><select id="universityStateFilter" class="field" aria-label="Filter by state"><option value="">All states and FCT</option>${[...(institutionsData.states||[])].sort((a,b)=>a.localeCompare(b)).map(st=>`<option value="${esc(st)}">${esc(st)}</option>`).join('')}</select><select id="universityTypeFilter" class="field" aria-label="Filter ownership"><option value="">All ownership</option><option>Federal</option><option>State</option><option>Private</option></select><select id="universitySort" class="field" aria-label="Sort institutions"><option value="az">Name: A to Z</option><option value="za">Name: Z to A</option></select></div>
   <div id="universityResults" class="catalog-result-list">${renderUniversityResults('', '', '', 'az')}</div>
  </section>
  <section id="catalogCourses" class="catalog-results-pane ${activeCatalogTab==='courses'?'':'hidden'}" role="tabpanel">
   <header class="catalog-pane-heading"><div><p class="eyebrow">PROGRAMME CATALOGUE</p><h2>Find a course by name or field</h2><p class="muted small">These are search suggestions, not proof a specific institution offers a course. Verify the exact year and institution requirements before applying.</p></div></header>
   <div class="catalog-filter-bar"><label class="search-field"><span aria-hidden="true">⌕</span><input id="courseSearch" class="field" type="search" placeholder="Search medicine, engineering, law…" autocomplete="off"></label><select id="courseFieldFilter" class="field" aria-label="Filter course field"><option value="">All fields</option>${fieldOptions}</select><select id="courseSort" class="field" aria-label="Sort courses"><option value="az">Name: A to Z</option><option value="za">Name: Z to A</option></select></div>
   <div id="courseResults" class="catalog-result-list">${renderCourseResults('', '', 'az')}</div>
  </section>
 </div>
 <p class="catalog-data-note"><strong>Admission safety:</strong> course availability, study mode, subject combinations and cut-off marks vary by institution and admission year. This discovery catalogue does not invent full-time/part-time status or eligibility. Confirm decisions using the current official JAMB IBASS and institution admissions pages.</p>`;
}
function renderUniversityResults(query='', state='', owner='', sort='az') {
 const norm=String(query||'').trim().toLocaleLowerCase();
 let all=(institutionsData.institutions||[]).filter(i=>(!norm||`${i.name} ${i.state} ${i.ownership}`.toLocaleLowerCase().includes(norm))&&(!state||i.state===state)&&(!owner||i.ownership===owner));
 all.sort((a,b)=>sort==='za'?b.name.localeCompare(a.name):a.name.localeCompare(b.name));
 const total=all.length,rows=all.slice(0,institutionResultLimit);
 if(!rows.length)return `<div class="catalog-empty"><span>⌕</span><strong>No institution matches those filters</strong><p>Try a shorter name, choose another state, or clear the ownership filter.</p><button class="button button-outline" data-action="clear-institution-filters">Clear filters</button></div>`;
 return `<div class="catalog-results-meta"><span><strong>${total.toLocaleString()}</strong> matches</span><span>Showing ${rows.length.toLocaleString()} of ${total.toLocaleString()}</span></div>${rows.map(i=>`<article class="catalog-result-row"><span class="institution-monogram ${i.ownership==='Federal'?'federal':i.ownership==='State'?'state':'private'}">${i.ownership==='Federal'?'F':i.ownership==='State'?'S':'P'}</span><div class="catalog-result-copy"><strong>${esc(i.name)}</strong><small>${esc(i.state)} · ${esc(i.ownership)} ownership</small></div><span class="catalog-result-tag">${esc(i.institutionType||'University')}</span><button class="button button-outline catalog-choose-button" data-action="choose-institution" data-institution-id="${esc(i.id)}">Use this ↗</button></article>`).join('')}${total>rows.length?`<div class="catalog-more-row"><button class="button button-outline" data-action="more-institutions">Show ${Math.min(24,total-rows.length)} more institutions (${rows.length} of ${total})</button></div>`:`<p class="catalog-end-note">All ${total} matching institutions are shown.</p>`}`;
}
function renderCourseResults(query='', field='', sort='az') {
 const norm=String(query||'').trim().toLocaleLowerCase();
 let all=(coursesData.courses||[]).filter(c=>(!norm||`${c.name} ${c.field||''}`.toLocaleLowerCase().includes(norm))&&(!field||c.field===field));
 all.sort((a,b)=>sort==='za'?b.name.localeCompare(a.name):a.name.localeCompare(b.name));
 const total=all.length,rows=all.slice(0,courseResultLimit);
 if(!rows.length)return `<div class="catalog-empty"><span>⌕</span><strong>No course matches your search</strong><p>Try a different keyword or choose another field.</p><button class="button button-outline" data-action="clear-course-filters">Clear filters</button></div>`;
 return `<div class="catalog-results-meta"><span><strong>${total.toLocaleString()}</strong> matches</span><span>Showing ${rows.length.toLocaleString()} of ${total.toLocaleString()}</span></div>${rows.map(c=>`<article class="catalog-result-row course-result-row"><span class="course-monogram">${esc(c.name.split(/\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase())}</span><div class="catalog-result-copy"><strong>${esc(c.name)}</strong><small>${esc((c.field||'General').replace(/-/g,' ').replace(/\b\w/g,m=>m.toUpperCase()))} · Programme discovery</small></div><span class="catalog-result-tag advisory-tag">Verify requirements</span><button class="button button-outline catalog-choose-button" data-action="choose-course" data-course-id="${esc(c.id)}">Use this ↗</button></article>`).join('')}${total>rows.length?`<div class="catalog-more-row"><button class="button button-outline" data-action="more-courses">Show ${Math.min(24,total-rows.length)} more courses (${rows.length} of ${total})</button></div>`:`<p class="catalog-end-note">All ${total} matching courses are shown.</p>`}`;
}

function syllabusView() {
 return `<section class="page-intro"><p class="eyebrow">STUDY WITH A PLAN</p><h1>Syllabus planner</h1><p class="muted lead">Use the official JAMB syllabus to choose topics, then practise from Ready2Go's available question packs. We won't pretend an unverified topic checklist is the official syllabus.</p></section><div class="feature-card feature-primary syllabus-hero"><div class="feature-top"><span class="subject-icon">▤</span><span class="pill pill-live">Official source</span></div><h3>JAMB IBASS e-Syllabus</h3><p>Open the current syllabus and confirm the topics for your selected subject before creating a revision plan.</p><span class="button button-light" aria-label="Syllabus guidance">Syllabus guidance</span></div><section class="section-head spaced"><div><p class="eyebrow">AVAILABLE PRACTICE CONTENT</p><h2>Choose a subject to practise</h2></div><button class="text-button" data-page="subjects">Browse subject library →</button></section><div class="subject-grid">${subjects.map(s=>`<article class="subject-card ${packs[s.id]?'is-available':'is-coming'}"><div class="subject-icon">${subjectIcon(s)}</div><div class="subject-info"><h3>${esc(s.name)}</h3><p>${packs[s.id]?`${packs[s.id].length} practice questions`:'More practice content coming soon'}</p></div>${hasPackAvailable(s.id)?`<button class="icon-button" data-action="start-subject" data-subject="${s.id}" aria-label="Practise ${esc(s.name)}">→</button>`:'<span class="pill">Planned</span>'}</article>`).join("")}</div><p class="small-note">Use the current official syllabus to guide your revision plan. Available practice counts are shown on each subject card.</p>`;
}
function questionLibraryView() {
 const list=[...subjects].sort((a,b)=>a.name.localeCompare(b.name)).map(s=>{
  const count=(packs[s.id]||[]).length;
  const topics=[...new Set((packs[s.id]||[]).map(q=>q.topic).filter(Boolean))].length;
  return `<article class="question-library-row question-pack-card" data-question-subject="${esc((s.name+' '+s.id).toLocaleLowerCase())}"><span class="question-pack-icon">${esc(subjectIcon(s))}</span><div class="question-pack-copy"><strong>${esc(s.name)}</strong><small>${count} questions · ${topics} topics</small><span>Choose your questions, filter by topic, then review each explanation.</span></div><button class="button button-outline" data-action="start-subject" data-subject="${esc(s.id)}" ${count?'':'disabled'}>Practise →</button></article>`;
 }).join('');
 const total=Object.values(packs).reduce((n,p)=>n+p.length,0);
 return `<section class="page-intro"><p class="eyebrow">YOUR PRACTICE COLLECTION</p><h1>Question library</h1><p class="muted lead">Find a subject by name, see the available question count, and launch straight into focused practice.</p></section>
 <section class="library-summary-strip"><article><strong>${total.toLocaleString()}</strong><span>Practice questions</span></article><article><strong>${subjects.length}</strong><span>Subject areas</span></article><article><strong>Any time</strong><span>Choose your session size</span></article></section>
 <div class="catalog-filter-bar subject-catalog-filters"><label class="search-field"><span aria-hidden="true">⌕</span><input id="questionLibrarySearch" class="field" type="search" placeholder="Search Mathematics, Chemistry, Literature…" autocomplete="off"></label><span class="catalog-match-count">Search all subjects</span></div>
 <div id="questionLibraryResults" class="question-pack-list">${list}</div><p id="questionLibraryEmpty" class="catalog-empty hidden"><strong>No matching subject</strong><span>Try another spelling or a shorter keyword.</span></p>
 <p class="library-footnote">The question collection is designed for independent practice. Check current syllabus and admission guidance when planning your studies.</p>`;
}
function openAuth() {
  const modal=$("#authModal"); if(!modal)return; modal.classList.remove("hidden"); modal.setAttribute("aria-hidden","false");
  // Only load Firebase's remote modules when the learner opens account features.
  // This avoids a network dependency on the offline practice screens.
  if(!authWatchStarted && navigator.onLine){
    authWatchStarted=true;
    import("./firebase.js").then(({watchAuthState})=>watchAuthState((user, authError)=>{
      if(authError && !$("#authModal").classList.contains("hidden")) $("#authMessage").textContent=modError(authError);
      authUser=user||null;
      if(user?.displayName){profile.displayName=profile.displayName||user.displayName;}
      if(user)page=profile.onboardingCompleted?"home":"profile";else page="profile";
      render();
      if(!$("#authModal").classList.contains("hidden")&&user) openAuth();
    })).catch(err=>{authWatchStarted=false;console.info("Firebase account state is not available right now",err);});
  }
  $("#authForm").reset(); $("#authMessage").textContent=""; $("#authNameField").classList.remove("hidden"); $("#authSubmit").textContent="Create account"; $("#authModeLabel").textContent="Create your account"; $("#authSwitch").textContent="Already have an account? Sign in"; $("#authMode").value="signup";
  const googleButton=$("#googleSignIn"), googleDivider=$("#googleAuthDivider");
  if(googleButton)googleButton.classList.toggle("hidden",Boolean(authUser));
  if(googleDivider)googleDivider.classList.toggle("hidden",Boolean(authUser));
  if(authUser){$("#authModeLabel").textContent="Your account";$("#authNameField").classList.add("hidden");$("#authSubmit").textContent="Sign out";$("#authSwitch").textContent="";$("#authEmail").value=authUser.email||"";$("#authEmail").disabled=true;$("#authPassword").classList.add("hidden");$("#authPassword").required=false;$("#authName").required=false;}
  else {$("#authEmail").disabled=false;$("#authPassword").classList.remove("hidden");$("#authPassword").required=true;$("#authName").required=true;}
  setTimeout(()=>$("#authEmail").focus(),50);
}
function closeAuth() { const modal=$("#authModal"); modal.classList.add("hidden");modal.setAttribute("aria-hidden","true");$("#authEmail").disabled=false;$("#authPassword").classList.remove("hidden");$("#authPassword").required=true;$("#authName").required=true; }
function switchAuthMode() {
 const mode=$("#authMode").value==="signup"?"signin":"signup";$("#authMode").value=mode;$("#authNameField").classList.toggle("hidden",mode==="signin");$("#authName").required=mode==="signup";$("#authSubmit").textContent=mode==="signup"?"Create account":"Sign in";$("#authModeLabel").textContent=mode==="signup"?"Create your account":"Welcome back";$("#authSwitch").textContent=mode==="signup"?"Already have an account? Sign in":"New to Ready2Go? Create an account";$("#authMessage").textContent="";
}
async function submitAuth(e) {
 e.preventDefault();const mode=$("#authMode").value;const name=$("#authName").value.trim();const email=$("#authEmail").value.trim();const password=$("#authPassword").value;const msg=$("#authMessage");const submit=$("#authSubmit");
 if(authUser){try{const {signOutUser}=await import("./firebase.js");await signOutUser();authUser=null;page="profile";closeAuth();render();toast("You have signed out.");}catch(err){msg.textContent=err.message;}return;}
 submit.disabled=true;submit.textContent="Please wait…";msg.textContent="";
 try {
   const mod=await import("./firebase.js"); let user;
   if(mode==="signup") user=await mod.registerWithEmail({name,email,password}); else user=await mod.signInWithEmail({email,password});
   authUser=user; if(user.displayName)profile.displayName=profile.displayName||user.displayName; await writeRecord("profile",profile);page=profile.onboardingCompleted?"home":"profile";closeAuth();await render();toast(mode==="signup"?"Your account was created.":"Welcome back.");
 } catch(err) { msg.textContent=modError(err); } finally { submit.disabled=false;submit.textContent=mode==="signup"?"Create account":"Sign in"; }
}
function modError(err){ if(err?.code){const known={"auth/email-already-in-use":"That email already has an account. Try signing in.","auth/invalid-email":"Enter a valid email address.","auth/weak-password":"Use a stronger password (at least 6 characters).","auth/invalid-credential":"Email or password is incorrect.","auth/unauthorized-domain":"Add this hostname in Firebase Authentication → Settings → Authorized domains.","auth/network-request-failed":"Could not connect. Check your internet connection.","auth/popup-closed-by-user":"Google sign-in was closed before it finished. Try again.","auth/popup-blocked":"Your browser blocked the Google sign-in popup. Allow popups or try again.","auth/cancelled-popup-request":"A Google sign-in request is already open.","auth/operation-not-allowed":"Enable Google as a sign-in provider in Firebase Authentication.","auth/account-exists-with-different-credential":"An account already exists with this email using another sign-in method. Sign in with that method first."};return known[err.code]||err.message;}return err?.message||"Something went wrong. Please try again."; }
async function submitGoogleAuth() {
 const button=$("#googleSignIn"), msg=$("#authMessage");
 if(!button || authUser) return;
 button.disabled=true; msg.textContent="";
 const previous=button.innerHTML; button.innerHTML="<span>Connecting to Google…</span>";
 try {
   const mod=await import("./firebase.js");
   const user=await mod.signInWithGoogle();
   if(!user) return; // Mobile redirect flow navigates away and returns to the app.
   authUser=user;
   if(user.displayName) profile.displayName=profile.displayName||user.displayName;
   await writeRecord("profile",profile);
   page=profile.onboardingCompleted?"home":"profile";
   closeAuth(); await render(); toast("Signed in with Google.");
 } catch(err) { msg.textContent=modError(err); }
 finally { button.disabled=false; button.innerHTML=previous; }
}
async function resetPassword() {
 const email=$("#authEmail").value.trim(); if(!email){$("#authMessage").textContent="Enter your email address first.";return;}
 try{const {sendResetEmail}=await import("./firebase.js");await sendResetEmail(email);$("#authMessage").textContent="If that email is registered, Firebase will send password-reset instructions.";}catch(err){$("#authMessage").textContent=modError(err);}
}
function exportData() {
 Promise.all([readRecord("profile",{}),readRecord("sessions",[]),readRecord("theme","light")]).then(([p,s,t])=>{
  const blob=new Blob([JSON.stringify({exportedAt:new Date().toISOString(),app:"Ready2Go Learning",profile:p,sessions:s,theme:t},null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`ready2go-local-data-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(url);toast("Your local data export has been prepared.");
 });
}
async function handleAction(button) {
 const action=button.dataset.action;
 if(action==="page-back"){
   if(page==="profile"&&!profile.onboardingCompleted&&onboardingStep>0){onboardingStep--;await render();refreshInstitutionOptions();refreshCourseOptions();return;}
   if(page==="practice"&&!practice?.submitted){if(!confirm("Leave this practice session? Your unsaved answers will be lost."))return;clearInterval(timerInterval);page="practice-setup";practice=null;await render();refreshTopics();return;}
   const parent={profile:profile.onboardingCompleted?"home":"welcome","practice-setup":"home",subjects:"home",progress:"home","study-coach":"home","course-guide":"home",syllabus:"subjects","question-library":"subjects",results:"practice-setup",practice:"practice-setup",welcome:"home",home:"welcome"};
   page=parent[page]||"home";closeMobileSidebar();await render();if(page==="practice-setup")refreshTopics();if(page==="profile"){refreshInstitutionOptions();refreshCourseOptions();}return;
 }
 if(action==="catalog-tab"){activeCatalogTab=button.dataset.catalog==="courses"?"courses":"institutions";$$('[data-action="catalog-tab"]').forEach(b=>{const active=b.dataset.catalog===activeCatalogTab;b.classList.toggle('active',active);b.setAttribute('aria-selected',String(active));});$("#catalogInstitutions")?.classList.toggle("hidden",activeCatalogTab!=="institutions");$("#catalogCourses")?.classList.toggle("hidden",activeCatalogTab!=="courses");return;}
 if(action==="more-institutions"){institutionResultLimit+=24;const r=$("#universityResults");if(r)r.innerHTML=renderUniversityResults($("#universitySearch")?.value||"",$("#universityStateFilter")?.value||"",$("#universityTypeFilter")?.value||"",$("#universitySort")?.value||"az");return;}
 if(action==="more-courses"){courseResultLimit+=24;const r=$("#courseResults");if(r)r.innerHTML=renderCourseResults($("#courseSearch")?.value||"",$("#courseFieldFilter")?.value||"",$("#courseSort")?.value||"az");return;}
 if(action==="clear-institution-filters"){if($("#universitySearch"))$("#universitySearch").value="";if($("#universityStateFilter"))$("#universityStateFilter").value="";if($("#universityTypeFilter"))$("#universityTypeFilter").value="";institutionResultLimit=24;const r=$("#universityResults");if(r)r.innerHTML=renderUniversityResults();return;}
 if(action==="clear-course-filters"){if($("#courseSearch"))$("#courseSearch").value="";if($("#courseFieldFilter"))$("#courseFieldFilter").value="";if($("#courseSort"))$("#courseSort").value="az";courseResultLimit=24;const r=$("#courseResults");if(r)r.innerHTML=renderCourseResults();return;}
 if(action==="choose-course"){const c=(coursesData.courses||[]).find(x=>x.id===button.dataset.courseId);if(c){profile.courseId=c.id;profile.courseName=c.name;await writeRecord("profile",profile);if(profile.onboardingCompleted){await render();toast("Course saved to your study plan. Confirm exact entry requirements with official guidance.");}else{page="profile";onboardingStep=1;await render();refreshInstitutionOptions();refreshCourseOptions();toast("Course selected. Continue to choose an institution and subjects.");}}return;}
 if(action==="set-duration"){const n=$("#durationMinutes");if(n)n.value=String(Math.max(1,Math.min(120,Number(button.dataset.minutes)||60)));return;}
 if(action==="use-full-mock"){const mixed=$('input[name="mode"][value="combined"]');if(mixed){mixed.checked=true;syncSetupMode();}const ids=[...new Set(["use-of-english",...(profile.selectedSubjects||[]).filter(id=>id!=="use-of-english")])].slice(0,4);$$('input[name="mixSubjects"]').forEach(cb=>{cb.checked=ids.includes(cb.value);cb.disabled=cb.value==="use-of-english";const card=cb.closest('[data-mix-subject-card]');const active=cb.checked;card?.classList.toggle('selected',active);card?.querySelector('.mix-subject-check')?.classList.toggle('selected',active);card?.querySelector('.mix-subject-controls')?.classList.toggle('hidden',!active);card?.querySelectorAll('select').forEach(sel=>sel.disabled=!active);if(active){const count=card.querySelector('select[name^="subjectCount__"]');if(count)count.value=cb.value==='use-of-english'?'60':'40';const topic=card.querySelector('select[name^="subjectTopic__"]');if(topic)topic.value='all';}});updateMixCount();const duration=$("#durationMinutes");if(duration)duration.value="120";const timed=$('input[name="timed"]');if(timed)timed.checked=true;const mixedDifficulty=$('input[name="difficulty"][value="all"]');if(mixedDifficulty)mixedDifficulty.checked=true;toast("Full-length practice preset selected. Check available counts, then begin when ready.");return;}
 if(action==="dismiss-install-inline"){safeSessionSet("r2gInstallBannerDismissed_v4","1");button.closest('.r2g-install-inline')?.remove();return;}
 if(action==="start-math"){page="practice-setup";practice={subjectId:"mathematics"};await render();if($("#subjectSelect"))$("#subjectSelect").value="mathematics";refreshTopics();}
 else if(action==="start-english"){page="practice-setup";practice={subjectId:"use-of-english"};await render();if($("#subjectSelect"))$("#subjectSelect").value="use-of-english";refreshTopics();}
 else if(action==="start-subject"){const id=button.dataset.subject;await loadPackIfNeeded(id);if(packs[id]?.length){page="practice-setup";practice={subjectId:id};await render();if($("#subjectSelect"))$("#subjectSelect").value=id;refreshTopics();const single=$('input[name="mode"][value="single"]');if(single){single.checked=true;syncSetupMode();}}else toast("This subject has no questions in the current build.");}
 else if(action==="start-mixed-practice"){page="practice-setup";practice={subjectIds:(profile.selectedSubjects||[]).slice(0,4),mode:"combined"};await render();const mixed=$('input[name="mode"][value="combined"]');if(mixed)mixed.checked=true;syncSetupMode();}
 else if(action==="open-profile"){page="profile";onboardingStep=profile.onboardingCompleted?2:0;closeMobileSidebar();await render();refreshInstitutionOptions();}
 else if(action==="start-onboarding"){page="profile";onboardingStep=0;closeMobileSidebar();await render();refreshInstitutionOptions();}
 else if(action==="study-tip"){const tips=["Set a 12-minute timer and focus on one topic. Your phone can wait—JAMB cannot.","Mark a tough question and return later. Do not let one question become your landlord.","After every wrong answer, explain the right one in your own words. Reading the solution is step one; explaining it is step two.","Try five English questions daily. Small daily reps beat emergency grammar marathons."];const n=Number(button.dataset.tipIndex);toast(Number.isInteger(n)&&n>=0&&n<4?tips[n]:tips[Math.floor(Math.random()*tips.length)]);}
 else if(action==="onboarding-next")await saveOnboardingStep();
 else if(action==="onboarding-back"){onboardingStep=Math.max(0,onboardingStep-1);await render();refreshInstitutionOptions();}
 else if(action==="dismiss-install-nudge"){const n=$("#installNudge");if(n?._autoDismissTimer)clearTimeout(n._autoDismissTimer);safeSessionSet("r2gInstallBannerDismissed_v4","1");n?.classList.remove("visible");window.setTimeout(()=>n?.remove(),220);}
 else if(action==="install-help-close"){$("#installHelpModal")?.remove();}
 else if(action==="skip-welcome"){page="home";await render();}
 else if(action==="choose-institution"){const id=button.dataset.institutionId;const inst=(institutionsData.institutions||[]).find(x=>x.id===id);if(inst){profile.state=inst.state;profile.institutionType=inst.ownership;profile.institutionId=inst.id;profile.institutionName=inst.name;await writeRecord("profile",profile);if(profile.onboardingCompleted){await render();toast("Institution saved to your study plan. Verify current programme requirements before applying.");}else{page="profile";onboardingStep=1;await render();refreshInstitutionOptions();refreshCourseOptions();toast("Institution selected. Continue to choose a programme and subjects.");}}}
 else if(action==="open-auth")openAuth();
 
  else if(action==="install-nudge-go"){if(deferredInstallPrompt)await installApp();else showInstallInstructions();}
 else if(action==="install-app")await installApp();
 else if(action==="install-help")showInstallInstructions();
 else if(action==="use-recommendations"){const f=$("#profileForm");if(!f)return;const selected=f.querySelector('input[name="category"]:checked')?.value||profile.category;if(!selected){toast("Choose a study area first.");return;}const ids=new Set(["use-of-english",...(RECOMMENDED[selected]||[])]);$$('input[name="selectedSubjects"]',f).forEach(cb=>cb.checked=ids.has(cb.value));}
 else if(action==="prev-question"){practice.index=Math.max(0,practice.index-1);await render();}
 else if(action==="next-question"){practice.index=Math.min(practice.questions.length-1,practice.index+1);await render();}
 else if(action==="go-question"){practice.index=Number(button.dataset.index);await render();}
 else if(action==="switch-subject"){const id=button.dataset.subject;const idx=practice.questions.findIndex(q=>q.subjectId===id);if(idx>=0){practice.index=idx;await render();}}
 else if(action==="flag-question"){const id=practice.questions[practice.index].id;practice.flagged=practice.flagged.includes(id)?practice.flagged.filter(v=>v!==id):[...practice.flagged,id];await render();}
 else if(action==="confirm-end")confirmFinish();
 else if(action==="review-answers"){const r=$("#answerReview");r?.classList.remove("hidden");r?.scrollIntoView({behavior:"smooth",block:"start"});}
 else if(action==="retry"){const prior={subjectId:practice.subjectId,subjectIds:[...(practice.subjectIds||[])],mode:practice.mode};page="practice-setup";practice=prior.mode==="combined"?{subjectIds:prior.subjectIds,mode:"combined"}:{subjectId:prior.subjectId};await render();if(prior.mode==="combined"){const mixed=$('input[name="mode"][value="combined"]');if(mixed)mixed.checked=true;syncSetupMode();}else if($("#subjectSelect")){ $("#subjectSelect").value=prior.subjectId;refreshTopics();}}
 else if(action==="export-data")exportData();
 else if(action==="clear-history"){if(confirm("Delete the saved practice history from this browser? This cannot be undone.")){await deleteRecord("sessions");await render();toast("Local practice history cleared.");}}
}

function safeSessionGet(key) { try { return sessionStorage.getItem(key); } catch { return null; } }
function safeSessionSet(key,value) { try { sessionStorage.setItem(key,value); } catch {} }
function isStandalone() {
 return window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
}
function isIosSafari() {
 return /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios|edgios/i.test(navigator.userAgent);
}
function installBannerView() {
 if(isStandalone()||safeSessionGet("r2gInstallBannerDismissed_v4")==="1")return "";
 return `<section class="install-banner r2g-install-inline"><div class="install-symbol polygon">⇩</div><div class="install-copy"><strong>Take Ready2Go with you</strong><span>Add the study app to this device. Open it online once and wait for the offline-ready message before disconnecting.</span></div><button class="button button-primary" data-action="install-app">Install app ↗</button><button class="install-inline-dismiss" type="button" data-action="dismiss-install-inline" aria-label="Dismiss install reminder">×</button></section>`;
}

async function installApp() {
 if (!deferredInstallPrompt) { showInstallInstructions(); return; }
 const promptEvent = deferredInstallPrompt;
 try {
  promptEvent.prompt();
  const choice=await promptEvent.userChoice;
  if (choice?.outcome === "accepted") toast("Installation confirmed. The browser will finish adding Ready2Go.");
  else toast("Installation was not completed. You can install Ready2Go from your browser menu later.");
 } catch { toast("Open your browser's install option to add Ready2Go."); }
 deferredInstallPrompt=null;
 const n=$("#installNudge");if(n?._autoDismissTimer)clearTimeout(n._autoDismissTimer);safeSessionSet("r2gInstallBannerDismissed_v4","1");n?.classList.remove("visible");window.setTimeout(()=>n?.remove(),220);
}
function showInstallInstructions() {
 const prior=$("#installHelpModal"); if(prior){prior.remove();return;}
 const isIOS=isIosSafari();
 const isAndroid=/android/i.test(navigator.userAgent);
 const title=isIOS?"Add Ready2Go to your iPhone or iPad":isAndroid?"Install Ready2Go on Android":"Install Ready2Go on your computer";
 const steps=isIOS?[
   "Open this page in Safari (not an in-app browser).",
   "Tap the Share button.",
   "Choose Add to Home Screen, then tap Add."
 ]:isAndroid?[
   "Open this page in Chrome or a supported browser.",
   "Tap the browser menu (⋮).",
   "Choose Install app or Add to Home screen, then confirm."
 ]:[
   "Open this page in Chrome or Microsoft Edge.",
   "Choose the Install icon in the address bar, or open the browser menu.",
   "Choose Install Ready2Go Learning and confirm."
 ];
 const modal=document.createElement("div"); modal.id="installHelpModal"; modal.className="install-help-overlay"; modal.innerHTML=`<section class="install-help-card" role="dialog" aria-modal="true" aria-labelledby="installHelpTitle"><button class="install-nudge-close" data-action="install-help-close" aria-label="Close installation steps">×</button><div class="install-help-logo"><img src="./assets/r2g-app-icon-512.png" alt="Ready2Go app icon"></div><p class="eyebrow">ONE-TAP STUDY SPACE</p><h2 id="installHelpTitle">${title}</h2><p class="muted">The device/browser has to approve installation. Ready2Go cannot silently install itself.</p><ol>${steps.map(s=>`<li>${esc(s)}</li>`).join("")}</ol><div class="install-help-benefits"><span>✓ Full-screen app layout</span><span>✓ Offline practice after first online setup</span><span>✓ Home-screen shortcut</span></div><button class="button button-primary button-wide" data-action="install-help-close">Got it</button></section>`; document.body.append(modal);
}
async function checkOfflineCache(){
 if(!("caches" in window)) return false;
 try {
  const cache=await caches.open("ready2go-shell-v2.1.0");
  const marker=new URL("./__ready2go_cache_complete__.json",location.href).href;
  return Boolean(await cache.match(marker));
 } catch { return false; }
}
function connectionStatusText(){
 if(!navigator.onLine) return offlineCacheReady?"Offline · content ready":"Offline · cache incomplete";
 return offlineCacheReady?"Online · offline ready":"Online · saving for offline";
}
function updateConnectivityChip(){
 const online=Boolean(navigator.onLine), label=connectionStatusText();
 const node=$("#connectivityChip");if(node){node.classList.toggle("is-offline",!online);const text=node.querySelector("span");if(text)text.textContent=label;}
 const pill=$("#dashboardOfflinePill");if(pill){pill.classList.toggle("is-offline",!online);pill.innerHTML=`<i></i>${esc(label)}`;}
 const state=$(".pro-dashboard-head .system-state");if(state){state.classList.toggle("state-online",online);state.classList.toggle("state-offline",!online);state.innerHTML=`<i></i>${esc(label)}`;}
}
async function saveOnboardingStep() {
 const form=$("#profileForm"); if(!form)return;
 const fd=new FormData(form);
 if(onboardingStep===0){
   const category=String(fd.get("category")||"");
   if(!category){toast("Choose the study area that fits you best before continuing.");return;}
   const changed=profile.category!==category;
   profile={...profile,displayName:String(fd.get("displayName")||"").trim(),category,isPreparingForJamb:String(fd.get("isPreparingForJamb")||"yes"),admissionYear:String(fd.get("admissionYear")||"2026")};
   if(changed||!Array.isArray(profile.selectedSubjects)||profile.selectedSubjects.length<2)profile.selectedSubjects=["use-of-english",...(RECOMMENDED[category]||[]).slice(0,3)];
   await writeRecord("profile",profile);onboardingStep=1;await render();refreshInstitutionOptions();return;
 }
 if(onboardingStep===1){
   const institutionId=String(fd.get("institutionId")||"");const inst=(institutionsData.institutions||[]).find(i=>i.id===institutionId);
   const courseId=String(fd.get("courseId")||"");const course=(coursesData.courses||[]).find(c=>c.id===courseId);
   profile={...profile,state:String(fd.get("state")||""),institutionType:String(fd.get("institutionType")||""),institutionId,institutionName:String(fd.get("institutionName")||"").trim()||inst?.name||"",courseId,courseName:String(fd.get("courseName")||"").trim()||course?.name||""};
   await writeRecord("profile",profile);onboardingStep=2;await render();refreshInstitutionOptions();refreshCourseOptions();return;
 }
}
function syncSetupMode(){
 const mode=$("input[name='mode']:checked")?.value||"single";
 $("#singleSubjectGroup")?.classList.toggle("hidden",mode==="combined");
 $("#mixedSubjectsGroup")?.classList.toggle("hidden",mode!=="combined");
 const singleAccordion=$("#singleSubjectAccordion"), mixedAccordion=$("#mixedSubjectAccordion");
 singleAccordion?.classList.toggle("hidden",mode==="combined");
 mixedAccordion?.classList.toggle("hidden",mode!=="combined");
 if(mode==="single"&&singleAccordion)singleAccordion.open=true;
 if(mode==="combined"&&mixedAccordion)mixedAccordion.open=true;
 $$(".setup-mode-card").forEach(card=>card.classList.toggle("selected",card.querySelector("input")?.checked));
 updateMixCount();
}
function updateMixCount(){const n=$$("input[name=\'mixSubjects\']:checked").length;const el=$("#mixCount");if(el)el.textContent=`${Math.min(4,n)}/4 selected`;}
function showTimedInstallNudge(){
 if(isStandalone()||safeSessionGet("r2gInstallDismissed")==="1"||$("#installNudge"))return;
 const n=document.createElement("div");n.id="installNudge";n.className="install-nudge";n.setAttribute("role","dialog");n.setAttribute("aria-modal","true");n.setAttribute("aria-label","Install Ready2Go Learning");
 n.innerHTML=`<section class="install-nudge-card"><button class="install-nudge-close" data-action="dismiss-install-nudge" aria-label="Continue in browser">×</button><div class="install-nudge-visual"><img src="./assets/r2g-app-icon-512.png" alt="Ready2Go app icon"><div class="install-nudge-spark spark-one">✦</div><div class="install-nudge-spark spark-two">✎</div></div><div class="install-nudge-copy"><span class="install-nudge-kicker">READY2GO · YOUR PERSONAL STUDY SPACE</span><h2>Make your study space an app.</h2><p>Add Ready2Go to your home screen for a focused, full-screen study app. Open it once while online so the app and included question packs can finish saving for offline practice.</p><div class="install-benefit-grid"><span><b>✓</b> CBT practice</span><span><b>✓</b> Study anywhere</span><span><b>✓</b> Local progress</span><span><b>✓</b> Light &amp; dark themes</span></div><div class="install-nudge-actions"><button class="button button-primary install-main-cta" data-action="install-nudge-go">${deferredInstallPrompt?'Install Ready2Go':'Show install steps'} <span>→</span></button><button class="button button-outline" data-action="dismiss-install-nudge">Continue in browser</button></div><p class="small-note">Installation requires your confirmation in the browser. Ready2Go does not force-install an app.</p></div></section>`;
 document.body.append(n);requestAnimationFrame(()=>n.classList.add("visible"));
 // Keep the invitation open until the learner chooses install or continue in the browser.
 
}
function closeMobileSidebar() {
 const sidebar=$("#sidebar"), scrim=$("#sidebarScrim");
 sidebar?.classList.remove("mobile-open");
 scrim?.classList.remove("active");
 $("#mobileMenu")?.setAttribute("aria-expanded","false");
}

document.addEventListener("click",async e=>{
 const nav=e.target.closest("[data-page]"); if(nav){if(nav.tagName==="A")e.preventDefault();const next=nav.dataset.page; if(!profile.onboardingCompleted && !["profile","welcome"].includes(next)){page="profile";await render();toast("Finish your study plan to open the learning dashboard.");return;}if(next==="practice-setup"&&page==="practice"&&!practice?.submitted){if(!confirm("Leave this practice session? Unsaved answers will be lost."))return;clearInterval(timerInterval);}page=next;if(page==="practice-setup")practice=null;closeMobileSidebar();await render();if(page==="practice-setup")refreshTopics();if(page==="profile")refreshInstitutionOptions();return;}
 const button=e.target.closest("[data-action]");if(button){await handleAction(button);return;}
 if(e.target.closest("#themeToggle")){const next=document.documentElement.dataset.theme==="dark"?"light":"dark";setTheme(next);await writeRecord("theme",next);}
});
document.addEventListener("input",e=>{
 if(e.target.matches("#subjectLibrarySearch, #subjectCategoryFilter"))filterSubjectCards();
 if(e.target.matches("#questionLibrarySearch")){const q=e.target.value.trim().toLocaleLowerCase();const rows=$$(".question-library-row");let shown=0;rows.forEach(row=>{const keep=row.dataset.questionSubject.includes(q);row.classList.toggle("hidden",!keep);if(keep)shown++;});const empty=$("#questionLibraryEmpty");if(empty)empty.classList.toggle("hidden",shown!==0);const counter=$("#questionLibraryResults");if(counter)counter.dataset.matchCount=String(shown);}
 if(e.target.matches("#singleSubjectSearch")){
   const input=e.target;const select=$("#subjectSelect");if(select){const prior=select.value;const q=input.value.trim().toLocaleLowerCase();const found=[...availableSubjects()].filter(s=>!q||s.name.toLocaleLowerCase().includes(q)).sort((a,b)=>a.name.localeCompare(b.name));select.innerHTML=found.map(s=>`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("");if(found.some(s=>s.id===prior))select.value=prior;else if(found.length)select.value=found[0].id;refreshTopics();refreshSingleCountChoices();if(!found.length)toast("No subject matched. Try a shorter search.");}
 }
 if(e.target.matches("#mixSubjectSearch")){
  const q=e.target.value.trim().toLocaleLowerCase();$$('[data-mix-subject-card]').forEach(card=>{card.classList.toggle('search-hidden',!card.dataset.subjectName.includes(q));});
 }
 if(e.target.matches("#profileInstitutionSearch"))refreshInstitutionOptions();
 if(e.target.matches("#profileCourseSearch"))refreshCourseOptions();
 if(e.target.matches("#universitySearch")){institutionResultLimit=24;const results=$("#universityResults");if(results)results.innerHTML=renderUniversityResults(e.target.value,$("#universityStateFilter")?.value||"",$("#universityTypeFilter")?.value||"",$("#universitySort")?.value||"az");}
 if(e.target.matches("#courseSearch")){courseResultLimit=24;const results=$("#courseResults");if(results)results.innerHTML=renderCourseResults(e.target.value,$("#courseFieldFilter")?.value||"",$("#courseSort")?.value||"az");}
});
function filterSubjectCards(){
 const query=String($("#subjectLibrarySearch")?.value||"").trim().toLocaleLowerCase();const category=$("#subjectCategoryFilter")?.value||"";let shown=0;
 $$('.searchable-subject-card').forEach(card=>{const keep=(!query||card.dataset.subjectName.includes(query))&&(!category||card.dataset.subjectCategory===category);card.classList.toggle('hidden',!keep);if(keep)shown++;});
 $$('.subject-group').forEach(group=>{const visible=[...group.querySelectorAll('.searchable-subject-card')].some(card=>!card.classList.contains('hidden'));group.classList.toggle('hidden',!visible);});
 const count=$("#subjectFilterCount");if(count)count.textContent=`${shown} subject${shown===1?'':'s'}`;
}
document.addEventListener("change",async e=>{
 if(e.target.matches('input[name="answer"]')){practice.answers[practice.questions[practice.index].id]=e.target.value;await render();}
 if(e.target.matches("#subjectSelect")){refreshTopics();refreshSingleCountChoices();}
 if(e.target.matches("#countSelect")){const custom=$("#customCount");if(custom){custom.classList.toggle("hidden",e.target.value!=="custom");if(e.target.value!=="custom")custom.value="";}refreshSingleCountChoices();}
 if(e.target.matches("#customCount")){const c=$("#countSelect");if(c&&c.value!=="custom")c.value="custom";refreshSingleCountChoices();}
 if(e.target.matches('input[name^="subjectCustomCount__"]')){const card=e.target.closest('[data-mix-subject-card]');const select=card?.querySelector('select[name^="subjectCount__"]');if(select&&select.value!=="custom")select.value="custom";}
 if(e.target.matches("#profileState, #profileInstitutionType, #profileInstitutionSearch"))refreshInstitutionOptions();
 if(e.target.matches("#profileCourseSearch"))refreshCourseOptions();
 if(e.target.matches('#universitySearch, #universityStateFilter, #universityTypeFilter, #universitySort')){institutionResultLimit=24;const q=$("#universitySearch")?.value||"";const st=$("#universityStateFilter")?.value||"";const ow=$("#universityTypeFilter")?.value||"";const sort=$("#universitySort")?.value||"az";const results=$("#universityResults");if(results)results.innerHTML=renderUniversityResults(q,st,ow,sort);}
 if(e.target.matches('#courseSearch, #courseFieldFilter, #courseSort')){courseResultLimit=24;const q=$("#courseSearch")?.value||"";const f=$("#courseFieldFilter")?.value||"";const sort=$("#courseSort")?.value||"az";const results=$("#courseResults");if(results)results.innerHTML=renderCourseResults(q,f,sort);}
 if(e.target.matches('#subjectCategoryFilter, #subjectLibrarySearch'))filterSubjectCards();
 if(e.target.matches('input[name="mode"]'))syncSetupMode();
 if(e.target.matches('input[name="mixSubjects"]')){if(e.target.value==="use-of-english"&&!e.target.checked){e.target.checked=true;toast("Use of English stays in the full four-subject set.");}const chosen=$$('input[name="mixSubjects"]:checked').length;if(chosen>4){e.target.checked=false;toast("Choose no more than four subjects.");}updateMixCount();const card=e.target.closest('[data-mix-subject-card]');if(card){const checked=e.target.checked;card.classList.toggle('selected',checked);card.querySelector('.mix-subject-check')?.classList.toggle('selected',checked);card.querySelector('.mix-subject-controls')?.classList.toggle('hidden',!checked);card.querySelectorAll('select').forEach(sel=>sel.disabled=!checked);} }
 if(e.target.matches('select[name^="subjectCount__"]')){
   const card=e.target.closest('[data-mix-subject-card]');const custom=card?.querySelector('input[name^="subjectCustomCount__"]');
   if(custom){custom.classList.toggle('hidden',e.target.value!=="custom");if(e.target.value!=="custom")custom.value="";}
   e.target.classList.add('is-customized');
 }
 if(e.target.matches('select[name^="subjectTopic__"]'))e.target.classList.add('is-customized');
 if(e.target.matches('input[name="selectedSubjects"]')){const chosen=$$('input[name="selectedSubjects"]:checked').length;if(chosen>3){e.target.checked=false;toast("Choose up to three additional subjects. Use of English is included automatically.");}$$(".onboarding-subject-grid .subject-check").forEach(n=>n.classList.toggle("selected",n.querySelector("input").checked));}
 if(e.target.matches('input[name="category"]')){
   $$(".category-card").forEach(n=>n.classList.toggle("selected",n.querySelector("input").checked));
   // Automatically apply a sensible recommendation when the category changes; students can then edit every checkbox.
   const ids=new Set((RECOMMENDED[e.target.value]||[]).slice(0,3));
   const form=$("#profileForm"); if(form) $$('input[name="selectedSubjects"]',form).forEach(cb=>cb.checked=ids.has(cb.value));
 }
});
document.addEventListener("submit",async e=>{

 if(e.target.id==="setupForm"){e.preventDefault();await startPractice(e.target);}
 if(e.target.id==="profileForm"){
   e.preventDefault();const fd=new FormData(e.target);const checked=fd.getAll("selectedSubjects").map(String).slice(0,3);if(checked.length!==3){toast("Choose exactly three additional subjects. Use of English is included automatically, making four subjects.");return;}
   const institutionId=String(profile.institutionId||"");
   const institution=(institutionsData.institutions||[]).find(i=>i.id===institutionId);
   const courseId=String(profile.courseId||"");
   const course=(coursesData.courses||[]).find(c=>c.id===courseId);
   profile={...profile,selectedSubjects:["use-of-english",...checked],institutionName:profile.institutionName||institution?.name||"",courseName:profile.courseName||course?.name||"",admissionYear:String(profile.admissionYear||"2026"),onboardingCompleted:true};
   await writeRecord("profile",profile);
   let profileCloudSynced=false;
   if(authUser && navigator.onLine){try{const {saveLearnerProfileRemote}=await import("./firebase.js");await saveLearnerProfileRemote({displayName:profile.displayName,category:profile.category,selectedSubjects:profile.selectedSubjects,isPreparingForJamb:profile.isPreparingForJamb,state:profile.state,institutionType:profile.institutionType,institutionId:profile.institutionId,institutionName:profile.institutionName,courseId:profile.courseId,courseName:profile.courseName,admissionYear:profile.admissionYear});profileCloudSynced=true;}catch(err){console.info("Profile remains local until cloud sync succeeds",err);}}
   let accountNameSaved=true;
   if(authUser&&profile.displayName&&profile.displayName!==authUser.displayName){try{const {updateUserDisplayName}=await import("./firebase.js");authUser=await updateUserDisplayName(profile.displayName);}catch(err){accountNameSaved=false;console.warn("Could not update Firebase display name",err);}}
   page="home";await render();toast(!accountNameSaved?"Preferences saved locally; account name could not sync.":(authUser&&!profileCloudSynced?"Study plan saved on this device. Cloud sync may be unavailable.":(profileCloudSynced?"Your study plan is saved and synced.":"Your study plan is saved on this device.")));
 }
 if(e.target.id==="authForm")submitAuth(e);
});
$("#authClose")?.addEventListener("click",closeAuth);
$("#authBackdrop")?.addEventListener("click",closeAuth);
$("#authSwitch")?.addEventListener("click",e=>{e.preventDefault();switchAuthMode();});
$("#resetPassword")?.addEventListener("click",e=>{e.preventDefault();resetPassword();});
$("#googleSignIn")?.addEventListener("click",()=>submitGoogleAuth());
window.addEventListener("online",()=>{updateConnectivityChip();toast("You're back online. Account sync is available when you sign in.");});
window.addEventListener("offline",()=>{updateConnectivityChip();toast(offlineCacheReady?"You're offline. Cached practice content and local history remain available.":"You're offline, but a complete cache has not been confirmed. Reconnect before relying on every question pack.");});
window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  deferredInstallPrompt=event;
  $$("[data-action=\"install-app\"]").forEach(button=>{button.setAttribute("aria-label","Install Ready2Go Learning");button.classList.add("install-prompt-ready");});
  $$(".install-main-cta").forEach(button=>button.innerHTML="Install Ready2Go <span>→</span>");
});
window.addEventListener("appinstalled", () => { deferredInstallPrompt=null; $("#installNudge")?.remove();safeSessionSet("r2gInstallBannerDismissed_v4","1");toast("Ready2Go is installed on this device.");render(); });
$("#mobileMenu")?.addEventListener("click",()=>{const sidebar=$("#sidebar"), scrim=$("#sidebarScrim");const open=!sidebar?.classList.contains("mobile-open");sidebar?.classList.toggle("mobile-open",open);scrim?.classList.toggle("active",open);$("#mobileMenu")?.setAttribute("aria-expanded",String(open));});
$("#sidebarScrim")?.addEventListener("click",closeMobileSidebar);
document.addEventListener("keydown",e=>{if(e.key==="Escape"){closeMobileSidebar();if(!$("#authModal")?.classList.contains("hidden"))closeAuth();}});
boot();
