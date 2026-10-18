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
let coachMessages = [];

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
  if (!isStandalone()) { try { installNudgeTimer = window.setTimeout(showTimedInstallNudge, 180); } catch {} }
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
  const labels={welcome:"Welcome",home:"Learning home",subjects:"My subjects","practice-setup":"Practice session",practice:"CBT practice",results:"Session results",progress:"Progress & analysis",profile:"Study plan & preferences","course-guide":"Course & institution guide",syllabus:"Syllabus planner","question-library":"Question library","study-coach":"Ready2Go Coach"};
  const sectionLabel=$("#currentSection"); if(sectionLabel) sectionLabel.textContent=labels[page]||"Overview";
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
  if (page === "profile") refreshInstitutionOptions();
  if (page === "practice-setup") { refreshTopics(); syncSetupMode(); }
}
function welcomeView() {
 return `<section class="welcome-screen r2g-welcome-screen"><div class="welcome-copy"><span class="welcome-mark"><img src="./assets/r2g-app-icon.svg" alt="Ready2Go R2G icon"></span><p class="eyebrow">A DAVONIUM TECHNOLOGIES PRODUCT</p><h1>Practice today.<br><em>Progress tomorrow.</em></h1><p class="muted lead">A focused UTME study app with CBT practice, clear answer explanations, subject planning and learning history—all in one app-like space.</p><div class="welcome-benefits"><span>✓ Works offline after this app shell and content have been cached</span><span>✓ No account or payment required to begin local practice</span><span>✓ Your study plan and results stay on this device unless you choose account sync</span></div><div class="welcome-cta-row"><button class="button button-primary" data-action="start-onboarding">Set up my study space <span>→</span></button><button class="button button-outline" data-action="open-auth">Sign in / create account</button></div><p class="small-note">Ready2Go is an independent study app. Practice questions are for learning and revision, not official JAMB past-paper reproductions.</p></div><div class="welcome-visual r2g-school-scene" aria-label="Illustrated study desk with books, pencils and learning tools"><div class="school-note note-one"><span>✎</span><strong>One question</strong><small>at a time</small></div><div class="school-note note-two"><span>✓</span><strong>Progress saved</strong><small>on this device</small></div><div class="supply-pencil pencil-a"></div><div class="supply-pencil pencil-b"></div><div class="supply-book book-a"><i></i><b></b></div><div class="supply-book book-b"><i></i><b></b></div><div class="supply-ruler"></div><div class="supply-apple"><i></i><b></b></div><div class="supply-laptop"><div class="laptop-screen"><span>R2G</span><small>READY TO LEARN</small></div><i></i></div><div class="scene-floor"></div><span class="school-sticker sticker-atom">⚛</span><span class="school-sticker sticker-book">▤</span></div></section>`;
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
  const subjectTiles = chosenSubjects.map(s=>`<button class="mini-subject-tile" data-action="start-subject" data-subject="${esc(s.id)}"><span class="mini-subject-icon">${esc(subjectIcon(s))}</span><span><strong>${esc(s.name)}</strong><small>${(packs[s.id]||[]).length} local questions</small></span><b>›</b></button>`).join("");
  const cards = [
    {title:"CBT Practice",sub:"Timed or untimed exam-style sessions",glyph:"▣",tone:"mint",page:"practice-setup"},
    {title:"My Subjects",sub:"Edit subject choices and start by topic",glyph:"▦",tone:"lilac",page:"subjects"},
    {title:"Progress & Analysis",sub:"Scores, accuracy and weak topics",glyph:"↗",tone:"peach",page:"progress"},
    {title:"Ready2Go Coach",sub:"Study hints and question explanations",glyph:"✦",tone:"sky",page:"study-coach"},
    {title:"Question Library",sub:"Browse the local question catalogue",glyph:"▤",tone:"sand",page:"question-library"},
    {title:"Course & Institution Guide",sub:"Explore options; verify entry rules",glyph:"⌖",tone:"mint",page:"course-guide"}
  ];
  return `<section class="r2g-dashboard"><div class="dashboard-head"><div><p class="eyebrow"><span class="live-dot"></span> YOUR READY2GO STUDY SPACE</p><h1>Hello, ${esc(greetingName)} <span class="hello-sparkle">✦</span></h1><p>Learn with focus. Practise with purpose. Keep your next step in view.</p></div><div class="dashboard-head-actions"><span class="offline-pill" id="dashboardOfflinePill"><i></i>${navigator.onLine?'Online · offline-ready':'Offline · local practice ready'}</span><button class="button button-primary" data-page="practice-setup">Start practice <span>→</span></button></div></div>
  <div class="dashboard-metrics"><article class="dash-metric"><span class="dash-metric-icon mint">▣</span><div><strong>${attempts}</strong><small>Questions answered</small></div></article><article class="dash-metric"><span class="dash-metric-icon lilac">◎</span><div><strong>${accuracy}%</strong><small>Practice accuracy</small></div></article><article class="dash-metric"><span class="dash-metric-icon peach">▤</span><div><strong>${totalLocalQuestions.toLocaleString()}</strong><small>Local draft questions</small></div></article><article class="dash-metric"><span class="dash-metric-icon sky">▦</span><div><strong>${chosenSubjects.length}/4</strong><small>Your study subjects</small></div></article></div>
  <div class="dashboard-content"><section class="dashboard-main-panel"><div class="dashboard-section-title"><div><p class="eyebrow">YOUR LEARNING TOOLS</p><h2>Where would you like to begin?</h2></div><span class="compact-tag">APP MODE</span></div><div class="dashboard-launch-grid">${cards.map(c=>`<button class="launch-tile tone-${c.tone}" data-page="${c.page}"><span class="launch-glyph">${c.glyph}</span><span class="launch-copy"><strong>${c.title}</strong><small>${c.sub}</small></span><span class="launch-arrow">↗</span></button>`).join("")}</div>
  <div class="dashboard-section-title selected-subject-heading"><div><p class="eyebrow">YOUR STUDY SET</p><h2>Quick subject access</h2></div><button class="text-button" data-action="open-profile">Edit plan ↗</button></div><div class="mini-subject-list">${subjectTiles||`<button class="mini-subject-tile" data-action="open-profile"><span class="mini-subject-icon">＋</span><span><strong>Choose subjects</strong><small>Complete your short onboarding</small></span><b>›</b></button>`}</div></section>
  <aside class="dashboard-side-panel"><div class="dashboard-illustration-card"><div class="illustration-heading"><span class="illustration-kicker">SMALL STEPS. BIG GOALS.</span><span class="illustration-scribble">✦</span></div><div class="mini-school-scene"><div class="mini-pencil pencil-a"></div><div class="mini-pencil pencil-b"></div><div class="mini-book book-one"></div><div class="mini-book book-two"></div><div class="mini-apple"></div><div class="mini-plant"></div><div class="mini-laptop"><span>R2G</span></div></div><h3>Ready when you are.</h3><p>Every session saves locally. Your practice content stays on this device once it has been cached.</p><div class="offline-readiness"><span class="readiness-check">✓</span><span><strong>Offline practice pack</strong><small>${totalLocalQuestions.toLocaleString()} local draft questions across ${Object.keys(packs).length} subjects</small></span></div></div>
  <div class="recent-mini-card"><div class="recent-mini-top"><span class="eyebrow">LAST SESSION</span><button class="text-button" data-page="progress">History ↗</button></div>${recent?`<div class="recent-mini-result"><span class="recent-mini-mark">✓</span><div><strong>${esc(recent.subjectName)}</strong><small>${fmtDate(recent.completedAt)} · ${recent.total} questions</small></div><b>${recent.score}/${recent.total}</b></div>`:`<div class="recent-mini-empty"><span>▣</span><strong>Your first session is waiting</strong><small>Start with 5 questions and learn from every answer.</small><button class="button button-outline button-wide" data-page="practice-setup">Start a 5-question drill</button></div>`}</div>
  <p class="dashboard-content-note">Content note: original draft questions are included for pilot practice. They are not labelled as official JAMB past questions. Subject experts must verify answer keys before public marketing as validated exam content.</p></aside></div></section>`;
}

function studyCoachView() {
 const examples = ["Explain the last question I missed", "Give me a 20-minute revision plan", "How do I improve my exam timing?", "Help me understand a difficult topic"];
 return `<section class="coach-shell"><div class="coach-header"><div class="coach-emblem">✦</div><div><p class="eyebrow">READY2GO LEARNING SUPPORT</p><h1>Ready2Go Coach</h1><p class="muted">A small, offline-first study helper for revision guidance and question explanations.</p></div><span class="offline-pill"><i></i> Works offline</span></div><div class="coach-truth-note"><strong>What this version can do</strong><p>It can look up your local question explanations and give built-in study guidance without internet. It is not a generative AI chat service in this release; no external AI API is configured.</p></div><div class="coach-chat-card"><div class="coach-chat-history" id="coachHistory">${coachMessages.map(m=>`<div class="coach-message ${m.role==='user'?'coach-user':'coach-assistant'}"><span>${m.role==='user'?'You':'Coach'}</span><p>${esc(m.text).replace(/\n/g,'<br>')}</p></div>`).join('')||`<div class="coach-welcome"><span>✎</span><h2>Let's make your next study session count.</h2><p>Ask about a question, a subject, or your study routine. For question-specific explanations, use the wording or topic from your local pack.</p></div>`}</div><div class="coach-prompts">${examples.map((e,i)=>`<button class="coach-prompt" data-action="coach-fill" data-prompt="${esc(e)}">${esc(e)}</button>`).join('')}</div><form id="coachForm" class="coach-input-row"><label class="visually-hidden" for="coachInput">Ask Ready2Go Coach</label><textarea id="coachInput" name="prompt" rows="2" maxlength="500" placeholder="Ask a study question…" required></textarea><button class="button button-primary" type="submit">Ask <span>↗</span></button></form></div><p class="small-note">Your prompt is processed inside this app and is not sent to an external AI service in this version.</p></section>`;
}

function offlineCoachReply(prompt) {
 const text=String(prompt||'').trim();
 const low=text.toLowerCase();
 const all=Object.entries(packs).flatMap(([sid,qs])=>qs.map(q=>({...q,subjectId:sid,subjectName:subjects.find(s=>s.id===sid)?.name||sid})));
 const tokens=low.split(/[^a-z0-9]+/).filter(t=>t.length>3 && !['question','explain','please','help','what','last','missed','with','from','give','understand','difficult','topic'].includes(t));
 let match=null;
 if(tokens.length) match=all.find(q=>tokens.some(t=>(q.question+' '+q.topic+' '+q.subjectName+' '+Object.values(q.options||{}).join(' ')).toLowerCase().includes(t)));
 if(match){return `From the local ${match.subjectName} pack (${match.topic}):\n\n${match.question}\n\nCorrect option: ${match.correctAnswer}. ${match.options?.[match.correctAnswer]||''}\n\nExplanation: ${match.explanation}\n\nThis is a Ready2Go Original draft item, not a verified official JAMB past question.`;}
 if(/tim(e|ing)|speed|exam/.test(low)) return 'Try a short timed drill first: 5 questions, then review each explanation. Move on if you are stuck, mark the question for review, and return before you submit. Use this app timer as a practice aid—not as a claim about official JAMB timing.';
 if(/plan|revision|study|routine|schedule/.test(low)) return 'A simple 20-minute routine: 2 minutes to choose one topic; 12 minutes for focused questions; 4 minutes to read explanations and note mistakes; 2 minutes to choose what to revise next. Repeat this regularly and let your saved results guide the topic.';
 if(/weak|mistake|wrong|improve|score/.test(low)) return 'Open Progress & Analysis after a practice session. Revisit any topic where your accuracy is low, read the explanation, and try a fresh short session. Your saved accuracy is a local practice metric—not a prediction of your official JAMB score.';
 const topic=all.find(q=>tokens.some(t=>(q.topic+' '+q.subjectName).toLowerCase().includes(t)));
 if(topic) return `For ${topic.subjectName} / ${topic.topic}, start with the related practice question and read its explanation after answering. This offline helper is rule-based in this release; it can't yet reason about arbitrary questions like a connected generative AI tutor.`;
 return 'I can help with local question explanations, a short revision routine, or practice strategy. Try a question from the Question Library, or ask for a 20-minute revision plan. This release does not connect to a generative AI model.';
}

function subjectIcon(subject) { const icons={"Mathematics":"∑","Use of English":"Aa","Physics":"ϕ","Biology":"⌘","Chemistry":"⚗","Computer Studies":"⌘","Arabic":"ع","French":"Fr","Music":"♫","Art":"✧","History":"◷","Agriculture":"♧"};return icons[subject.name]||"✦"; }
async function subjectsView() {
  const grouped = {science:[],"humanities-arts":[],commerce:[]};
  for (const s of subjects) if(grouped[s.category]) grouped[s.category].push(s);
  const list = items => items.map(s=>`<article class="subject-card is-available"><div class="subject-icon">${subjectIcon(s)}</div><div class="subject-info"><h3>${esc(s.name)}</h3><p>${s.compulsory?"Compulsory UTME subject · ":""}${packs[s.id]?.length||0} local questions · draft review required</p></div><button class="icon-button" title="Practise ${esc(s.name)}" data-action="start-subject" data-subject="${s.id}">→</button></article>`).join("");
  const english = subjects.find(s=>s.id==="use-of-english");
  return `<section class="page-intro"><p class="eyebrow">SUBJECT LIBRARY</p><h1>Explore your subjects</h1><p class="muted lead">Browse all 25 subject options listed in JAMB’s 2026 training-manual source. A typical UTME set contains Use of English plus three other subjects; verify your actual combination in IBASS.</p></section>
  <div class="subjects-summary-strip"><div><strong>${subjects.length}</strong><span>subject options</span></div><div><strong>${Object.values(packs).reduce((n,p)=>n+p.length,0)}</strong><span>local draft questions</span></div><div><strong>4</strong><span>subjects per UTME plan</span></div></div>
  ${english?`<section class="subject-group compulsory-subject-group"><div class="group-heading"><h2>Compulsory subject</h2><span class="count-pill">Required for UTME</span></div><div class="subject-grid">${list([english])}</div></section>`:""}
  <section class="subject-group"><div class="group-heading"><h2>Science</h2><span class="count-pill">${grouped.science.length} subjects</span></div><div class="subject-grid">${list(grouped.science)}</div></section>
  <section class="subject-group"><div class="group-heading"><h2>Humanities &amp; Arts</h2><span class="count-pill">${grouped["humanities-arts"].length} subjects</span></div><div class="subject-grid">${list(grouped["humanities-arts"])}</div></section>
  <section class="subject-group"><div class="group-heading"><h2>Commerce</h2><span class="count-pill">${grouped.commerce.length} subjects</span></div><div class="subject-grid">${list(grouped.commerce)}</div></section>
  <div class="guidance-alert"><strong>Content status</strong><p>The local packs contain Ready2Go Original draft questions, not official past JAMB papers. Every generated item must pass human subject and answer-key review before it is approved for public release.</p><span class="small-note">Use the current official syllabus to confirm coverage before relying on a study plan.</span></div>`;
}
function setupView() {
  const active = availableSubjects();
  const planned = (profile.selectedSubjects||[]).filter(id=>active.some(s=>s.id===id));
  const defaultCombined = Boolean(practice?.subjectIds?.length>1 || (!practice?.subjectId && planned.length>=4));
  const mixIds = (practice?.subjectIds?.length>1 ? practice.subjectIds : planned.length>=4 ? planned : ["use-of-english","mathematics","physics","chemistry"]).slice(0,4);
  const subjectOptions=active.map(s=>`<option value="${s.id}" ${practice?.subjectId===s.id?'selected':''}>${esc(s.name)}</option>`).join("");
  const mixOptions=active.map(s=>`<label class="subject-check mix-subject-check ${mixIds.includes(s.id)?'selected':''} ${s.id==='use-of-english'?'required-subject':''}"><input type="checkbox" name="mixSubjects" value="${s.id}" ${mixIds.includes(s.id)?'checked':''} ${s.id==='use-of-english'?'checked disabled':''}><span>${esc(s.name)}${s.id==='use-of-english'?' <small>Required</small>':''}</span><small>${packs[s.id]?.length||0} Q</small></label>`).join("");
  return `<section class="page-intro"><p class="eyebrow">CBT PRACTICE STUDIO</p><h1>Design your practice session</h1><p class="muted lead">Practise one subject or combine your four-subject study plan. Questions are shuffled and IDs do not repeat within a single session.</p></section>
  <form id="setupForm" class="setup-layout"><div class="setup-main"><div class="form-card setup-form-card">
    <div class="setup-mode-grid"><label class="setup-mode-card ${defaultCombined?'':'selected'}"><input type="radio" name="mode" value="single" ${defaultCombined?'':'checked'}><span class="setup-mode-icon">◈</span><strong>One subject</strong><small>Go deep on a topic or subject.</small></label><label class="setup-mode-card ${defaultCombined?'selected':''}"><input type="radio" name="mode" value="combined" ${defaultCombined?'checked':''}><span class="setup-mode-icon coral">✦</span><strong>Four-subject mix</strong><small>Practise across your UTME plan.</small></label></div>
    <div id="singleSubjectGroup" class="single-subject-group ${defaultCombined?'hidden':''}"><label for="subjectSelect">Subject</label><select id="subjectSelect" name="subject" class="field">${subjectOptions}</select><label for="topicSelect">Topic</label><select id="topicSelect" name="topic" class="field"><option value="all">All available topics</option></select></div>
    <div id="mixedSubjectsGroup" class="mixed-subjects-group ${defaultCombined?'':'hidden'}"><div class="field-section-heading"><div><h3>Your four-subject selection</h3><p>Use of English is kept in the set. Select up to three more.</p></div><span class="count-pill" id="mixCount">${mixIds.length}/4 selected</span></div><div class="subject-check-grid mix-subject-grid">${mixOptions}</div></div>
    <label>Number of questions</label><div class="choice-row"><label class="choice"><input type="radio" name="count" value="5" checked><span>5</span></label><label class="choice"><input type="radio" name="count" value="10"><span>10</span></label><label class="choice"><input type="radio" name="count" value="20"><span>20</span></label><label class="choice"><input type="radio" name="count" value="40"><span>40</span></label><label class="choice"><input type="radio" name="count" value="80"><span>80</span></label><label class="choice"><input type="radio" name="count" value="100"><span>100</span></label><label class="choice"><input type="radio" name="count" value="all"><span>All available</span></label></div>
    <label>Difficulty</label><div class="choice-row"><label class="choice"><input type="radio" name="difficulty" value="all" checked><span>Mixed</span></label><label class="choice"><input type="radio" name="difficulty" value="easy"><span>Easy</span></label><label class="choice"><input type="radio" name="difficulty" value="medium"><span>Medium</span></label><label class="choice"><input type="radio" name="difficulty" value="challenging"><span>Challenging</span></label></div>
    <label class="check-row"><input type="checkbox" name="timed" checked><span><strong>Use a timer</strong><small>Choose your own exam duration below. You can also switch the timer off.</small></span></label>
    <div class="duration-field"><label for="durationMinutes">Exam duration</label><div class="duration-control"><input id="durationMinutes" name="durationMinutes" class="field" type="number" min="1" max="300" step="1" value="60" inputmode="numeric"><span>minutes</span></div><small class="muted">When the timer reaches zero, your answers are submitted automatically.</small></div>
    <button type="submit" class="button button-primary button-wide">Begin practice <span>→</span></button>
  </div></div><aside class="setup-aside practice-aside"><div class="learning-scene scene-compact" role="img" aria-label="Illustration of a student studying"><div class="scene-student"><div class="scene-hair"></div><div class="scene-head"></div><div class="scene-body"></div><div class="scene-arm"></div><div class="scene-laptop"><span>R2G</span><i></i></div></div><div class="scene-ground"></div></div><div class="aside-mark">R2G</div><h3>Practise with purpose</h3><p>Every session gives a score, explanations and a chance to review mistakes. Your completed sessions are saved on this device.</p><div class="mini-rule"></div><p class="small-note">All included packs are Ready2Go Original draft content until subject experts verify them. No official past-paper corpus is bundled.</p></aside></form>`;
}
function refreshTopics() {
  const subjectId=$("#subjectSelect")?.value; const topicSelect=$("#topicSelect"); if(!topicSelect)return;
  const qs=packs[subjectId]||[]; const topics=[...new Set(qs.map(q=>q.topic))].sort();
  topicSelect.innerHTML='<option value="all">All available topics</option>'+topics.map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join("");
}
async function startPractice(form) {
  const fd=new FormData(form); const mode=String(fd.get("mode")||"single");
  let subjectIds=mode==="combined" ? [...new Set(fd.getAll("mixSubjects").map(String))].slice(0,4) : [String(fd.get("subject")||"mathematics")];
  if(mode==="combined") {
    if(!subjectIds.includes("use-of-english")) subjectIds=["use-of-english",...subjectIds].slice(0,4);
    if(subjectIds.length<2){toast("Choose Use of English and at least one more subject for a mixed session.");return;}
    if(subjectIds.length>4){toast("A UTME study set contains four subjects. Remove one selection.");return;}
  }
  for(const id of subjectIds) await loadPackIfNeeded(id);
  let pool=[];
  for(const id of subjectIds){
    const subject=subjects.find(s=>s.id===id);
    const source=(packs[id]||[]).map(q=>({...q,id:`${id}::${q.id}`,subjectId:id,subjectName:subject?.name||id}));
    pool.push(...source);
  }
  if(mode!=="combined") {
    if(fd.get("topic")&&fd.get("topic")!=="all") pool=pool.filter(q=>q.topic===fd.get("topic"));
    if(fd.get("difficulty")&&fd.get("difficulty")!=="all") pool=pool.filter(q=>q.difficulty===fd.get("difficulty"));
  } else if(fd.get("difficulty")&&fd.get("difficulty")!=="all") {
    pool=pool.filter(q=>q.difficulty===fd.get("difficulty"));
  }
  if(!pool.length){toast("No questions match those filters yet. Choose another topic or difficulty.");return;}
  const shuffleQuestions=list=>{for(let i=list.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[list[i],list[j]]=[list[j],list[i]];}return list;};
  if(mode==="combined") pool=subjectIds.flatMap(id=>shuffleQuestions(pool.filter(q=>q.subjectId===id)));
  else shuffleQuestions(pool);
  const requested=fd.get("count")==="all"?pool.length:Number(fd.get("count")||10);
  const asked=Math.min(requested,pool.length);
  if(asked<requested) toast(`Only ${asked} questions are available across your selected subjects; we will not invent or repeat questions.`);
  const selectedNames=subjectIds.map(id=>subjects.find(s=>s.id===id)?.name||id);
  const requestedMinutes=Math.max(1,Math.min(300,Number(fd.get("durationMinutes")||60)));
  practice={subjectId:mode==="combined"?"mixed":subjectIds[0],subjectIds,mode,subjectName:mode==="combined"?"Four-subject practice":selectedNames[0],questions:pool.slice(0,asked),answers:{},flagged:[],index:0,timed:fd.has("timed"),durationMinutes:requestedMinutes,startedAt:Date.now(),secondsLeft:requestedMinutes*60,submitted:false,score:0};
  page="practice"; await render(); if(practice.timed) startTimer();
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
  return `<div class="cbt-top"><div><p class="eyebrow">READY2GO CBT</p><h1>${esc(q.subjectName||practice.subjectName)}</h1><p class="muted small">Question ${i} of ${n} · ${esc(q.topic)}</p></div><div class="cbt-top-right">${practice.timed?`<div class="timer ${practice.secondsLeft<60?'timer-warning':''}"><span>Time left</span><strong id="timerValue">${formatTime(practice.secondsLeft)}</strong></div>`:`<div class="status-chip"><span class="status-dot"></span> No timer</div>`}<button class="button button-outline" data-action="confirm-end">Finish</button></div></div>${practice.mode==="combined"?`<div class="cbt-subject-tabs" aria-label="Switch subject">${practice.subjectIds.map(id=>{const sub=subjects.find(x=>x.id===id);const count=practice.questions.filter(x=>x.subjectId===id).length;return `<button type="button" class="cbt-subject-tab ${q.subjectId===id?'active':''}" data-action="switch-subject" data-subject="${esc(id)}">${esc(sub?.name||id)} <small>${count}</small></button>`}).join("")}</div>`:""}<div class="cbt-progress"><span style="width:${Math.round(i/n*100)}%"></span></div><div class="cbt-layout"><section class="question-panel"><div class="question-meta"><span class="question-number">QUESTION ${String(i).padStart(2,"0")}</span><button class="flag-button ${practice.flagged.includes(q.id)?'flagged':''}" data-action="flag-question">${practice.flagged.includes(q.id)?'⚑ Marked for review':'⚐ Mark for review'}</button></div><h2 class="question-text">${esc(q.question)}</h2><div class="options-list">${Object.entries(q.options).map(([key,value])=>`<label class="answer-option ${practice.answers[q.id]===key?'selected':''}"><input type="radio" name="answer" value="${key}" ${practice.answers[q.id]===key?'checked':''}><span class="option-key">${key}</span><span class="option-text">${esc(value)}</span></label>`).join("")}</div><div class="question-nav"><button class="button button-outline" data-action="prev-question" ${practice.index===0?'disabled':''}>← Previous</button><span class="answered-count">${answered} of ${n} answered</span>${practice.index<n-1?`<button class="button button-primary" data-action="next-question">Next question →</button>`:`<button class="button button-primary" data-action="confirm-end">Review &amp; submit</button>`}</div></section><aside class="question-map"><div class="map-heading"><h3>Question navigator</h3><span>${answered}/${n}</span></div><p class="small-note">Select a number to move directly to that question.</p><div class="number-grid question-number-grid">${practice.questions.map((question,idx)=>`<button class="number-button ${idx===practice.index?'current':''} ${practice.answers[question.id]?'answered':''} ${practice.flagged.includes(question.id)?'flagged':''}" data-action="go-question" data-index="${idx}" aria-label="Go to question ${idx+1}">${idx+1}</button>`).join("")}</div><div class="legend"><span><i class="legend-current"></i>Current</span><span><i class="legend-answered"></i>Answered</span><span><i class="legend-flagged"></i>Review</span></div><button class="button button-primary button-wide" data-action="confirm-end">Submit answers</button><p class="small-note">This is an original practice interface, not an official JAMB examination system.</p></aside></div>`;
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
  const graphPoints=bySubject.map((x,i)=>`${bySubject.length===1?180:8+i*(344/(bySubject.length-1))},${90-(x.pct*.78)}`).join(" ");
  const resultGraph=`<section class="result-analytics"><div class="section-head"><div><p class="eyebrow">YOUR SESSION</p><h2>Performance by subject</h2></div></div>${bySubject.map(x=>`<div class="analytics-row"><div class="analytics-row-label"><strong>${esc(x.name)}</strong><span>${x.got}/${x.total} correct</span></div><div class="analytics-track"><span style="width:${x.pct}%"></span></div><b>${x.pct}%</b></div>`).join("")}<div class="result-graph" role="img" aria-label="Accuracy graph for this session"><svg viewBox="0 0 360 100" preserveAspectRatio="none"><line x1="8" y1="80" x2="352" y2="80" stroke="currentColor" opacity=".15"/><line x1="8" y1="50" x2="352" y2="50" stroke="currentColor" opacity=".12"/><line x1="8" y1="20" x2="352" y2="20" stroke="currentColor" opacity=".12"/><polyline points="${graphPoints}" fill="none" stroke="var(--primary)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>${bySubject.map((x,i)=>`<circle cx="${bySubject.length===1?180:8+i*(344/(bySubject.length-1))}" cy="${90-(x.pct*.78)}" r="4" fill="var(--primary)"/>`).join("")}</svg></div></section>`;
  return `<section class="results-hero"><div class="result-symbol">${pct>=80?'✓':pct>=50?'↗':'R2G'}</div><p class="eyebrow">SESSION COMPLETE</p><h1>${score} <span>/ ${total}</span></h1><div class="result-pct">${pct}% correct</div><p class="result-message">${headline}</p><div class="result-stats"><div><strong>${Object.keys(practice.answers).length}</strong><span>Answered</span></div><div><strong>${total-Object.keys(practice.answers).length}</strong><span>Unanswered</span></div><div><strong>${total-score}</strong><span>To review</span></div></div><div class="result-actions"><button class="button button-primary" data-action="review-answers">Review answers</button><button class="button button-outline" data-action="retry">Practise again</button><button class="text-button" data-page="home">Back to dashboard</button></div></section>${resultGraph}<section id="answerReview" class="answer-review hidden"><div class="section-head"><div><p class="eyebrow">LEARN FROM EVERY QUESTION</p><h2>Answer review</h2></div></div>${practice.questions.map((q,i)=>{const user=practice.answers[q.id];const ok=user===q.correctAnswer;return `<article class="review-card"><div class="review-title"><span class="review-badge ${ok?'correct':'incorrect'}">${ok?'Correct':'Review'}</span><span>Question ${i+1} · ${esc(q.topic)}</span></div><h3>${esc(q.question)}</h3><p class="your-answer">Your answer: <strong>${user?esc(user)+'. '+esc(q.options[user]):'Not answered'}</strong></p><p class="correct-answer">Correct answer: <strong>${q.correctAnswer}. ${esc(q.options[q.correctAnswer])}</strong></p><p class="explanation">${esc(q.explanation)}</p></article>`}).join("")}</section>`;
}
async function progressView() {
 const sessions=await getSessions(); const attempts=sessions.reduce((a,s)=>a+(s.answered ?? s.total),0);const correct=sessions.reduce((a,s)=>a+s.score,0);
 const subjectStats=new Map(), topicStats=new Map();
 for(const session of sessions){for(const item of (session.items||[])){if(!item.answer)continue;const ok=item.answer===item.correctAnswer;const sid=item.subjectId||session.subjectId||"unknown";const sname=item.subjectName||session.subjectName||sid;const sr=subjectStats.get(sid)||{name:sname,attempts:0,correct:0};sr.attempts++;sr.correct+=ok?1:0;subjectStats.set(sid,sr);const tk=`${sid}::${item.topic||"Uncategorised"}`;const tr=topicStats.get(tk)||{name:item.topic||"Uncategorised",subject:sname,attempts:0,correct:0};tr.attempts++;tr.correct+=ok?1:0;topicStats.set(tk,tr);}}
 const subjectBars=[...subjectStats.values()].sort((a,b)=>(a.correct/Math.max(1,a.attempts))-(b.correct/Math.max(1,b.attempts))).map(x=>`<div class="analytics-row"><div class="analytics-row-label"><strong>${esc(x.name)}</strong><span>${x.correct}/${x.attempts} correct</span></div><div class="analytics-track"><span style="width:${Math.round(x.correct/Math.max(1,x.attempts)*100)}%"></span></div><b>${Math.round(x.correct/Math.max(1,x.attempts)*100)}%</b></div>`).join("");
 const weakTopics=[...topicStats.values()].filter(x=>x.attempts>=2).sort((a,b)=>(a.correct/Math.max(1,a.attempts))-(b.correct/Math.max(1,b.attempts))).slice(0,5);
 const weakMarkup=weakTopics.length?weakTopics.map(x=>`<article class="weak-topic-card"><span class="weak-topic-mark">↗</span><div><strong>${esc(x.name)}</strong><small>${esc(x.subject)} · ${x.correct}/${x.attempts} correct</small></div><span class="weak-topic-score">${Math.round(x.correct/Math.max(1,x.attempts)*100)}%</span></article>`).join(""):`<p class="muted small">Complete a few sessions to identify topics that may need more revision. Topic diagnostics only use saved question-level attempts.</p>`;
 const recentTrend=sessions.slice(0,7).reverse().map(x=>Math.round((x.score/Math.max(1,x.total))*100));
 const trendPoints=recentTrend.map((v,i)=>`${recentTrend.length===1?180:10+i*(340/(recentTrend.length-1))},${88-v*.72}`).join(" ");
 const trendMarkup=recentTrend.length?`<section class="analytics-panel trend-panel"><div class="section-head"><div><p class="eyebrow">LAST ${recentTrend.length} SESSIONS</p><h2>Accuracy trend</h2></div></div><div class="result-graph trend-graph" role="img" aria-label="Accuracy trend across recent completed sessions"><svg viewBox="0 0 360 100" preserveAspectRatio="none"><line x1="8" y1="80" x2="352" y2="80" stroke="currentColor" opacity=".15"/><line x1="8" y1="50" x2="352" y2="50" stroke="currentColor" opacity=".12"/><line x1="8" y1="20" x2="352" y2="20" stroke="currentColor" opacity=".12"/><polyline points="${trendPoints}" fill="none" stroke="var(--primary)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>${recentTrend.map((v,i)=>`<circle cx="${recentTrend.length===1?180:10+i*(340/(recentTrend.length-1))}" cy="${88-v*.72}" r="4" fill="var(--primary)"/>`).join("")}</svg></div><p class="muted small">Each point is one completed session, ordered from oldest to newest.</p></section>`:`<section class="analytics-panel trend-panel"><div class="section-head"><div><p class="eyebrow">ACCURACY TREND</p><h2>Your graph starts here</h2></div></div><p class="muted small">Finish a practice session to begin building your personal accuracy graph.</p></section>`;
 return `<section class="page-intro"><p class="eyebrow">YOUR PROGRESS</p><h1>Your learning history</h1><p class="muted lead">See how your practice is going and what to revisit next.</p></section><section class="metric-grid"><article class="metric-card"><span class="metric-label">Completed sessions</span><strong>${sessions.length}</strong></article><article class="metric-card"><span class="metric-label">Questions answered</span><strong>${attempts}</strong></article><article class="metric-card"><span class="metric-label">Overall accuracy</span><strong>${attempts?Math.round(correct/attempts*100):0}%</strong></article></section>${trendMarkup}<section class="analytics-panel"><div class="section-head"><div><p class="eyebrow">SUBJECT-BY-SUBJECT</p><h2>Accuracy overview</h2></div></div>${subjectBars||'<p class="muted small">Subject performance appears after you complete a practice session.</p>'}</section><section class="analytics-panel"><div class="section-head"><div><p class="eyebrow">REVISION PRIORITIES</p><h2>Topics to revisit</h2></div></div>${weakMarkup}</section><section class="section-head spaced"><div><h2>Recent sessions</h2></div><button class="text-button" data-action="export-data">Export my local data</button></section>${sessions.length?sessions.map(s=>`<article class="recent-card"><div class="recent-icon">✓</div><div class="recent-copy"><strong>${esc(s.subjectName)}</strong><span>${fmtDate(s.completedAt)} · ${s.total} questions${s.timed?' · timed':''}${s.autoSubmitted?' · auto-submitted':''}</span></div><div class="recent-score"><strong>${s.score}/${s.total}</strong><span>${Math.round(s.score/Math.max(1,s.total)*100)}%</span></div></article>`).join(""):`<div class="empty-state"><div class="empty-symbol">↗</div><h2>No practice history yet</h2><p>Finish your first session to see your results here.</p><button class="button button-primary" data-page="practice-setup">Start a session</button></div>`}<section class="danger-zone"><div><h3>Clear local practice history</h3><p>This removes the saved sessions from this browser only.</p></div><button class="button button-danger" data-action="clear-history">Clear history</button></section>`;
}
async function profileView() {
 const selected=new Set((profile.selectedSubjects||[]).filter(id=>id!=="use-of-english"));
 const subjectChecks=subjects.filter(s=>s.id!=="use-of-english").map(s=>`<label class="subject-check"><input type="checkbox" name="selectedSubjects" value="${s.id}" ${selected.has(s.id)?'checked':''}><span>${esc(s.name)}</span><small>${packs[s.id]?.length||0} Q</small></label>`).join("");
 const categoryMarkup=Object.entries(CATEGORY_NAMES).map(([id,name])=>`<label class="category-card ${profile.category===id?'selected':''}"><input type="radio" name="category" value="${id}" ${profile.category===id?'checked':''} required><span class="category-symbol">${id==='science'?'∑':id==='commerce'?'₦':'Aa'}</span><strong>${name}</strong><small>${id==='science'?'Science, technology and health':id==='commerce'?'Business, accounting and economics':'Arts, languages, society and culture'}</small></label>`).join("");
 const stateOpts=(institutionsData.states||[]).map(state=>`<option value="${esc(state)}" ${profile.state===state?'selected':''}>${esc(state)}</option>`).join("");
 const courseOpts=(coursesData.courses||[]).map(c=>`<option value="${esc(c.id)}" ${profile.courseId===c.id?'selected':''}>${esc(c.name)}</option>`).join("");
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
  <label for="profileInstitution">Search the university directory</label><select id="profileInstitution" name="institutionId" class="field"><option value="">Choose an institution (optional)</option></select>
  <label for="profileInstitutionName">Or enter an institution name not listed</label><input id="profileInstitutionName" name="institutionName" class="field" value="${esc(profile.institutionName||'')}" placeholder="Enter exact institution name" maxlength="160">
  <label for="profileCourse">Course / programme you're considering</label><select id="profileCourse" name="courseId" class="field"><option value="">Select a course (optional)</option>${courseOpts}<option value="other-course" ${profile.courseId==='other-course'?'selected':''}>Other / not listed</option></select>
  <label for="profileCourseName">Or enter a programme name</label><input id="profileCourseName" name="courseName" class="field" value="${esc(profile.courseName||'')}" placeholder="e.g. Computer Science" maxlength="120">
  <div class="guidance-alert"><strong>2026 admission guidance</strong><p>JAMB’s 2026 national minimum admissible score is 150 for universities and Colleges of Nursing, and 100 for polytechnics, monotechnics, colleges of agriculture and IEIs. These are national floors, not course-specific cut-off marks. Institutions can set higher requirements.</p><span class="small-note">Confirm the latest course and subject requirements through the relevant official admissions guidance.</span></div>`;
 } else {
  stepFields=`<div class="subject-pick-heading"><div><h2>Choose your subjects</h2><p class="muted small">Choose three electives. Use of English is always included in this UTME study set.</p></div><button type="button" class="text-button" data-action="use-recommendations">Recommend for me</button></div>
  <div class="required-english-card"><span class="required-english-icon">Aa</span><div><strong>Use of English</strong><small>Compulsory subject included automatically</small></div><span class="required-pill">Required</span></div>
  <div class="subject-check-grid onboarding-subject-grid">${subjectChecks}</div>
  <div class="selection-summary"><span class="summary-check">✓</span><div><strong>Four-subject plan</strong><p>Use of English + up to three of the subjects above. You can edit the plan offline at any time.</p></div><span class="count-pill">Max 4</span></div>
  <p class="small-note">The category suggestion is not a JAMB-approved combination. The exact combination depends on your selected institution and programme. Use IBASS to verify before registration.</p>`;
 }
 const actionButtons=onboardingStep===0?`<button type="button" class="button button-primary button-wide" data-action="onboarding-next">Continue to your destination →</button>`:onboardingStep===1?`<div class="wizard-buttons"><button type="button" class="button button-outline" data-action="onboarding-back">← Back</button><button type="button" class="button button-primary" data-action="onboarding-next">Continue to subjects →</button></div>`:`<div class="wizard-buttons"><button type="button" class="button button-outline" data-action="onboarding-back">← Back</button><button type="submit" class="button button-primary">Save my study plan ✓</button></div>`;
 return `<section class="onboarding-shell"><div class="onboarding-main"><div class="onboarding-heading"><p class="eyebrow">YOUR PERSONAL STUDY PLAN · STEP ${onboardingStep+1} OF 3</p><h1>${stepTitles[onboardingStep]}.</h1><p class="muted lead">${stepDescriptions[onboardingStep]}</p></div>${progress}
 <form id="profileForm" class="profile-layout wizard-layout"><div class="form-card onboarding-card wizard-card">${stepFields}${actionButtons}</div>
 <aside class="setup-aside polygon-aside onboarding-side"><div class="onboarding-side-art"><div class="learning-scene scene-compact" role="img" aria-label="Illustration of a student getting ready to study"><div class="scene-student"><div class="scene-hair"></div><div class="scene-head"></div><div class="scene-body"></div><div class="scene-arm"></div><div class="scene-laptop"><span>R2G</span><i></i></div></div><div class="scene-ground"></div></div></div><span class="side-kicker">YOUR NEXT CHAPTER</span><h3>A plan that grows with you.</h3><p>Ready2Go remembers your study preferences on this device, so you can change subjects or revisit your goal—even offline.</p><div class="side-stat-list"><span>✦ <b>25</b> subject choices</span><span>◈ <b>328</b> NUC directory entries</span><span>✓ <b>4</b> subjects in your plan</span></div><span class="small-note">Check current admission eligibility using official guidance before applying.</span></aside></form>
 <p class="onboarding-footnote">No payment is needed to begin practising. <a href="./privacy.html">Privacy</a> · <a href="./terms.html">Terms</a></p></div></section>`;
}
function refreshInstitutionOptions() {
 const state = $("#profileState")?.value || "";
 const type = $("#profileInstitutionType")?.value || "";
 const select = $("#profileInstitution"); if (!select) return;
 let options = (institutionsData.institutions||[]).filter(i => (!state || i.state===state) && (!['Federal','State','Private'].includes(type) || i.ownership===type));
 const selected = profile.institutionId || "";
 let html='<option value="">Choose an institution (optional)</option>';
 for (const institution of options) html += `<option value="${esc(institution.id)}" ${selected===institution.id?'selected':''}>${esc(institution.name)} — ${esc(institution.ownership)}</option>`;
 if (type==='other-tertiary') for(const choice of institutionsData.additionalChoices||[]) html += `<option value="${esc(choice.id)}" ${selected===choice.id?'selected':''}>${esc(choice.name)}</option>`;
 html += `<option value="other-university" ${selected==='other-university'?'selected':''}>Other / not listed — enter the name manually</option>`;
 if (type==='undecided') html='<option value="undecided-institution" selected>Not chosen yet</option>'+html;
 select.innerHTML=html;
}
function sizeType(type) { return ["Other", "other-tertiary", "undecided"].includes(type); }

function courseGuideView() {
 const state=(institutionsData.states||[]).length;
 const inst=(institutionsData.institutions||[]).length;
 const count=(coursesData.courses||[]).length;
 const benchmarks=(JSON.parse(JSON.stringify({universities:150,nursing:150,polytechnic:100}))); 
 return `<section class="page-intro"><p class="eyebrow">PLAN YOUR NEXT STEP</p><h1>Course &amp; institution guide</h1><p class="muted lead">Explore the national university directory, choose a programme, then verify the exact subject combination and admission criteria in JAMB IBASS.</p></section>
 <div class="course-guide-hero"><div><span class="course-guide-kicker">ADMISSION GUIDE · 2026</span><h2>Choose with confidence.<br>Verify before you apply.</h2><p>Search the university directory and use the official checker for the programme-specific requirements. A familiar course name does not guarantee the same requirements at every institution.</p><div class="course-guide-note">Check current programme requirements against official admissions guidance before applying.</div></div><div class="guide-hero-stats"><div><strong>${inst}</strong><span>directory entries</span></div><div><strong>${state}</strong><span>states + FCT</span></div><div><strong>${count}</strong><span>common programme searches</span></div></div></div>
 <section class="section-head spaced"><div><p class="eyebrow">2026 BENCHMARKS</p><h2>National minimum admissible scores</h2></div><span class="count-pill">Admission year 2026 only</span></section>
 <div class="benchmark-grid"><article class="benchmark-card benchmark-violet"><span>University</span><strong>${benchmarks.universities}</strong><small>out of 400 · national minimum</small></article><article class="benchmark-card benchmark-coral"><span>College of Nursing</span><strong>${benchmarks.nursing}</strong><small>out of 400 · national minimum</small></article><article class="benchmark-card benchmark-mint"><span>Polytechnic / Monotechnic / eligible colleges</span><strong>${benchmarks.polytechnic}</strong><small>out of 400 · national minimum</small></article></div>
 <div class="guidance-alert"><strong>Important: these are not departmental cut-off marks</strong><p>JAMB’s 2026 policy meeting set national minimum admissible scores. Institutions may set higher requirements, and admission may depend on programme-specific subject combinations, O’Level grades, screening and other criteria. Ready2Go will not invent a specific university-course cut-off without a reliable source for the exact year.</p><span>Admission guidance shown here is informational and should be confirmed through current official materials.</span></div>
 <section class="section-head spaced"><div><p class="eyebrow">NATIONAL DIRECTORY</p><h2>Find your university</h2><p class="muted small">${inst} rows transcribed from the NUC directory retrieved on 16 October 2026. Confirm current status and programme availability with the official institution.</p></div><button class="button button-outline" data-action="open-profile">Use in my study plan →</button></section>
 <div class="university-search-panel"><label for="universitySearch">Search institution name, state or ownership</label><input class="field" id="universitySearch" type="search" placeholder="Start typing a university name…"><div class="university-filters"><select id="universityStateFilter" class="field"><option value="">All states and FCT</option>${(institutionsData.states||[]).map(st=>`<option value="${esc(st)}">${esc(st)}</option>`).join('')}</select><select id="universityTypeFilter" class="field"><option value="">All ownership types</option><option>Federal</option><option>State</option><option>Private</option></select></div><div id="universityResults" class="university-results">${renderUniversityResults('', '', '')}</div></div>
 <p class="small-note">Catalogue source: <span>Institution records should be verified against current official listings before decisions are made.</span>. Course catalogue contains common search suggestions and is not an official list of courses offered by each institution.</p>`;
}
function renderUniversityResults(query='', state='', owner='') {
 const rows=(institutionsData.institutions||[]).filter(i=>(!query||`${i.name} ${i.state} ${i.ownership}`.toLowerCase().includes(query.toLowerCase()))&&(!state||i.state===state)&&(!owner||i.ownership===owner)).slice(0,40);
 if(!rows.length)return `<div class="empty-state compact"><strong>No institution matched those filters</strong><p>Try a shorter search or choose “Other / not listed” in your study plan.</p></div>`;
 return `<div class="university-result-count">Showing ${rows.length} matching entries${query||state||owner?' (maximum 40 shown)':''}</div>${rows.map(i=>`<article class="university-result"><span class="university-crest">${i.ownership==='Federal'?'F':i.ownership==='State'?'S':'P'}</span><div><strong>${esc(i.name)}</strong><small>${esc(i.state)} · ${esc(i.ownership)}</small></div><button class="button button-outline" data-action="choose-institution" data-institution-id="${esc(i.id)}">Choose</button></article>`).join('')}`;
}

function syllabusView() {
 return `<section class="page-intro"><p class="eyebrow">STUDY WITH A PLAN</p><h1>Syllabus planner</h1><p class="muted lead">Use the official JAMB syllabus to choose topics, then practise from Ready2Go's available question packs. We won't pretend an unverified topic checklist is the official syllabus.</p></section><div class="feature-card feature-primary syllabus-hero"><div class="feature-top"><span class="subject-icon">▤</span><span class="pill pill-live">Official source</span></div><h3>JAMB IBASS e-Syllabus</h3><p>Open the current syllabus and confirm the topics for your selected subject before creating a revision plan.</p><span class="button button-light" aria-label="Syllabus guidance">Syllabus guidance</span></div><section class="section-head spaced"><div><p class="eyebrow">AVAILABLE PRACTICE CONTENT</p><h2>Choose a subject to practise</h2></div><button class="text-button" data-page="subjects">Browse subject library →</button></section><div class="subject-grid">${subjects.map(s=>`<article class="subject-card ${packs[s.id]?'is-available':'is-coming'}"><div class="subject-icon">${subjectIcon(s)}</div><div class="subject-info"><h3>${esc(s.name)}</h3><p>${packs[s.id]?`${packs[s.id].length} local questions · source labels included`:'Question pack not downloaded/included'}</p></div>${hasPackAvailable(s.id)?`<button class="icon-button" data-action="start-subject" data-subject="${s.id}" aria-label="Practise ${esc(s.name)}">→</button>`:'<span class="pill">Planned</span>'}</article>`).join("")}</div><p class="small-note">The current local packs contain original Ready2Go questions. Draft packs require subject-matter review. No official 2020 bank is bundled.</p>`;
}
function questionLibraryView() {
 const rows=subjects.map(s=>{const pack=(packs[s.id]||[]);const meta=(remoteContentManifest?.packs||[]).find(p=>p.subjectId===s.id||p.id===s.id);const r2Note=meta?(meta.status==='published'?' · R2 published version':' · R2 seed is not published'):'';const reviewNote=pack.length?(pack.some(q=>q.reviewStatus==='needs_human_review')?'draft review required':pack.some(q=>q.reviewStatus==='internal_pilot')?'internal pilot—review before launch':'approved content'):'';return `<article class="recent-card"><div class="recent-icon">${pack.length?'✓':'+'}</div><div class="recent-copy"><strong>${esc(s.name)}</strong><span>${pack.length?`${pack.length} questions available on this build · ${reviewNote}`:'No local pack in this build'}${r2Note}</span></div>${pack.length?`<button class="button button-outline" data-action="start-subject" data-subject="${s.id}">Practise</button>`:'<span class="pill">Planned</span>'}</article>`;}).join("");
 const archived=(questionArchive.records||[]).filter(r=>r.requestedYear===2020);
 return `<section class="page-intro"><p class="eyebrow">CONTENT TRANSPARENCY</p><h1>Question library</h1><p class="muted lead">Each item must have a reliable source, answer key, explanation, topic mapping and review status. Original questions are never labelled as past JAMB questions.</p></section><div class="guidance-alert"><strong>About the requested 2020 papers and set text</strong><p>This starter does not reproduce the full 2020 JAMB papers or the full text of <em>The Lekki Headmaster</em>. Those materials must be sourced with appropriate rights. This archive records what is awaiting verification; the original practice bank below is separately labelled.</p></div><section class="section-head"><div><h2>Local question packs</h2></div><span class="count-pill">${Object.values(packs).reduce((n,p)=>n+p.length,0)} questions</span></section>${rows}<section class="section-head spaced"><div><h2>2020 source archive</h2><p class="muted small">${archived.length} subjects tracked · not included as JAMB past questions</p></div></section><div class="guidance-alert"><p>Records are marked <strong>rights/source review required</strong> and contain no reproduced past questions. Add only authorised content with source details.</p><span>Confirm the current syllabus using official materials before relying on this draft planner.</span></div><section class="section-head spaced"><div><h2>The Lekki Headmaster</h2></div></section><p class="muted">The set-text record is a metadata placeholder only. We must verify the book's prescription for the relevant UTME year and use only licensed or otherwise lawfully usable text. We can create original study questions after that review.</p>`;
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
 if(action==="start-math"){page="practice-setup";practice={subjectId:"mathematics"};await render();if($("#subjectSelect"))$("#subjectSelect").value="mathematics";refreshTopics();}
 else if(action==="start-english"){page="practice-setup";practice={subjectId:"use-of-english"};await render();if($("#subjectSelect"))$("#subjectSelect").value="use-of-english";refreshTopics();}
 else if(action==="start-subject"){const id=button.dataset.subject;await loadPackIfNeeded(id);if(packs[id]?.length){page="practice-setup";practice={subjectId:id};await render();if($("#subjectSelect"))$("#subjectSelect").value=id;refreshTopics();const single=$('input[name="mode"][value="single"]');if(single){single.checked=true;syncSetupMode();}}else toast("This subject has no questions in the current build.");}
 else if(action==="start-mixed-practice"){page="practice-setup";practice={subjectIds:(profile.selectedSubjects||[]).slice(0,4),mode:"combined"};await render();const mixed=$('input[name="mode"][value="combined"]');if(mixed)mixed.checked=true;syncSetupMode();}
 else if(action==="open-profile"){page="profile";onboardingStep=profile.onboardingCompleted?2:0;closeMobileSidebar();await render();refreshInstitutionOptions();}
 else if(action==="start-onboarding"){page="profile";onboardingStep=0;closeMobileSidebar();await render();refreshInstitutionOptions();}
 else if(action==="coach-fill"){const input=$("#coachInput");if(input){input.value=button.dataset.prompt||"";input.focus();input.closest("form")?.requestSubmit();}}
 else if(action==="onboarding-next")await saveOnboardingStep();
 else if(action==="onboarding-back"){onboardingStep=Math.max(0,onboardingStep-1);await render();refreshInstitutionOptions();}
 else if(action==="dismiss-install-nudge"){const n=$("#installNudge");if(n?._autoDismissTimer)clearTimeout(n._autoDismissTimer);safeSessionSet("r2gInstallDismissed","1");n?.classList.remove("visible");window.setTimeout(()=>n?.remove(),220);}
 else if(action==="install-help-close"){$("#installHelpModal")?.remove();}
 else if(action==="skip-welcome"){page="home";await render();}
 else if(action==="choose-institution"){const id=button.dataset.institutionId;const inst=(institutionsData.institutions||[]).find(x=>x.id===id);if(inst){profile.state=inst.state;profile.institutionType=inst.ownership;profile.institutionId=inst.id;profile.institutionName=inst.name;await writeRecord("profile",profile);page="profile";onboardingStep=1;await render();refreshInstitutionOptions();toast("Institution added to your study plan. Continue onboarding to choose a programme and subjects.");}}
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
 if (isStandalone()) return `<section class="install-banner installed"><div class="install-symbol">✓</div><div class="install-copy"><strong>Ready2Go is installed</strong><span>Open it from your home screen for a focused learning space.</span></div></section>`;
 const action = deferredInstallPrompt ? 'install-app' : 'install-help';
 const label = deferredInstallPrompt ? 'Install app' : (isIosSafari() ? 'How to add' : 'Installation help');
 return `<section class="install-banner"><div class="install-symbol polygon">R2G</div><div class="install-copy"><strong>Make Ready2Go an app</strong><span>Pin it to your home screen for quick access. Native install prompts depend on your browser.</span></div><button class="button button-primary" data-action="${action}">${label} ↗</button></section>`;
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
 const n=$("#installNudge");if(n?._autoDismissTimer)clearTimeout(n._autoDismissTimer);safeSessionSet("r2gInstallDismissed","1");n?.classList.remove("visible");window.setTimeout(()=>n?.remove(),220);
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
function updateConnectivityChip(){
 const online=Boolean(navigator.onLine);const node=$("#connectivityChip");if(node){node.classList.toggle("is-offline",!online);node.querySelector("span").textContent=online?"Online · offline-ready":"Offline · local content";}
 const pill=$("#dashboardOfflinePill");if(pill){pill.classList.toggle("is-offline",!online);pill.innerHTML=`<i></i>${online?'Online · offline-ready':'Offline · local practice ready'}`;}
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
   await writeRecord("profile",profile);onboardingStep=2;await render();return;
 }
}
function syncSetupMode(){
 const mode=$("input[name=\'mode\']:checked")?.value||"single";
 $("#singleSubjectGroup")?.classList.toggle("hidden",mode==="combined");
 $("#mixedSubjectsGroup")?.classList.toggle("hidden",mode!=="combined");
 $$(".setup-mode-card").forEach(card=>card.classList.toggle("selected",card.querySelector("input")?.checked));
 updateMixCount();
}
function updateMixCount(){const n=$$("input[name=\'mixSubjects\']:checked").length;const el=$("#mixCount");if(el)el.textContent=`${Math.min(4,n)}/4 selected`;}
function showTimedInstallNudge(){
 if(isStandalone()||safeSessionGet("r2gInstallDismissed")==="1"||$("#installNudge"))return;
 const n=document.createElement("div");n.id="installNudge";n.className="install-nudge";n.setAttribute("role","dialog");n.setAttribute("aria-modal","true");n.setAttribute("aria-label","Install Ready2Go Learning");
 n.innerHTML=`<section class="install-nudge-card"><button class="install-nudge-close" data-action="dismiss-install-nudge" aria-label="Continue in browser">×</button><div class="install-nudge-visual"><img src="./assets/r2g-app-icon-512.png" alt="Ready2Go app icon"><div class="install-nudge-spark spark-one">✦</div><div class="install-nudge-spark spark-two">✎</div></div><div class="install-nudge-copy"><span class="install-nudge-kicker">READY2GO LEARNING · APP INSTALL</span><h2>Make your study space an app.</h2><p>Add Ready2Go to your home screen for a focused, full-screen study app. Open it once while online so the app and included question packs can finish saving for offline practice.</p><div class="install-benefit-grid"><span><b>✓</b> CBT practice</span><span><b>✓</b> Study anywhere</span><span><b>✓</b> Local progress</span><span><b>✓</b> Light &amp; dark themes</span></div><div class="install-nudge-actions"><button class="button button-primary install-main-cta" data-action="install-nudge-go">${deferredInstallPrompt?'Install Ready2Go':'Show install steps'} <span>→</span></button><button class="button button-outline" data-action="dismiss-install-nudge">Continue in browser</button></div><p class="small-note">Installation requires your confirmation in the browser. Ready2Go does not force-install an app.</p></div></section>`;
 document.body.append(n);requestAnimationFrame(()=>n.classList.add("visible"));
 // Show the first-visit install invitation immediately, then get out of the learner's way after one minute.
 n._autoDismissTimer=window.setTimeout(()=>{if(!n.isConnected)return;safeSessionSet("r2gInstallDismissed","1");n.classList.remove("visible");window.setTimeout(()=>n.remove(),240);},60000);
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
document.addEventListener("change",async e=>{
 if(e.target.matches('input[name="answer"]')){practice.answers[practice.questions[practice.index].id]=e.target.value;await render();}
 if(e.target.matches("#subjectSelect"))refreshTopics();
 if(e.target.matches("#profileState, #profileInstitutionType"))refreshInstitutionOptions();
 if(e.target.matches('#universitySearch, #universityStateFilter, #universityTypeFilter')){const q=$("#universitySearch")?.value||"";const st=$("#universityStateFilter")?.value||"";const ow=$("#universityTypeFilter")?.value||"";const results=$("#universityResults");if(results)results.innerHTML=renderUniversityResults(q,st,ow);}
 if(e.target.matches('input[name="mode"]'))syncSetupMode();
 if(e.target.matches('input[name="mixSubjects"]')){if(e.target.value==="use-of-english"&&!e.target.checked){e.target.checked=true;toast("Use of English stays in your UTME subject set.");}const chosen=$$('input[name="mixSubjects"]:checked').length;if(chosen>4){e.target.checked=false;toast("Choose no more than four subjects.");}updateMixCount();$$(".mix-subject-check").forEach(n=>n.classList.toggle("selected",n.querySelector("input").checked));}
 if(e.target.matches('input[name="selectedSubjects"]')){const chosen=$$('input[name="selectedSubjects"]:checked').length;if(chosen>3){e.target.checked=false;toast("Choose up to three additional subjects. Use of English is included automatically.");}$$(".onboarding-subject-grid .subject-check").forEach(n=>n.classList.toggle("selected",n.querySelector("input").checked));}
 if(e.target.matches('input[name="category"]')){
   $$(".category-card").forEach(n=>n.classList.toggle("selected",n.querySelector("input").checked));
   // Automatically apply a sensible recommendation when the category changes; students can then edit every checkbox.
   const ids=new Set((RECOMMENDED[e.target.value]||[]).slice(0,3));
   const form=$("#profileForm"); if(form) $$('input[name="selectedSubjects"]',form).forEach(cb=>cb.checked=ids.has(cb.value));
 }
});
document.addEventListener("submit",async e=>{
 if(e.target.id==="coachForm"){
   e.preventDefault(); const input=$("#coachInput"); const prompt=String(input?.value||"").trim(); if(!prompt)return;
   coachMessages.push({role:"user",text:prompt}); coachMessages.push({role:"assistant",text:offlineCoachReply(prompt)});
   if(coachMessages.length>20) coachMessages=coachMessages.slice(-20);
   await render(); const history=$("#coachHistory"); if(history)history.scrollTop=history.scrollHeight;
 }
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
window.addEventListener("online",()=>{updateConnectivityChip();toast("You're back online. Cloud account features are available.");});
window.addEventListener("offline",()=>{updateConnectivityChip();toast("You're offline. Cached practice content and local history remain available.");});
window.addEventListener("beforeinstallprompt", event => { event.preventDefault(); deferredInstallPrompt=event; const nudge=$("#installNudge");if(nudge){const cta=nudge.querySelector('[data-action="install-nudge-go"]');if(cta)cta.innerHTML="Install Ready2Go <span>→</span>";} });
window.addEventListener("appinstalled", () => { deferredInstallPrompt=null; $("#installNudge")?.remove();safeSessionSet("r2gInstallDismissed","1");toast("Ready2Go is installed on this device."); });
$("#mobileMenu")?.addEventListener("click",()=>{const sidebar=$("#sidebar"), scrim=$("#sidebarScrim");const open=!sidebar?.classList.contains("mobile-open");sidebar?.classList.toggle("mobile-open",open);scrim?.classList.toggle("active",open);$("#mobileMenu")?.setAttribute("aria-expanded",String(open));});
$("#sidebarScrim")?.addEventListener("click",closeMobileSidebar);
document.addEventListener("keydown",e=>{if(e.key==="Escape"){closeMobileSidebar();if(!$("#authModal")?.classList.contains("hidden"))closeAuth();}});
boot();
