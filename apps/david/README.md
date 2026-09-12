# David

David is the public/commercial website for the Goliath Project Management Tracker.

## Canonical platform direction

David is being migrated from the legacy ChatGPT Sites deployment to the same controlled delivery stack as Goliath:

- Source control: GitHub (`DipurajThapa/DnG`)
- Hosting: Vercel
- Application backend / identity / database where required: Neon
- Goliath production application: https://goliath-project-management-tracker.vercel.app/

## Current legacy site

Legacy David Site:

https://david.dippurajthapa.chatgpt.site/

This URL remains the current reference until the GitHub/Vercel replacement passes acceptance and cutover is approved.

## Migration boundary

The native ChatGPT Sites source checkout is not exportable through the currently available Site/Library interface. Therefore this directory is the canonical migration destination, but it does not pretend that the original Site source code has been exported byte-for-byte.

The migration will reconstruct the current David experience using the recovered implementation inventory and visible live-site content, then validate routes and handoffs before cutover.

## David → Goliath contract

Every production `Open workspace`, sign-in/workspace continuation, or Project Management Tracker CTA must resolve to:

https://goliath-project-management-tracker.vercel.app/

Tracker-specific legacy `EDAPOS` wording must be replaced with `Goliath`. Historical references that describe an older system or migration context may remain when clearly labelled.
