# Institution, course and admission guidance data

The current `data/institutions.json` is a curated **starter seed of 75 federal/state institution entries** across Nigeria's 36 states and the FCT. It is not a complete register of all universities, colleges, polytechnics or private institutions, and each entry still needs current programme-level verification. The official NUC directory is https://enuc.nuc.edu.ng/nus .

`data/courses.json` contains common programme names to help users express an interest. It deliberately does not map each course to every institution. The same course name may not be offered at a chosen institution or may have a different approved title. Do not interpret this list as a current admissions catalogue.

`data/cutoff-marks.json` has no verified records. Do not display a score as a cutoff until its institution, exact programme, admission year, source URL, retrieval/verification date and any category/context are documented. Cutoff marks can vary by programme and admission cycle.

Use the official JAMB Eligibility Checker for the exact institution, programme, entry mode, O'Level requirements and UTME subject combination: https://eligibility.jamb.gov.ng/ . The student must select the intended admission year and check the exact programme. The app's broad Science / Humanities & Arts / Commerce suggestions are personalised study preferences only, not official eligibility decisions.

When adding or updating a record:

1. Confirm the institution is currently recognised/listed in the relevant official source.
2. Verify the exact programme is available at that institution for the chosen admission cycle.
3. Obtain the subject combination and O'Level requirements from IBASS or another authoritative JAMB source.
4. Add source URLs, verified date, admission year, and review status.
5. Leave unverified fields blank and direct the learner to IBASS rather than guessing.

Private universities, colleges and polytechnics are represented by an `Other / not listed` or institution-type path until the list is verified and expanded.
