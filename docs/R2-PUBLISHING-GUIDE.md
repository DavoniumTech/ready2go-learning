# R2 question-pack publishing design (prototype)

Bucket: `ready2go-question-packs`

The bucket is private. Keep it private while the app is being tested.

## Important publishing rule

A browser app cannot securely read a private R2 bucket using secret credentials. Never place an R2 access key, secret key, Cloudflare API token, Firebase service-account key, or payment secret in browser JavaScript.

Before public content downloads are enabled, choose one of these architectures:

1. **Published-only public bucket/custom domain**: use a bucket containing only content intended for public download. Do not upload drafts, answer-bank master files that must remain private, customer data, or secrets to this bucket.
2. **Cloudflare Worker with an R2 binding**: keep the bucket private and build a small read-only endpoint that returns only approved pack objects. Add caching, object allow-lists, request limits and appropriate CORS. The Worker is not implemented in this prototype.

Because question packs must reach student devices, downloaded questions can ultimately be copied by a determined user. Do not treat pack delivery as a way to keep published answer keys secret. Keep authoring drafts and any sensitive operational data separate from public packs.

## Current prototype files

- `data/manifest.json`
- `data/subjects.json`
- `data/mathematics.json`
- `data/use-of-english.json`

This app loads the JSON files from its own static bundle at present. The R2 integration is intentionally not active yet. After local testing, we can upload the approved packs and implement remote updates with version checks and safe fallback to the last working local pack.
