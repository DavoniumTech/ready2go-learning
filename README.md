# Ready2Go Learning v1.0.0

Ready2Go Learning is an installable, offline-first UTME preparation PWA from Davonium Technologies. It uses vanilla HTML, CSS and JavaScript modules. The updated interface has first-visit guided onboarding, separate learning pages, responsive navigation, animated study artwork, light/dark modes, a dismissible install reminder after 60 seconds, editable four-subject plans, CBT-style practice and a Nigerian university guide.

## Current test-release contents
- 25 UTME subject options drawn from JAMB's 2026 Training Manual subject list.
- 1,020 Ready2Go Original draft question records: 40 in each of 24 non-Mathematics packs and 60 in Mathematics.
- 328 institution entries from the NUC Nigerian University System directory as checked on 16 October 2026 (77 federal, 69 state and 182 private entries).
- Source-linked admission guidance. The 2026 score table contains national minimum benchmarks only, not every programme-specific course cut-off.
- Offline app-shell cache and local practice history after content has been cached on the device.

## Important content and launch notes
All 1,020 question records need human subject-matter and answer-key review. They are not official JAMB past questions. This release does not contain the complete official 2020 JAMB question archive or the full text of *The Lekki Headmaster*. No pack is approved for R2 remote publication yet. Do not change draft status to published until content, provenance and use rights have been reviewed.

The institution list is a directory baseline, not a proof that every programme is offered at every institution. Confirm the intended course and UTME subject combination in the official JAMB IBASS checker. The cut-off table must not be interpreted as course-specific admission advice.

## Official references
- [JAMB 2026 Training Manual](https://www.jamb.gov.ng/PDFs/2026/2026%20TRAINING%20MANUAL%20%20final.pdf)
- [JAMB e-Syllabus](https://ibass.jamb.gov.ng/e-syllabus)
- [JAMB IBASS Eligibility Checker](https://eligibility.jamb.gov.ng/)
- [NUC Nigerian University System directory](https://enuc.nuc.edu.ng/nus)

## Testing
Serve the repository over HTTP, not by opening `index.html` with `file://`:

```bat
py -m http.server 8000
```

Open `http://localhost:8000`. Google sign-in requires the deployment hostname to be listed in Firebase Authentication → Settings → Authorized domains. Browser-controlled native PWA installation may not be available on every browser; Ready2Go shows install instructions when a direct native prompt cannot be used.

This is a production-oriented test release candidate, not a guarantee of completed browser/device, subject-matter, legal or security certification. Review the release audit and deployment quickstart in the complete bundle before public launch.


## v1.0.0 mobile and learning refinements

- Installation invitation appears immediately, auto-dismisses after 60 seconds if ignored, and remains dismissible; the browser controls actual installation.
- New learners see the account entry screen before onboarding; study-plan completion is required before navigating to learning pages.
- Mobile CBT uses a compact, scrollable question navigator and sticky previous/next controls.
- Added 80- and 100-question request options; the engine only selects existing unique questions and reports the actual available count.
- Added subject/topic accuracy summaries from saved question-level attempts.
- Replaced hero student photo placements with lightweight CSS-drawn study illustrations.
- Removed the teacher-partner navigation entry from the student app.
- Content remains draft: current packs contain 40 questions each except Mathematics (60); they are not official JAMB papers and require expert review.
