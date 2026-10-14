import { readRecord, writeRecord, deleteRecord } from "./store.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (v="") => String(v).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const CATEGORY_NAMES = { science:"Science", "humanities-arts":"Humanities & Arts", commerce:"Commerce" };
const RECOMMENDED = {
  science: ["mathematics","physics","chemistry","biology","agricultural-science","computer-studies"],
  "humanities-arts": ["government","history","literature-in-english","geography","islamic-studies","christian-religious-knowledge","fine-art"],
  commerce: ["commerce","economics","principles-of-accounts","mathematics","home-economics"]
};
let subjects = [];
let packs = {};
let profile = { displayName:"", category:"", selectedSubjects:["use-of-english","mathematics"], onboardingCompleted:false };
let authUser = null;
let page = "home";
let pendingPage = "home";
let practice = null;
let timerInterval = null;
let authUnsubscribe = null;
let authWatchStarted = false;

async function loadContent() {
  const [subjectData, mathPack, englishPack] = await Promise.all([
    fetch("./data/subjects.json").then(r => { if(!r.ok) throw new Error("Subjects could not be loaded"); return r.json(); }),
    fetch("./data/mathematics.json").then(r => r.json()),
    fetch("./data/use-of-english.json").then(r => r.json())
  ]);
  subjects = subjectData.subjects;
  packs.mathematics = mathPack.questions;
  packs["use-of-english"] = englishPack.questions;
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
function availableSubjects() { return subjects.filter(s => s.available || packs[s.id]); }
function getSessions() { return readRecord("sessions", []); }
function fmtDate(value) { try { return new Intl.DateTimeFormat(undefined,{dateStyle:"medium"}).format(new Date(value)); } catch { return "Recent"; } }
async function render() {
  const view = $("#view");
  $("#userLabel").textContent = authUser?.displayName || profile.displayName || "Learner";
  $$("[data-page]").forEach(b=>b.classList.toggle("active",b.dataset.page===page));
  const labels={home:"Overview",subjects:"My subjects","practice-setup":"Practice session",practice:"CBT practice",results:"Session results",progress:"Progress",profile:"Preferences & account"};
  const sectionLabel=$("#currentSection"); if(sectionLabel) sectionLabel.textContent=labels[page]||"Overview";
  const avatar=$(".avatar-button"); if(avatar) avatar.textContent=(authUser?.displayName||profile.displayName||"R").trim().charAt(0).toUpperCase()||"R";
  if (page === "home") view.innerHTML = await homeView();
  else if (page === "subjects") view.innerHTML = await subjectsView();
  else if (page === "practice-setup") view.innerHTML = setupView();
  else if (page === "practice") view.innerHTML = practiceView();
  else if (page === "results") view.innerHTML = resultsView();
  else if (page === "progress") view.innerHTML = await progressView();
  else if (page === "profile") view.innerHTML = await profileView();
  else view.innerHTML = await homeView();
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
  <section class="metric-grid"><article class="metric-card"><span class="metric-label">Questions answered</span><strong>${attempts}</strong><span class="metric-note">Across saved sessions</span></article><article class="metric-card"><span class="metric-label">Overall accuracy</span><strong>${accuracy}%</strong><span class="metric-note">Based on completed practice</span></article><article class="metric-card"><span class="metric-label">Study area</span><strong class="metric-category">${esc(categoryName)}</strong><span class="metric-note">Editable in preferences</span></article></section>
  ${!profile.category ? `<section class="setup-banner"><div class="banner-mark">R2G</div><div class="banner-copy"><h2>Personalise your learning</h2><p>Choose Science, Humanities &amp; Arts, or Commerce. You can change your subjects later, even offline.</p></div><button class="button button-primary" data-action="open-profile">Set preferences</button></section>` : ""}
  <section class="section-head"><div><p class="eyebrow">YOUR LEARNING SPACE</p><h2>Continue learning</h2></div><button class="text-button" data-page="subjects">All subjects <span aria-hidden="true">→</span></button></section>
  <div class="feature-grid"><article class="feature-card feature-primary"><div class="feature-top"><span class="subject-icon">∑</span><span class="pill pill-live">Pilot available</span></div><h3>Mathematics</h3><p>Original practice questions across arithmetic, algebra, geometry, statistics and more.</p><div class="feature-meta"><span>${packs.mathematics?.length||0} pilot questions</span><span>•</span><span>Topic practice</span></div><button class="button button-light" data-action="start-math">Start practice <span>→</span></button></article><article class="feature-card feature-secondary"><div class="feature-top"><span class="subject-icon coral">Aa</span><span class="pill pill-live">Pilot available</span></div><h3>Use of English</h3><p>Starter questions for grammar, vocabulary and sentence completion.</p><div class="feature-meta"><span>${packs["use-of-english"]?.length||0} pilot questions</span><span>•</span><span>Original content</span></div><button class="button button-outline" data-action="start-english">Start practice <span>→</span></button></article></div>
  <section class="section-head spaced"><div><p class="eyebrow">KEEP BUILDING MOMENTUM</p><h2>Recent activity</h2></div><button class="text-button" data-page="progress">View progress →</button></section>
  ${recent ? `<article class="recent-card"><div class="recent-icon">✓</div><div class="recent-copy"><strong>${esc(recent.subjectName)}</strong><span>${fmtDate(recent.completedAt)} · ${recent.total} questions</span></div><div class="recent-score"><strong>${recent.score}/${recent.total}</strong><span>${Math.round(recent.score/Math.max(1,recent.total)*100)}% correct</span></div></article>` : `<div class="empty-state compact"><div class="empty-symbol">↗</div><strong>Your practice history starts here</strong><p>Complete a short practice session to see your score and explanations.</p></div>`}`;
}
function subjectIcon(subject) { const name=subject.name; return name==="Mathematics"?"∑":name==="Use of English"?"Aa":name.startsWith("Physics")?"ϕ":name==="Biology"?"⌘":name==="Chemistry"?"⚗":"•"; }
async function subjectsView() {
  const grouped = {science:[],"humanities-arts":[],commerce:[]};
  for (const s of subjects) if(grouped[s.category]) grouped[s.category].push(s);
  const list = (items) => items.map(s=>`<article class="subject-card ${s.available||packs[s.id]?"is-available":"is-coming"}"><div class="subject-icon">${subjectIcon(s)}</div><div class="subject-info"><h3>${esc(s.name)}</h3><p>${s.compulsory?"Compulsory UTME subject · ":""}${s.available||packs[s.id]?`${packs[s.id]?.length||0} original pilot questions`:"Question pack in preparation"}</p></div>${s.available||packs[s.id]?`<button class="icon-button" title="Practise ${esc(s.name)}" data-action="start-subject" data-subject="${s.id}">→</button>`:`<span class="pill">In preparation</span>`}</article>`).join("");
  return `<section class="page-intro"><p class="eyebrow">SUBJECT LIBRARY</p><h1>Your subjects</h1><p class="muted lead">Choose subjects that match your goals. English is listed separately as a compulsory UTME subject. Recommendations are a starting point, not an official course-combination decision.</p></section>
  <section class="subject-group"><div class="group-heading"><h2>Available now</h2><span class="count-pill">2 pilot banks</span></div><div class="subject-grid">${list(subjects.filter(s=>s.available||packs[s.id]))}</div></section>
  <section class="subject-group"><div class="group-heading"><h2>Science</h2><span class="count-pill">${grouped.science.length} subjects</span></div><div class="subject-grid">${list(grouped.science.filter(s=>!s.available&&!packs[s.id]))}</div></section>
  <section class="subject-group"><div class="group-heading"><h2>Humanities &amp; Arts</h2><span class="count-pill">${grouped["humanities-arts"].length} subjects</span></div><div class="subject-grid">${list(grouped["humanities-arts"].filter(s=>!s.available&&!packs[s.id]))}</div></section>
  <section class="subject-group"><div class="group-heading"><h2>Commerce</h2><span class="count-pill">${grouped.commerce.length} subjects</span></div><div class="subject-grid">${list(grouped.commerce.filter(s=>!s.available&&!packs[s.id]))}</div></section>
  <p class="small-note">Catalogue is preliminary. We will verify it against the current official JAMB brochure and syllabus before public launch. New content is published only after review.</p>`;
}
function setupView() {
  const active = availableSubjects();
  return `<section class="page-intro"><p class="eyebrow">PRACTICE SESSION</p><h1>Set up your practice</h1><p class="muted lead">Choose your subject, coverage and difficulty. We will not repeat a question within the same session.</p></section><form id="setupForm" class="setup-layout"><div class="setup-main"><div class="form-card"><label for="subjectSelect">Subject</label><select id="subjectSelect" name="subject" class="field">${active.map(s=>`<option value="${s.id}" ${practice?.subjectId===s.id?'selected':''}>${esc(s.name)}</option>`).join("")}</select><label for="topicSelect">Topic</label><select id="topicSelect" name="topic" class="field"><option value="all">All available topics</option></select><label for="questionCount">Number of questions</label><div class="choice-row"><label class="choice"><input type="radio" name="count" value="10" checked><span>10</span></label><label class="choice"><input type="radio" name="count" value="20"><span>20</span></label><label class="choice"><input type="radio" name="count" value="all"><span>All available</span></label></div><label>Difficulty</label><div class="choice-row"><label class="choice"><input type="radio" name="difficulty" value="all" checked><span>Mixed</span></label><label class="choice"><input type="radio" name="difficulty" value="easy"><span>Easy</span></label><label class="choice"><input type="radio" name="difficulty" value="medium"><span>Medium</span></label><label class="choice"><input type="radio" name="difficulty" value="challenging"><span>Challenging</span></label></div><label class="check-row"><input type="checkbox" name="timed"><span><strong>Timed practice</strong><small>Prototype timer: one minute per selected question. This is not an official JAMB timing rule.</small></span></label><button type="submit" class="button button-primary button-wide">Begin practice <span>→</span></button></div></div><aside class="setup-aside"><div class="aside-mark">R2G</div><h3>Practice at your pace</h3><p>Answers and explanations appear after you submit. Your completed session is saved on this device.</p><div class="mini-rule"></div><p class="small-note">Question packs currently included: Mathematics and Use of English. The full UTME catalogue is being prepared; other subject packs are not yet available.</p></aside></form>`;
}
function refreshTopics() {
  const subjectId=$("#subjectSelect")?.value; const topicSelect=$("#topicSelect"); if(!topicSelect)return;
  const qs=packs[subjectId]||[]; const topics=[...new Set(qs.map(q=>q.topic))].sort();
  topicSelect.innerHTML='<option value="all">All available topics</option>'+topics.map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join("");
}
function startPractice(form) {
  const fd=new FormData(form); const subjectId=fd.get("subject");
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
  page="results"; await render(); if(auto)toast("Time ended. Your answers have been submitted.");
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
 const subjectChecks=subjects.filter(s=>s.id!=="use-of-english").map(s=>`<label class="subject-check"><input type="checkbox" name="selectedSubjects" value="${s.id}" ${selected.has(s.id)?'checked':''}><span>${esc(s.name)}</span>${s.available||packs[s.id]?'<small>Available</small>':''}</label>`).join("");
 return `<section class="page-intro"><p class="eyebrow">YOUR PREFERENCES</p><h1>Personalise Ready2Go</h1><p class="muted lead">These settings are saved locally and can be changed offline. We add Use of English automatically as a standard recommendation, but students should verify their own requirements.</p></section><form id="profileForm" class="profile-layout"><div class="form-card"><label for="displayName">Name</label><input id="displayName" name="displayName" class="field" value="${esc(profile.displayName||authUser?.displayName||'')}" placeholder="What should we call you?" maxlength="80"><label>Which category best describes your study area?</label><div class="category-cards">${Object.entries(CATEGORY_NAMES).map(([id,name])=>`<label class="category-card ${profile.category===id?'selected':''}"><input type="radio" name="category" value="${id}" ${profile.category===id?'checked':''} required><span class="category-symbol">${id==='science'?'∑':id==='commerce'?'₦':'Aa'}</span><strong>${name}</strong><small>${id==='science'?'Science-focused subjects':id==='commerce'?'Business and accounting interests':'Arts, languages and humanities'}</small></label>`).join("")}</div><div class="section-head subject-pick-heading"><div><h2>Choose your subjects</h2><p class="muted small">Recommended selections are editable. English is kept separately as a common UTME requirement.</p></div><button type="button" class="text-button" data-action="use-recommendations">Use recommendations</button></div><div class="subject-check-grid">${subjectChecks}</div><button type="submit" class="button button-primary button-wide">Save preferences</button></div><aside class="setup-aside"><div class="aside-mark">R2G</div><h3>Recommendations, not restrictions</h3><p>Choosing a category helps suggest subjects. It does not determine the correct UTME combination for your intended course or university.</p><p class="small-note">Before exam registration, verify requirements using the current official JAMB brochure and your chosen institution's requirements.</p></aside></form><section class="account-card"><div><p class="eyebrow">ACCOUNT</p><h2>${authUser?"Connected account":"Sign in or create an account"}</h2><p class="muted">${authUser?`Signed in as ${esc(authUser.email||'')}. Your local practice data is not automatically synchronised yet.`:"You can practise as a guest. An internet connection is needed to create or access an account."}</p></div><button class="button button-outline" data-action="open-auth">${authUser?'Account options':'Sign in / Sign up'}</button></section>`;
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
 else if(action==="start-subject"){const id=button.dataset.subject;if(packs[id]){page="practice-setup";practice={subjectId:id};await render();$("#subjectSelect").value=id;refreshTopics();}else toast("This subject's reviewed question pack is still being prepared.");}
 else if(action==="open-profile"){page="profile";await render();}
 else if(action==="open-auth")openAuth();
 else if(action==="use-recommendations"){const f=$("#profileForm");if(!f)return;const selected=f.querySelector('input[name="category"]:checked')?.value||profile.category;if(!selected){toast("Choose Science, Humanities & Arts, or Commerce first.");return;}const ids=new Set(["use-of-english",...(RECOMMENDED[selected]||[])]);$$('input[name="selectedSubjects"]',f).forEach(cb=>cb.checked=ids.has(cb.value));}
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

document.addEventListener("click",async e=>{
 const nav=e.target.closest("[data-page]"); if(nav){const next=nav.dataset.page;if(next==="practice-setup"&&page==="practice"&&!practice?.submitted){if(!confirm("Leave this practice session? Unsaved answers will be lost."))return;clearInterval(timerInterval);}page=next;if(page==="practice-setup")practice=null;await render();if(page==="practice-setup")refreshTopics();return;}
 const button=e.target.closest("[data-action]");if(button){await handleAction(button);return;}
 if(e.target.closest("#themeToggle")){const next=document.documentElement.dataset.theme==="dark"?"light":"dark";setTheme(next);await writeRecord("theme",next);}
});
document.addEventListener("change",async e=>{
 if(e.target.matches('input[name="answer"]')){practice.answers[practice.questions[practice.index].id]=e.target.value;await render();}
 if(e.target.matches("#subjectSelect"))refreshTopics();
 if(e.target.matches('input[name="category"]')){
   $$(".category-card").forEach(n=>n.classList.toggle("selected",n.querySelector("input").checked));
   // Automatically apply a sensible recommendation when the category changes; students can then edit every checkbox.
   const ids=new Set(["use-of-english",...(RECOMMENDED[e.target.value]||[])]);
   const form=$("#profileForm"); if(form) $$('input[name="selectedSubjects"]',form).forEach(cb=>cb.checked=ids.has(cb.value));
 }
});
document.addEventListener("submit",async e=>{
 if(e.target.id==="setupForm"){e.preventDefault();startPractice(e.target);}
 if(e.target.id==="profileForm"){
   e.preventDefault();const fd=new FormData(e.target);const cat=fd.get("category");const checked=fd.getAll("selectedSubjects");
   profile={...profile,displayName:String(fd.get("displayName")||"").trim(),category:cat,selectedSubjects:["use-of-english",...checked],onboardingCompleted:true};await writeRecord("profile",profile);
   // Keep the profile name in Firebase Authentication when the learner is signed in.
   let accountNameSaved=true;
   if(authUser&&profile.displayName&&profile.displayName!==authUser.displayName){try{const {updateUserDisplayName}=await import("./firebase.js");authUser=await updateUserDisplayName(profile.displayName);}catch(err){accountNameSaved=false;console.warn("Could not update Firebase display name",err);}}
   page="home";await render();toast(accountNameSaved?"Your preferences are saved on this device.":"Local preferences saved, but the account name could not sync. Try again online.");
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
boot();
