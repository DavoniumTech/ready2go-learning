# Ready2Go question-bank standard v1

## Required question fields

Every question is a JSON object with:

- `id`: stable unique ID within every published pack (never recycle an ID).
- `subjectId`: exact subject ID from `data/subjects.json`.
- `topic`: topic label mapped to the current official JAMB syllabus.
- `type`: currently `multiple_choice`.
- `sourceType`: `ready2go_original`, or a permitted past-question source type after rights verification.
- `sourceLabel`: learner-visible provenance, such as `Ready2Go Original` or a verified source/year label. Never claim an original item is an official JAMB item.
- `difficulty`: one of the values used by the app (`easy`, `medium`, `challenging`).
- `question`: the question stem.
- `options`: non-empty strings for `A`, `B`, `C`, and `D`.
- `correctAnswer`: exactly one of `A`, `B`, `C`, `D`.
- `explanation`: a reasoned explanation that supports the answer.
- `reviewStatus`: `needs_human_review`, `internal_pilot`, or `approved`. Only `approved` questions are accepted in a remotely published pack.

Pack-level fields include `schemaVersion`, `subjectId`, `subjectName`, `sourcePolicy`, `packVersion`, `status`, `questionCount`, and `questions`. The count must exactly equal the array length. All question IDs must be unique. Every question must belong to the pack's subject.

## Source and rights controls

1. Map topics against the current JAMB IBASS e-syllabus: https://ibass.jamb.gov.ng/e-syllabus . Record the examination-year/source version you used.
2. Write original questions in your own language and mark them `Ready2Go Original`. Do not reproduce JAMB past questions merely because they are publicly sold or available online; confirm permission or another valid legal basis first.
3. Do not include the full text of *The Lekki Headmaster* or reproduce a question set drawn from it unless the appropriate rights/legal basis is verified. We may author independently written, syllabus-appropriate questions and explanations only after the set-text, author and rights details are confirmed.
4. Have a subject-matter reviewer check the answer, ambiguity, difficulty, explanation, syllabus alignment, spelling, and age/learner suitability. Record reviewer, date, and issue resolution in a separate review log before public release.
5. The R2 Worker only serves pack entries whose manifest `status` is exactly `published`. Do not change a status merely to test the API. Use a separate test bucket or pack when necessary.

## Minimum quality checks

- All A-D options are present and distinct where appropriate.
- One clearly correct answer; distractors are plausible but not misleading.
- Explanation teaches a useful step or concept, not only repeats the answer.
- No duplicate IDs and no accidental repeats within one practice session.
- Source attribution, licence/permission notes, syllabus mapping, review and approval status are recorded.
- Re-run JSON and pack-integrity checks after every content edit.
