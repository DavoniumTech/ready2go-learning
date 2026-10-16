import { readRecord, writeRecord, deleteRecord } from "./store.js";
import { R2_CONTENT_API_BASE } from "./content-config.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (v="") => String(v).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const CATEGORY_NAMES = { science:"Science", "humanities-arts":"Humanities & Arts", commerce:"Commerce" };
const RECOMMENDED = {
  science: ["mathematics","physics","chemistry","biology","agricultural-science"],
  "humanities-arts": ["government","history","literature-in-english","geography","islamic-studies","christian-religious-knowledge","fine-art"],
  commerce: ["commerce","economics","principles-of-accounts","mathematics","home-economics"]
};
let subjects = [];
let packs = {};
let institutionsData = { states: [], institutions: [], additionalChoices: [] };
let coursesData = { courses: [] };
let questionArchive = { records: [] };
let remoteContentManifest = null;
let deferredInstallPrompt = null;
let profile = { displayName:"", category:"", selectedSubjects:["use-of-english","mathematics"], onboardingCompleted:false, isPreparingForJamb:"yes", state:"", institutionType:"", institutionId:"", institutionName:"", courseId:"", courseName:"", admissionYear:"2027" };
let authUser = null;
let page = "home";
let pendingPage = "home";
let practice = null;
let timerInterval = null;
let authUnsubscribe = null;
let authWatchStarted = false;

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
  try { await loadContent(); }
  catch (error) { console.error(error); toast("Some learning content could not be loaded. Reload while connected to the internet."); }
  profile = await readRecord("profile", profile) || profile;
  const savedTheme = await readRecord("theme", "light");
  setTheme(savedTheme, false);
  if (!profile.selectedSubjects?.length) profile.selectedSubjects = ["use-of-english","mathematics"];
  page = profile.onboardingCompleted ? "home" : "profile";
  render();
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("./sw.js").catch(err => console.warn("Offline worker registration failed", err));
  }
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
  $("#userLabel").textContent = authUser?.displayName || profile.displayName || "Learner";
  $$("[data-page]").forEach(b=>b.classList.toggle("active",b.dataset.page===page));
  const labels={home:"Learning home",subjects:"My subjects","practice-setup":"Practice session",practice:"CBT practice",results:"Session results",progress:"Progress",profile:"Preferences & account","course-guide":"Course & institution guide",syllabus:"Syllabus planner","question-library":"Question library","teacher-partners":"Teacher partners"};
  const sectionLabel=$("#currentSection"); if(sectionLabel) sectionLabel.textContent=labels[page]||"Overview";
  const avatar=$(".avatar-button"); if(avatar) avatar.textContent=(authUser?.displayName||profile.displayName||"R").trim().charAt(0).toUpperCase()||"R";
  if (page === "home") view.innerHTML = await homeView();
  else if (page === "subjects") view.innerHTML = await subjectsView();
  else if (page === "practice-setup") view.innerHTML = setupView();
  else if (page === "practice") view.innerHTML = practiceView();
  else if (page === "results") view.innerHTML = resultsView();
  else if (page === "progress") view.innerHTML = await progressView();
  else if (page === "profile") view.innerHTML = await profileView();
  else if (page === "course-guide") view.innerHTML = courseGuideView();
  else if (page === "syllabus") view.innerHTML = syllabusView();
  else if (page === "question-library") view.innerHTML = questionLibraryView();
  else if (page === "teacher-partners") view.innerHTML = teacherPartnersView();
  else view.innerHTML = await homeView();
  if (page === "profile") refreshInstitutionOptions();
}
async function homeView() {
  const sessions = await getSessions();
  const attempts = sessions.reduce((n,s)=>n+(s.answered ?? s.total),0);
  const correct = sessions.reduce((n,s)=>n+s.score,0);
  const accuracy = attempts ? Math.round(correct/attempts*100) : 0;
  const categoryName = CATEGORY_NAMES[profile.category] || "Not selected yet";
  const recent = sessions[0];
  const pick = subjects.find(s=>s.id==="mathematics");
  return `<section class="welcome-row"><div><p class="eyebrow">READY2GO LEARNING</p><h1>Welcome${profile.displayName ? ", "+esc(profile.displayName.split(/\s+/)[0]) : ""}.</h1><p class="muted lead">Small, consistent practice builds confidence. Choose a subject and begin.</p></div><div class="status-chip"><span class="status-dot"></span> Practice works offline after loading</div></section>
  ${installBannerView()}
  <section class="metric-grid"><article class="metric-card"><span class="metric-label">Questions answered</span><strong>${attempts}</strong><span class="metric-note">Across saved sessions</span></article><article class="metric-card"><span class="metric-label">Overall accuracy</span><strong>${accuracy}%</strong><span class="metric-note">Based on completed practice</span></article><article class="metric-card"><span class="metric-label">Study area</span><strong class="metric-category">${esc(categoryName)}</strong><span class="metric-note">Editable in preferences</span></article></section>
  ${!profile.category ? `<section class="setup-banner"><div class="banner-mark">R2G</div><div class="banner-copy"><h2>Personalise your learning</h2><p>Choose Science, Humanities &amp; Arts, or Commerce. You can change your subjects later, even offline.</p></div><button class="button button-primary" data-action="open-profile">Set preferences</button></section>` : ""}
  <section class="section-head"><div><p class="eyebrow">YOUR LEARNING SPACE</p><h2>Continue learning</h2></div><button class="text-button" data-page="subjects">All subjects <span aria-hidden="true">→</span></button></section>
  <div class="feature-grid"><article class="feature-card feature-primary"><div class="feature-top"><span class="subject-icon">∑</span><span class="pill pill-live">Pilot available</span></div><h3>Mathematics</h3><p>Original practice questions across arithmetic, algebra, geometry, statistics and more.</p><div class="feature-meta"><span>${packs.mathematics?.length||0} original questions</span><span>•</span><span>Topic practice</span></div><button class="button button-light" data-action="start-math">Start practice <span>→</span></button></article><article class="feature-card feature-secondary"><div class="feature-top"><span class="subject-icon coral">Aa</span><span class="pill pill-live">Pilot available</span></div><h3>Use of English</h3><p>Starter questions for grammar, vocabulary and sentence completion.</p><div class="feature-meta"><span>${packs["use-of-english"]?.length||0} original questions</span><span>•</span><span>Original content</span></div><button class="button button-outline" data-action="start-english">Start practice <span>→</span></button></article></div>
  <section class="section-head spaced"><div><p class="eyebrow">KEEP BUILDING MOMENTUM</p><h2>Recent activity</h2></div><button class="text-button" data-page="progress">View progress →</button></section>
  ${recent ? `<article class="recent-card"><div class="recent-icon">✓</div><div class="recent-copy"><strong>${esc(recent.subjectName)}</strong><span>${fmtDate(recent.completedAt)} · ${recent.total} questions</span></div><div class="recent-score"><strong>${recent.score}/${recent.total}</strong><span>${Math.round(recent.score/Math.max(1,recent.total)*100)}% correct</span></div></article>` : `<div class="empty-state compact"><div class="empty-symbol">↗</div><strong>Your practice history starts here</strong><p>Complete a short practice session to see your score and explanations.</p></div>`}`;
}
function subjectIcon(subject) { const name=subject.name; return name==="Mathematics"?"∑":name==="Use of English"?"Aa":name.startsWith("Physics")?"ϕ":name==="Biology"?"⌘":name==="Chemistry"?"⚗":"•"; }
async function subjectsView() {
  const grouped = {science:[],"humanities-arts":[],commerce:[]};
  for (const s of subjects) if(grouped[s.category]) grouped[s.category].push(s);
  const list = (items) => items.map(s=>`<article class="subject-card ${s.available||packs[s.id]?"is-available":"is-coming"}"><div class="subject-icon">${subjectIcon(s)}</div><div class="subject-info"><h3>${esc(s.name)}</h3><p>${s.compulsory?"Compulsory UTME subject · ":""}${hasPackAvailable(s.id)?`${packs[s.id]?.length||"Downloadable"} questions available`:"Question pack in preparation"}</p></div>${hasPackAvailable(s.id)?`<button class="icon-button" title="Practise ${esc(s.name)}" data-action="start-subject" data-subject="${s.id}">→</button>`:`<span class="pill">In preparation</span>`}</article>`).join("");
  return `<section class="page-intro"><p class="eyebrow">SUBJECT LIBRARY</p><h1>Your subjects</h1><p class="muted lead">Choose subjects that match your goals. English is listed separately as a compulsory UTME subject. Recommendations are a starting point, not an official course-combination decision.</p></section>
  <section class="subject-group"><div class="group-heading"><h2>Available now</h2><span class="count-pill">${subjects.filter(s=>hasPackAvailable(s.id)).length} available packs</span></div><div class="subject-grid">${list(subjects.filter(s=>hasPackAvailable(s.id)))}</div></section>
  <section class="subject-group"><div class="group-heading"><h2>Science</h2><span class="count-pill">${grouped.science.length} subjects</span></div><div class="subject-grid">${list(grouped.science.filter(s=>!hasPackAvailable(s.id)))}</div></section>
  <section class="subject-group"><div class="group-heading"><h2>Humanities &amp; Arts</h2><span class="count-pill">${grouped["humanities-arts"].length} subjects</span></div><div class="subject-grid">${list(grouped["humanities-arts"].filter(s=>!hasPackAvailable(s.id)))}</div></section>
  <section class="subject-group"><div class="group-heading"><h2>Commerce</h2><span class="count-pill">${grouped.commerce.length} subjects</span></div><div class="subject-grid">${list(grouped.commerce.filter(s=>!hasPackAvailable(s.id)))}</div></section>
  <p class="small-note">Catalogue is preliminary. We will verify it against the current official JAMB brochure and syllabus before public launch. New content is published only after review.</p>`;
}
function setupView() {
  const active = availableSubjects();
  return `<section class="page-intro"><p class="eyebrow">PRACTICE SESSION</p><h1>Set up your practice</h1><p class="muted lead">Choose your subject, coverage and difficulty. We will not repeat a question within the same session.</p></section><form id="setupForm" class="setup-layout"><div class="setup-main"><div class="form-card"><label for="subjectSelect">Subject</label><select id="subjectSelect" name="subject" class="field">${active.map(s=>`<option value="${s.id}" ${practice?.subjectId===s.id?'selected':''}>${esc(s.name)}</option>`).join("")}</select><label for="topicSelect">Topic</label><select id="topicSelect" name="topic" class="field"><option value="all">All available topics</option></select><label for="questionCount">Number of questions</label><div class="choice-row"><label class="choice"><input type="radio" name="count" value="10" checked><span>10</span></label><label class="choice"><input type="radio" name="count" value="20"><span>20</span></label><label class="choice"><input type="radio" name="count" value="40"><span>40</span></label><label class="choice"><input type="radio" name="count" value="all"><span>All available</span></label></div><label>Difficulty</label><div class="choice-row"><label class="choice"><input type="radio" name="difficulty" value="all" checked><span>Mixed</span></label><label class="choice"><input type="radio" name="difficulty" value="easy"><span>Easy</span></label><label class="choice"><input type="radio" name="difficulty" value="medium"><span>Medium</span></label><label class="choice"><input type="radio" name="difficulty" value="challenging"><span>Challenging</span></label></div><label class="check-row"><input type="checkbox" name="timed"><span><strong>Timed practice</strong><small>Prototype timer: one minute per selected question. This is not an official JAMB timing rule.</small></span></label><button type="submit" class="button button-primary button-wide">Begin practice <span>→</span></button></div></div><aside class="setup-aside"><div class="aside-mark">R2G</div><h3>Practice at your pace</h3><p>Answers and explanations appear after you submit. Your completed session is saved on this device.</p><div class="mini-rule"></div><p class="small-note">Local starter packs include Mathematics, Use of English, Biology, Chemistry, Physics, Economics, Government, Geography, Commerce, Agriculture and Principles of Accounts. Some are draft seeds requiring human review.</p></aside></form>`;
}
function refreshTopics() {
  const subjectId=$("#subjectSelect")?.value; const topicSelect=$("#topicSelect"); if(!topicSelect)return;
  const qs=packs[subjectId]||[]; const topics=[...new Set(qs.map(q=>q.topic))].sort();
  topicSelect.innerHTML='<option value="all">All available topics</option>'+topics.map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join("");
}
async function startPractice(form) {
  const fd=new FormData(form); const subjectId=fd.get("subject");
  await loadPackIfNeeded(subjectId);
  let pool=[...(packs[subjectId]||[])];
  if(fd.get("topic")&&fd.get("topic")!=="all") pool=pool.filter(q=>q.topic===fd.get("topic"));
  if(fd.get("difficulty")&&fd.get("difficulty")!=="all") pool=pool.filter(q=>q.difficulty===fd.get("difficulty"));
  if(!pool.length){toast("No questions match those filters yet. Choose another topic or difficulty.");return;}
  // Fisher-Yates shuffle: randomises the pool without inserting duplicates.
  for(let i=pool.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}
  const requested=fd.get("count")==="all"?pool.length:Number(fd.get("count")||10);
  const asked=Math.min(requested,pool.length);
  if(asked<requested) toast(`Only ${asked} questions match those filters; we will not invent or repeat questions.`);
  practice={subjectId,subjectName:subjects.find(s=>s.id===subjectId)?.name||subjectId,questions:pool.slice(0,asked),answers:{},flagged:[],index:0,timed:fd.has("timed"),startedAt:Date.now(),secondsLeft:asked*60,submitted:false,score:0};
  page="practice"; render(); if(practice.timed) startTimer();
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
  return `<div class="cbt-top"><div><p class="eyebrow">READY2GO CBT PRACTICE</p><h1>${esc(practice.subjectName)}</h1><p class="muted small">Question ${i} of ${n} · ${esc(q.topic)}</p></div><div class="cbt-top-right">${practice.timed?`<div class="timer ${practice.secondsLeft<60?'timer-warning':''}"><span>Time left</span><strong id="timerValue">${formatTime(practice.secondsLeft)}</strong></div>`:`<div class="status-chip"><span class="status-dot"></span> Untimed practice</div>`}<button class="button button-outline" data-action="confirm-end">Finish test</button></div></div><div class="cbt-progress"><span style="width:${Math.round(i/n*100)}%"></span></div><div class="cbt-layout"><section class="question-panel"><div class="question-meta"><span class="question-number">QUESTION ${String(i).padStart(2,"0")}</span><button class="flag-button ${practice.flagged.includes(q.id)?'flagged':''}" data-action="flag-question">${practice.flagged.includes(q.id)?'⚑ Marked for review':'⚐ Mark for review'}</button></div><h2 class="question-text">${esc(q.question)}</h2><div class="options-list">${Object.entries(q.options).map(([key,value])=>`<label class="answer-option ${practice.answers[q.id]===key?'selected':''}"><input type="radio" name="answer" value="${key}" ${practice.answers[q.id]===key?'checked':''}><span class="option-key">${key}</span><span class="option-text">${esc(value)}</span></label>`).join("")}</div><div class="question-nav"><button class="button button-outline" data-action="prev-question" ${practice.index===0?'disabled':''}>← Previous</button><span class="answered-count">${answered} of ${n} answered</span>${practice.index<n-1?`<button class="button button-primary" data-action="next-question">Next question →</button>`:`<button class="button button-primary" data-action="confirm-end">Review &amp; submit</button>`}</div></section><aside class="question-map"><div class="map-heading"><h3>Question navigator</h3><span>${answered}/${n}</span></div><p class="small-note">Select a number to move directly to that question.</p><div class="number-grid">${practice.questions.map((question,idx)=>`<button class="number-button ${idx===practice.index?'current':''} ${practice.answers[question.id]?'answered':''} ${practice.flagged.includes(question.id)?'flagged':''}" data-action="go-question" data-index="${idx}" aria-label="Go to question ${idx+1}">${idx+1}</button>`).join("")}</div><div class="legend"><span><i class="legend-current"></i>Current</span><span><i class="legend-answered"></i>Answered</span><span><i class="legend-flagged"></i>Review</span></div><button class="button button-primary button-wide" data-action="confirm-end">Submit answers</button><p class="small-note">This is an original practice interface, not an official JAMB examination system.</p></aside></div>`;
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
  const session={id:`session-${Date.now()}`,subjectId:practice.subjectId,subjectName:practice.subjectName,total:practice.questions.length,score:practice.score,answered:Object.keys(practice.answers).length,completedAt:new Date().toISOString(),timed:practice.timed,autoSubmitted:auto,items:practice.questions.map(q=>({id:q.id,answer:practice.answers[q.id]||null,correctAnswer:q.correctAnswer}))};
  sessions.unshift(session); await writeRecord("sessions",sessions.slice(0,200));
  let cloudSync = "local";
  if (authUser && navigator.onLine) {
    try {
      const { recordPracticeSummaryRemote } = await import("./firebase.js");
      await recordPracticeSummaryRemote({ sessionId: session.id, subjectId: session.subjectId, subjectName: session.subjectName, total: session.total, answered: session.answered, score: session.score, timed: session.timed, completedAt: session.completedAt });
      cloudSync = "synced";
    } catch (error) { console.info("Practice summary stays local until cloud functions are ready", error); }
  }
  page="results"; await render(); if(auto)toast("Time ended. Your answers have been submitted."); else if(cloudSync === "synced") toast("Practice summary synced to your account.");
}
function resultsView() {
  if(!practice||!practice.submitted)return `<section class="empty-state"><h2>No completed session</h2><button class="button button-primary" data-page="practice-setup">Start practice</button></section>`;
  const score=practice.score; const total=practice.questions.length; const pct=Math.round(score/total*100);
  const headline=pct>=80?"Strong work. Keep practising.":pct>=50?"Good effort. Review the explanations and strengthen the gaps.":"This score is a starting point, not a verdict. Review the solutions and try again.";
  return `<section class="results-hero"><div class="result-symbol">${pct>=80?'✓':pct>=50?'↗':'R2G'}</div><p class="eyebrow">SESSION COMPLETE</p><h1>${score} <span>/ ${total}</span></h1><div class="result-pct">${pct}% correct</div><p class="result-message">${headline}</p><div class="result-stats"><div><strong>${Object.keys(practice.answers).length}</strong><span>Answered</span></div><div><strong>${total-Object.keys(practice.answers).length}</strong><span>Unanswered</span></div><div><strong>${total-score}</strong><span>To review</span></div></div><div class="result-actions"><button class="button button-primary" data-action="review-answers">Review answers</button><button class="button button-outline" data-action="retry">Practise again</button><button class="text-button" data-page="home">Back to dashboard</button></div></section><section id="answerReview" class="answer-review hidden"><div class="section-head"><div><p class="eyebrow">LEARN FROM EVERY QUESTION</p><h2>Answer review</h2></div></div>${practice.questions.map((q,i)=>{const user=practice.answers[q.id];const ok=user===q.correctAnswer;return `<article class="review-card"><div class="review-title"><span class="review-badge ${ok?'correct':'incorrect'}">${ok?'Correct':'Review'}</span><span>Question ${i+1} · ${esc(q.topic)}</span></div><h3>${esc(q.question)}</h3><p class="your-answer">Your answer: <strong>${user?esc(user)+'. '+esc(q.options[user]):'Not answered'}</strong></p><p class="correct-answer">Correct answer: <strong>${q.correctAnswer}. ${esc(q.options[q.correctAnswer])}</strong></p><p class="explanation">${esc(q.explanation)}</p></article>`}).join("")}</section>`;
}
async function progressView() {
 const sessions=await getSessions(); const attempts=sessions.reduce((a,s)=>a+(s.answered ?? s.total),0);const correct=sessions.reduce((a,s)=>a+s.score,0);
 return `<section class="page-intro"><p class="eyebrow">YOUR PROGRESS</p><h1>Practice history</h1><p class="muted lead">Your history is stored on this device in this prototype. Clearing browser data can erase it.</p></section><section class="metric-grid"><article class="metric-card"><span class="metric-label">Completed sessions</span><strong>${sessions.length}</strong></article><article class="metric-card"><span class="metric-label">Questions attempted</span><strong>${attempts}</strong></article><article class="metric-card"><span class="metric-label">Accuracy</span><strong>${attempts?Math.round(correct/attempts*100):0}%</strong></article></section><section class="section-head spaced"><div><h2>Recent sessions</h2></div><button class="text-button" data-action="export-data">Export my local data</button></section>${sessions.length?sessions.map(s=>`<article class="recent-card"><div class="recent-icon">✓</div><div class="recent-copy"><strong>${esc(s.subjectName)}</strong><span>${fmtDate(s.completedAt)} · ${s.total} questions${s.timed?' · timed':''}</span></div><div class="recent-score"><strong>${s.score}/${s.total}</strong><span>${Math.round(s.score/Math.max(1,s.total)*100)}%</span></div></article>`).join(""):`<div class="empty-state"><div class="empty-symbol">↗</div><h2>No practice history yet</h2><p>Finish your first session to see your results here.</p><button class="button button-primary" data-page="practice-setup">Start a session</button></div>`}<section class="danger-zone"><div><h3>Clear local practice history</h3><p>This removes the saved sessions from this browser only.</p></div><button class="button button-danger" data-action="clear-history">Clear history</button></section>`;
}
async function profileView() {
 const selected=new Set(profile.selectedSubjects||[]);
 const subjectChecks=subjects.filter(s=>s.id!=="use-of-english").map(s=>`<label class="subject-check"><input type="checkbox" name="selectedSubjects" value="${s.id}" ${selected.has(s.id)?'checked':''}><span>${esc(s.name)}</span>${packs[s.id]?'<small>Pack ready</small>':(s.available?'<small>Pack planned</small>':'')}</label>`).join("");
 const categoryMarkup=Object.entries(CATEGORY_NAMES).map(([id,name])=>`<label class="category-card ${profile.category===id?'selected':''}"><input type="radio" name="category" value="${id}" ${profile.category===id?'checked':''} required><span class="category-symbol">${id==='science'?'∑':id==='commerce'?'₦':'Aa'}</span><strong>${name}</strong><small>${id==='science'?'Science-focused subjects':id==='commerce'?'Business and accounting interests':'Arts, languages and humanities'}</small></label>`).join("");
 const stateOpts=(institutionsData.states||[]).map(state=>`<option value="${esc(state)}" ${profile.state===state?'selected':''}>${esc(state)}</option>`).join("");
 const courseOpts=(coursesData.courses||[]).map(c=>`<option value="${esc(c.id)}" ${profile.courseId===c.id?'selected':''}>${esc(c.name)}</option>`).join("");
 return `<section class="page-intro"><p class="eyebrow">YOUR PERSONAL STUDY PLAN</p><h1>Let's prepare for your next step.</h1><p class="muted lead">Tell Ready2Go what you're aiming for. Your choices stay editable, and your subject preferences can be changed offline.</p></section>
 ${installBannerView()}
 <form id="profileForm" class="profile-layout"><div class="form-card onboarding-card">
 <label for="displayName">What should we call you?</label><input id="displayName" name="displayName" class="field" value="${esc(profile.displayName||authUser?.displayName||'')}" placeholder="Your name" maxlength="80">
 <label for="isPreparingForJamb">Are you preparing for JAMB UTME?</label><select id="isPreparingForJamb" name="isPreparingForJamb" class="field"><option value="yes" ${profile.isPreparingForJamb!=='no'&&profile.isPreparingForJamb!=='exploring'?'selected':''}>Yes, I am preparing for UTME</option><option value="exploring" ${profile.isPreparingForJamb==='exploring'?'selected':''}>I'm exploring my options</option><option value="no" ${profile.isPreparingForJamb==='no'?'selected':''}>Not yet</option></select>
 <label>Which study area sounds closest to your goal?</label><div class="category-cards">${categoryMarkup}</div>
 <div class="onboarding-divider"><span>YOUR TARGET COURSE</span></div>
 <label for="profileState">State / FCT where the institution is located</label><select id="profileState" name="state" class="field"><option value="">Select a state or FCT</option>${stateOpts}</select>
 <label for="profileInstitutionType">Institution type</label><select id="profileInstitutionType" name="institutionType" class="field"><option value="">Choose institution type</option><option value="Federal" ${profile.institutionType==='Federal'?'selected':''}>Federal university</option><option value="State" ${profile.institutionType==='State'?'selected':''}>State university</option><option value="Other" ${profile.institutionType==='Other'?'selected':''}>Private / other university or not listed</option><option value="other-tertiary" ${profile.institutionType==='other-tertiary'?'selected':''}>College / Polytechnic / other tertiary institution</option><option value="undecided" ${profile.institutionType==='undecided'?'selected':''}>I haven't chosen an institution</option></select>
 <label for="profileInstitution">Institution</label><select id="profileInstitution" name="institutionId" class="field"><option value="">Choose state and institution type first</option></select><label for="profileInstitutionName">Institution name (if you selected Other)</label><input id="profileInstitutionName" name="institutionName" class="field" value="${esc(profile.institutionName||'')}" placeholder="Enter institution name if not listed" maxlength="160">
 <label for="profileCourse">Course / programme you're considering</label><select id="profileCourse" name="courseId" class="field"><option value="">Select a course</option>${courseOpts}<option value="other-course" ${profile.courseId==='other-course'?'selected':''}>Other / not listed</option></select><label for="profileCourseName">Course name (if not listed)</label><input id="profileCourseName" name="courseName" class="field" value="${esc(profile.courseName||'')}" placeholder="Enter course name if not listed" maxlength="120">
 <div class="guidance-alert"><strong>Important admission guidance</strong><p>Course availability, UTME subject combinations and cut-off marks depend on institution and admission year. Ready2Go will not invent a cut-off mark. Confirm your exact course using the official JAMB eligibility checker.</p><a href="https://eligibility.jamb.gov.ng/" target="_blank" rel="noopener noreferrer">Open JAMB IBASS Eligibility Checker ↗</a></div>
 <div class="subject-pick-heading"><div><h2>Choose your subjects</h2><p class="muted small">These are editable study preferences, not official course eligibility advice.</p></div><button type="button" class="text-button" data-action="use-recommendations">Suggest by study area</button></div><div class="subject-check-grid">${subjectChecks}</div><p class="small-note">Use of English is selected as a common UTME subject. Verify the current requirements for your programme.</p>
 <button type="submit" class="button button-primary button-wide">Save my study plan <span>→</span></button></div>
 <aside class="setup-aside polygon-aside"><div class="aside-mark">R2G</div><h3>Your plan can change with you</h3><p>Switch courses, change institutions or edit subjects later—your preferences are stored on this device for offline access.</p><div class="mini-rule"></div><h3>Official course checks</h3><p class="small-note">The local directory is a starter list, not a complete list of every institution or approved programme. Official eligibility checks take priority.</p><a class="button button-outline button-wide" href="https://eligibility.jamb.gov.ng/" target="_blank" rel="noopener noreferrer">Check eligibility ↗</a></aside></form>
 <section class="account-card"><div><p class="eyebrow">ACCOUNT</p><h2>${authUser?"Connected account":"Sign in or create an account"}</h2><p class="muted">${authUser?`Signed in as ${esc(authUser.email||'')}. Preferences and practice history remain local until cloud sync is configured.`:"You can practise as a guest. An internet connection is needed to create or access an account."}</p></div><button class="button button-outline" data-action="open-auth">${authUser?'Account options':'Sign in / Sign up'}</button></section>`;
}
function refreshInstitutionOptions() {
 const state = $("#profileState")?.value || "";
 const type = $("#profileInstitutionType")?.value || "";
 const select = $("#profileInstitution"); if (!select) return;
 let options = (institutionsData.institutions||[]).filter(i => (!state || i.state===state) && (!['Federal','State'].includes(type) || i.ownership===type));
 const selected = profile.institutionId || "";
 let html='<option value="">Select an institution</option>';
 for (const institution of options) html += `<option value="${esc(institution.id)}" ${selected===institution.id?'selected':''}>${esc(institution.name)} — ${esc(institution.ownership)}</option>`;
 if (type==='Other') html += `<option value="other-university" ${selected==='other-university'?'selected':''}>Other / private university (not in this starter list)</option>`;
 if (type==='other-tertiary') html += `<option value="college-polytechnic" ${selected==='college-polytechnic'?'selected':''}>College / Polytechnic / other tertiary institution</option>`;
 if (type==='undecided') html += `<option value="undecided-institution" ${selected==='undecided-institution'?'selected':''}>Not chosen yet</option>`;
 if (!sizeType(type)) html += `<option value="other-university" ${selected==='other-university'?'selected':''}>Other institution / not listed</option>`;
 select.innerHTML=html;
}
function sizeType(type) { return ["Other", "other-tertiary", "undecided"].includes(type); }
function courseGuideView() {
 const state=(institutionsData.states||[]).length;
 const inst=(institutionsData.institutions||[]).length;
 const count=(coursesData.courses||[]).length;
 return `<section class="page-intro"><p class="eyebrow">PLAN YOUR NEXT STEP</p><h1>Course &amp; institution guide</h1><p class="muted lead">Start from your preferred institution and course, then verify programme eligibility using JAMB's official checker.</p></section><div class="feature-grid guide-grid"><article class="feature-card feature-primary"><div class="feature-top"><span class="subject-icon">⌖</span><span class="pill">Directory seed</span></div><h3>Institutions across Nigeria</h3><p>${inst} curated federal/state university entries across ${state} states and the FCT are included as a starter directory. It is not a complete national list; private institutions and colleges can be entered manually.</p><button class="button button-light" data-action="open-profile">Choose institution in my plan →</button></article><article class="feature-card feature-secondary"><div class="feature-top"><span class="subject-icon coral">Aa</span><span class="pill">Search starter</span></div><h3>Explore programmes</h3><p>${count} common course names help you find your interest. The catalogue does not claim each institution offers every course.</p><button class="button button-outline" data-action="open-ibass">Verify on JAMB IBASS ↗</button></article></div><section class="section-head spaced"><div><p class="eyebrow">ADMISSION REQUIREMENTS</p><h2>How to verify your course</h2></div></section><div class="guide-steps"><article><span>01</span><div><h3>Select entry mode and institution</h3><p>Use the exact university or tertiary institution you intend to apply to.</p></div></article><article><span>02</span><div><h3>Choose the specific programme</h3><p>Course titles can look similar but have different requirements at different institutions.</p></div></article><article><span>03</span><div><h3>Check the UTME subjects and O'Level rules</h3><p>Follow the current official result and subject requirements; do not rely only on broad study-area recommendations.</p></div></article><article><span>04</span><div><h3>Confirm the current admission year</h3><p>Requirements, programme availability and cut-off policies can change. Ready2Go will show source dates for any future verified record.</p></div></article></div><div class="guidance-alert"><strong>Cut-off mark policy</strong><p>No cut-off marks are prefilled in this build. We will display a figure only when its institution, programme, admission year, official source URL and verification date are stored together.</p><a href="https://eligibility.jamb.gov.ng/" target="_blank" rel="noopener noreferrer">Open official JAMB IBASS Eligibility Checker ↗</a></div>`;
}
function syllabusView() {
 return `<section class="page-intro"><p class="eyebrow">STUDY WITH A PLAN</p><h1>Syllabus planner</h1><p class="muted lead">Use the official JAMB syllabus to choose topics, then practise from Ready2Go's available question packs. We won't pretend an unverified topic checklist is the official syllabus.</p></section><div class="feature-card feature-primary syllabus-hero"><div class="feature-top"><span class="subject-icon">▤</span><span class="pill pill-live">Official source</span></div><h3>JAMB IBASS e-Syllabus</h3><p>Open the current syllabus and confirm the topics for your selected subject before creating a revision plan.</p><a class="button button-light" href="https://ibass.jamb.gov.ng/e-syllabus" target="_blank" rel="noopener noreferrer">Open official e-syllabus ↗</a></div><section class="section-head spaced"><div><p class="eyebrow">AVAILABLE PRACTICE CONTENT</p><h2>Choose a subject to practise</h2></div><button class="text-button" data-page="subjects">Browse subject library →</button></section><div class="subject-grid">${subjects.map(s=>`<article class="subject-card ${packs[s.id]?'is-available':'is-coming'}"><div class="subject-icon">${subjectIcon(s)}</div><div class="subject-info"><h3>${esc(s.name)}</h3><p>${packs[s.id]?`${packs[s.id].length} local questions · source labels included`:'Question pack not downloaded/included'}</p></div>${hasPackAvailable(s.id)?`<button class="icon-button" data-action="start-subject" data-subject="${s.id}" aria-label="Practise ${esc(s.name)}">→</button>`:'<span class="pill">Planned</span>'}</article>`).join("")}</div><p class="small-note">The current local packs contain original Ready2Go questions. Draft packs require subject-matter review. No official 2020 bank is bundled.</p>`;
}
function questionLibraryView() {
 const rows=subjects.map(s=>{const pack=(packs[s.id]||[]);const meta=(remoteContentManifest?.packs||[]).find(p=>p.subjectId===s.id||p.id===s.id);const r2Note=meta?(meta.status==='published'?' · R2 published version':' · R2 seed is not published'):'';const reviewNote=pack.length?(pack.some(q=>q.reviewStatus==='needs_human_review')?'draft review required':pack.some(q=>q.reviewStatus==='internal_pilot')?'internal pilot—review before launch':'approved content'):'';return `<article class="recent-card"><div class="recent-icon">${pack.length?'✓':'+'}</div><div class="recent-copy"><strong>${esc(s.name)}</strong><span>${pack.length?`${pack.length} questions available on this build · ${reviewNote}`:'No local pack in this build'}${r2Note}</span></div>${pack.length?`<button class="button button-outline" data-action="start-subject" data-subject="${s.id}">Practise</button>`:'<span class="pill">Planned</span>'}</article>`;}).join("");
 const archived=(questionArchive.records||[]).filter(r=>r.requestedYear===2020);
 return `<section class="page-intro"><p class="eyebrow">CONTENT TRANSPARENCY</p><h1>Question library</h1><p class="muted lead">Each item must have a reliable source, answer key, explanation, topic mapping and review status. Original questions are never labelled as past JAMB questions.</p></section><div class="guidance-alert"><strong>About the requested 2020 papers and set text</strong><p>This starter does not reproduce the full 2020 JAMB papers or the full text of <em>The Lekki Headmaster</em>. Those materials must be sourced with appropriate rights. This archive records what is awaiting verification; the original practice bank below is separately labelled.</p></div><section class="section-head"><div><h2>Local question packs</h2></div><span class="count-pill">${Object.values(packs).reduce((n,p)=>n+p.length,0)} questions</span></section>${rows}<section class="section-head spaced"><div><h2>2020 source archive</h2><p class="muted small">${archived.length} subjects tracked · not included as JAMB past questions</p></div></section><div class="guidance-alert"><p>Records are marked <strong>rights/source review required</strong> and contain no reproduced past questions. Add only authorised content with source details.</p><a href="https://ibass.jamb.gov.ng/e-syllabus" target="_blank" rel="noopener noreferrer">Check official syllabus ↗</a></div><section class="section-head spaced"><div><h2>The Lekki Headmaster</h2></div></section><p class="muted">The set-text record is a metadata placeholder only. We must verify the book's prescription for the relevant UTME year and use only licensed or otherwise lawfully usable text. We can create original study questions after that review.</p>`;
}
function teacherPartnersView() {
 return `<section class="page-intro"><p class="eyebrow">GROW THROUGH TRUST</p><h1>Teacher partner programme</h1><p class="muted lead">Ready2Go plans to work with individual teachers who voluntarily recommend useful practice materials to their students. There is no school partnership programme in this version.</p></section><div class="feature-card feature-primary"><div class="feature-top"><span class="subject-icon">↗</span><span class="pill">Design stage</span></div><h3>Teacher referrals are not active yet</h3><p>The current app does not track paid referrals, calculate real commissions or send payouts. We will enable the programme only after referral attribution, verified payments, refund handling, anti-fraud checks and partner terms are implemented and tested.</p><div class="feature-meta"><span>Individual teachers only</span><span>•</span><span>No guaranteed earnings</span></div><button class="button button-light" data-action="teacher-plan">View planned programme safeguards</button></div><div class="guide-steps" id="teacherPlanDetails"><article><span>01</span><div><h3>Unique referral link or code</h3><p>Every approved teacher has a unique code; first-touch attribution rules are published before launch.</p></div></article><article><span>02</span><div><h3>Only verified eligible sales count</h3><p>Registration alone is not a commission. Refunds, duplicate events and suspicious activity must be handled.</p></div></article><article><span>03</span><div><h3>Transparent commission ledger</h3><p>The teacher can see referred registrations, eligible sales, pending amount and paid amount. Calculations must be idempotent.</p></div></article><article><span>04</span><div><h3>Lawful payout method</h3><p>Payouts only start after the payment and payout provider, age/account eligibility, partner identity and relevant legal requirements are satisfied.</p></div></article></div><p class="small-note">Do not use a school’s name or logo as a partner without express permission. Do not promise income. Partner programme needs human/legal review before publication.</p>`;
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
 if(authUser){try{const {signOutUser}=await import("./firebase.js");await signOutUser();authUser=null;closeAuth();render();toast("You have signed out.");}catch(err){msg.textContent=err.message;}return;}
 submit.disabled=true;submit.textContent="Please wait…";msg.textContent="";
 try {
   const mod=await import("./firebase.js"); let user;
   if(mode==="signup") user=await mod.registerWithEmail({name,email,password}); else user=await mod.signInWithEmail({email,password});
   authUser=user; if(user.displayName)profile.displayName=user.displayName; await writeRecord("profile",profile);closeAuth();await render();toast(mode==="signup"?"Your account was created.":"Welcome back.");
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
   if(user.displayName) profile.displayName=user.displayName;
   await writeRecord("profile",profile);
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
 if(action==="start-math"){page="practice-setup";practice={subjectId:"mathematics"};await render();$("#subjectSelect").value="mathematics";refreshTopics();}
 else if(action==="start-english"){page="practice-setup";practice={subjectId:"use-of-english"};await render();$("#subjectSelect").value="use-of-english";refreshTopics();}
 else if(action==="start-subject"){const id=button.dataset.subject;await loadPackIfNeeded(id);if(packs[id]?.length){page="practice-setup";practice={subjectId:id};await render();$("#subjectSelect").value=id;refreshTopics();}else toast("This subject has no downloadable pack yet. Choose another subject for now.");}
 else if(action==="open-profile"){page="profile";closeMobileSidebar();await render();refreshInstitutionOptions();}
 else if(action==="open-auth")openAuth();
 else if(action==="open-ibass")window.open("https://eligibility.jamb.gov.ng/","_blank","noopener,noreferrer");
 else if(action==="teacher-plan"){const el=$("#teacherPlanDetails");el?.scrollIntoView({behavior:"smooth",block:"start"});}
 else if(action==="install-app")await installApp();
 else if(action==="install-help")showInstallInstructions();
 else if(action==="use-recommendations"){const f=$("#profileForm");if(!f)return;const selected=f.querySelector('input[name="category"]:checked')?.value||profile.category;if(!selected){toast("Choose a study area first.");return;}const ids=new Set(["use-of-english",...(RECOMMENDED[selected]||[])]);$$('input[name="selectedSubjects"]',f).forEach(cb=>cb.checked=ids.has(cb.value));}
 else if(action==="prev-question"){practice.index=Math.max(0,practice.index-1);await render();}
 else if(action==="next-question"){practice.index=Math.min(practice.questions.length-1,practice.index+1);await render();}
 else if(action==="go-question"){practice.index=Number(button.dataset.index);await render();}
 else if(action==="flag-question"){const id=practice.questions[practice.index].id;practice.flagged=practice.flagged.includes(id)?practice.flagged.filter(v=>v!==id):[...practice.flagged,id];await render();}
 else if(action==="confirm-end")confirmFinish();
 else if(action==="review-answers"){const r=$("#answerReview");r?.classList.remove("hidden");r?.scrollIntoView({behavior:"smooth",block:"start"});}
 else if(action==="retry"){const s=practice.subjectId;page="practice-setup";practice={subjectId:s};await render();$("#subjectSelect").value=s;refreshTopics();}
 else if(action==="export-data")exportData();
 else if(action==="clear-history"){if(confirm("Delete the saved practice history from this browser? This cannot be undone.")){await deleteRecord("sessions");await render();toast("Local practice history cleared.");}}
}

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
 deferredInstallPrompt.prompt();
 try {
  const choice=await deferredInstallPrompt.userChoice;
  if (choice?.outcome === "accepted") toast("Installation started. Follow your browser's confirmation.");
  else toast("No problem. You can install Ready2Go later.");
 } catch { toast("Open your browser's install option to add Ready2Go."); }
 deferredInstallPrompt=null;
 if(page==='home') render();
}
function showInstallInstructions() {
 const message = isIosSafari()
  ? "On iPhone or iPad: open Ready2Go in Safari, tap Share, then choose Add to Home Screen. iOS does not allow a website to force this prompt."
  : "In Chrome or Edge, use the browser's Install app option if available. The browser controls the native prompt; Ready2Go cannot force-install without your confirmation. If the option is missing, check HTTPS and the PWA install requirements. On desktop, look for the install icon in the address bar or menu.";
 toast(message);
}
function closeMobileSidebar() {
 const sidebar=$("#sidebar"), scrim=$("#sidebarScrim");
 sidebar?.classList.remove("mobile-open");
 scrim?.classList.remove("active");
 $("#mobileMenu")?.setAttribute("aria-expanded","false");
}

document.addEventListener("click",async e=>{
 const nav=e.target.closest("[data-page]"); if(nav){const next=nav.dataset.page;if(next==="practice-setup"&&page==="practice"&&!practice?.submitted){if(!confirm("Leave this practice session? Unsaved answers will be lost."))return;clearInterval(timerInterval);}page=next;if(page==="practice-setup")practice=null;closeMobileSidebar();await render();if(page==="practice-setup")refreshTopics();if(page==="profile")refreshInstitutionOptions();return;}
 const button=e.target.closest("[data-action]");if(button){await handleAction(button);return;}
 if(e.target.closest("#themeToggle")){const next=document.documentElement.dataset.theme==="dark"?"light":"dark";setTheme(next);await writeRecord("theme",next);}
});
document.addEventListener("change",async e=>{
 if(e.target.matches('input[name="answer"]')){practice.answers[practice.questions[practice.index].id]=e.target.value;await render();}
 if(e.target.matches("#subjectSelect"))refreshTopics();
 if(e.target.matches("#profileState, #profileInstitutionType"))refreshInstitutionOptions();
 if(e.target.matches('input[name="category"]')){
   $$(".category-card").forEach(n=>n.classList.toggle("selected",n.querySelector("input").checked));
   // Automatically apply a sensible recommendation when the category changes; students can then edit every checkbox.
   const ids=new Set(["use-of-english",...(RECOMMENDED[e.target.value]||[])]);
   const form=$("#profileForm"); if(form) $$('input[name="selectedSubjects"]',form).forEach(cb=>cb.checked=ids.has(cb.value));
 }
});
document.addEventListener("submit",async e=>{
 if(e.target.id==="setupForm"){e.preventDefault();await startPractice(e.target);}
 if(e.target.id==="profileForm"){
   e.preventDefault();const fd=new FormData(e.target);const cat=fd.get("category");const checked=fd.getAll("selectedSubjects");
   const institutionId=String(fd.get("institutionId")||"");
   const institution=(institutionsData.institutions||[]).find(i=>i.id===institutionId);
   const courseId=String(fd.get("courseId")||"");
   const course=(coursesData.courses||[]).find(c=>c.id===courseId);
   profile={...profile,displayName:String(fd.get("displayName")||"").trim(),category:cat,selectedSubjects:["use-of-english",...checked],isPreparingForJamb:String(fd.get("isPreparingForJamb")||"yes"),state:String(fd.get("state")||""),institutionType:String(fd.get("institutionType")||""),institutionId,institutionName:String(fd.get("institutionName")||"").trim()||institution?.name||((institutionId==='other-university'||institutionId==='college-polytechnic')?'Other / not listed':''),courseId,courseName:String(fd.get("courseName")||"").trim()||course?.name||"",admissionYear:"2027",onboardingCompleted:true};await writeRecord("profile",profile);
   // Local-first save is immediate. Optional cloud sync works only after Functions are deployed.
   let profileCloudSynced=false;
   if(authUser && navigator.onLine){
     try{const {saveLearnerProfileRemote}=await import("./firebase.js");await saveLearnerProfileRemote({displayName:profile.displayName,category:profile.category,selectedSubjects:profile.selectedSubjects,isPreparingForJamb:profile.isPreparingForJamb,state:profile.state,institutionType:profile.institutionType,institutionId:profile.institutionId,institutionName:profile.institutionName,courseId:profile.courseId,courseName:profile.courseName,admissionYear:profile.admissionYear});profileCloudSynced=true;}catch(err){console.info("Profile remains local until cloud functions are deployed",err);}
   }
   // Keep the profile name in Firebase Authentication when the learner is signed in.
   let accountNameSaved=true;
   if(authUser&&profile.displayName&&profile.displayName!==authUser.displayName){try{const {updateUserDisplayName}=await import("./firebase.js");authUser=await updateUserDisplayName(profile.displayName);}catch(err){accountNameSaved=false;console.warn("Could not update Firebase display name",err);}}
   page="home";await render();toast(!accountNameSaved?"Preferences are saved locally, but the account name could not sync.":(authUser&&!profileCloudSynced?"Study plan saved on this device. Cloud sync will be available when the backend is deployed.":(profileCloudSynced?"Your study plan is saved on this device and synced to your account.":"Your study plan is saved on this device.")));
 }
 if(e.target.id==="authForm")submitAuth(e);
});
$("#authClose")?.addEventListener("click",closeAuth);
$("#authBackdrop")?.addEventListener("click",closeAuth);
$("#authSwitch")?.addEventListener("click",e=>{e.preventDefault();switchAuthMode();});
$("#resetPassword")?.addEventListener("click",e=>{e.preventDefault();resetPassword();});
$("#googleSignIn")?.addEventListener("click",()=>submitGoogleAuth());
window.addEventListener("online",()=>toast("You're back online. Account services are available."));
window.addEventListener("offline",()=>toast("You're offline. Downloaded practice content remains available."));
window.addEventListener("beforeinstallprompt", event => { event.preventDefault(); deferredInstallPrompt=event; if(page==='home'||page==='profile') render(); });
window.addEventListener("appinstalled", () => { deferredInstallPrompt=null; toast("Ready2Go is installed on this device."); if(page==='home'||page==='profile') render(); });
$("#mobileMenu")?.addEventListener("click",()=>{const sidebar=$("#sidebar"), scrim=$("#sidebarScrim");const open=!sidebar?.classList.contains("mobile-open");sidebar?.classList.toggle("mobile-open",open);scrim?.classList.toggle("active",open);$("#mobileMenu")?.setAttribute("aria-expanded",String(open));});
$("#sidebarScrim")?.addEventListener("click",closeMobileSidebar);
document.addEventListener("keydown",e=>{if(e.key==="Escape"){closeMobileSidebar();if(!$("#authModal")?.classList.contains("hidden"))closeAuth();}});
boot();
