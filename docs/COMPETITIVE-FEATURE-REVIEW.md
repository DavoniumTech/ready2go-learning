# Ready2Go Learning — Competitive Feature Review (16 October 2026)

## Scope and caution

This is a desk review of publicly available app listings and product pages, not a hands-on test of every app. Search visibility and claims on store pages are not independently verified. Some products may change availability or features. It is not a definitive ranking by downloads. We do not copy competitor code, graphics, question wording, branding, or copyrighted question banks.

## 20 products and platforms surfaced

1. **Myschool CBT App** — large question catalogue, offline practice, answer explanations, videos, bookmarks/search, performance review, academic guidance. Source: https://myschool.ng/download-the-myschool-app
2. **Myschool CBT Software for Windows** — desktop CBT simulator, offline resources, history, explanations. Source: https://myschool.ng/download-the-myschool-computer-software
3. **TestDriller JAMB CBT** — offline practice, worked explanations, AI tutor, flashcards, video lessons, subject/topic modes, performance review, dark mode. Source: https://play.google.com/store/apps/details?id=com.iafsawii.testdriller
4. **Jambite: JAMB CBT with AI** — offline-first practice, timed modes, question explanations, analytics, history and weak-area insights. Source: https://play.google.com/store/apps/details?id=com.jambite.app
5. **JAMB Pro** — year-organised questions, four-subject timed mocks, explanations and offline access. Source: https://jambproapp.com/
6. **Awajis JAMB CBT** — offline Android/PC, subject/topic/year/custom mocks, exam-style navigation, topic analytics. Source: https://jambcbt.awajis.com/offline/
7. **ExamGuide JAMB UTME CBT** — listed in current public 2027 comparison roundups. Feature details should be verified directly before adopting. Source: https://lekkiheadmaster.com/jamb-cbt-practice-apps/
8. **Examscholars CBT Practice** — listed in current public 2027 comparison roundups. Feature details should be verified directly before adopting. Source: https://lekkiheadmaster.com/jamb-cbt-practice-apps/
9. **JAMB LFX CBT Practice / LFX EDU** — offline question practice and wider student product suite. Source: https://lfxedu.com/
10. **DTW JAMB CBT Practice** — listed in current public comparison roundups; verify detailed feature claims directly. Source: https://lekkiheadmaster.com/jamb-cbt-practice-apps/
11. **BTB JAMB CBT Practice Offline** — large question-bank claims, subject coverage, topic practice, study resources and offline chatbot. Source: https://play.google.com/store/apps/details?id=com.iafsawii.btb.utme
12. **Jambixo: JAMB Practice Offline** — offline practice, mock tests and practice tracking. Source: https://play.google.com/store/apps/details?id=com.cbt.jambixo
13. **Offline CBT Practice (JOE Technologies)** — timed offline tests, question navigation, flagging, explanations and printable result sheets. Source: https://play.google.com/store/apps/details?id=com.cbtexam.practice
14. **Flashlearners** — cited in current comparison coverage as a recognised preparation product; verify exact current feature availability before implementation. Source: https://thetoasta.com/blog/best-jamb-cbt-app-2026
15. **Class54** — cited in current comparison coverage for a large question catalogue and subscription model; verify exact current feature availability before implementation. Source: https://thetoasta.com/blog/best-jamb-cbt-app-2026
16. **TheToasta CBT** — cited for worked explanations, offline mode and local-language explanation features. Source: https://thetoasta.com/blog/best-jamb-cbt-app-2026
17. **ExamBuddie** — publishes a 2026 comparison of JAMB preparation apps and evaluation criteria such as real questions, timed simulation, explanations and low-data usability. Source: https://exambuddie.app/blog/best-jamb-app-nigeria-2026
18. **ExamPass** — browser-based multi-exam preparation platform. Source: https://exampass.com.ng/blog/best-cbt-app-nigeria/
19. **Kinteron** — public site describes topic practice, history and offline resources across its exam-prep products. Source: https://kinteron.com/
20. **Examkits JAMB CBT App** — app listing describes offline preparation. Source: https://www.appbrain.com/app/jamb-cbt-app-examkits/com.shooface.starnet

## Ten product ideas to apply to Ready2Go

1. **Fast, realistic CBT controls:** previous/next arrows, direct question-number navigation, answered/unanswered/flagged states, a visible timer and clear submit confirmation.
2. **Independent subject sessions:** let a student complete Mathematics, return to the dashboard, and continue Biology later; never require a four-subject session.
3. **Four-subject mock mode:** allow a combined session using exactly the learner's selected four-subject plan, while preserving individual subject practice.
4. **Honest question counts:** offer 10, 20, 40, 80, 100 and “all available”; do not repeat questions or pretend unavailable questions exist.
5. **Question explanations:** explain why the correct option is right and make answer review a first-class flow. Every explanation and answer key must be checked.
6. **Offline-first operation:** cache the app shell and let downloaded question packs and local history work without continuous connectivity.
7. **Personal performance history:** record every attempt, calculate subject accuracy, identify weak topics from sufficient attempts, and recommend revision without shaming learners.
8. **Progress graphs:** show trend and per-subject accuracy using accessible, lightweight CSS/SVG charts that work on low-end phones.
9. **Responsive, native-feeling interface:** safe-area-aware layouts, touch targets, sticky question controls, reduced-motion support and small code-drawn study illustrations.
10. **Trust and data transparency:** label original questions as original, label verified past questions with the correct year and source, clearly date admission guidance, and avoid presenting a practice estimate as an official JAMB score.

## Important implementation limits in v0.4.1

- The question-count selector can request 80 or 100, but the current packs do **not** contain 100 questions per subject. Current local packs contain 40 per subject except Use of English and Mathematics, which contain 60 each (1,040 total draft records across 25 subjects). The engine intentionally caps a session at available unique questions and informs the learner.
- All local question packs remain Ready2Go Original draft/internal-pilot content and need expert subject review and answer-key verification. They are not official JAMB past questions.
- “Practice by year” cannot honestly be enabled for these packs because they do not have verified past-paper year provenance. Add it when licensed/authorised year-labelled content is ready.
- The official UTME score is not calculated by simply scaling an arbitrary practice percentage to 400. This build reports actual practice results and per-subject accuracy; an official-style score should only be added after its exact scoring rules are verified.
- The installation prompt is optional and browser-controlled. Ready2Go cannot force-install itself; on browsers without a native prompt it provides instructions.
- Firebase account creation/sign-in depends on valid Firebase project configuration and network access. Local practice data is still stored on the device; cloud syncing should be tested against the deployed Functions before being promised as guaranteed.

## Public research sources

- Public 2026 comparison of Myschool, Flashlearners, Class54, TestDriller and TheToasta: https://thetoasta.com/blog/best-jamb-cbt-app-2026
- Public 2027 comparison of Awajis, TestDriller, ExamGuide, Examscholars, LFX and DTW: https://lekkiheadmaster.com/jamb-cbt-practice-apps/
- Myschool app features: https://myschool.ng/download-the-myschool-app
- TestDriller public listing: https://play.google.com/store/apps/details?id=com.iafsawii.testdriller
- Jambite public listing: https://play.google.com/store/apps/details?id=com.jambite.app
- JAMB Pro public product page: https://jambproapp.com/
