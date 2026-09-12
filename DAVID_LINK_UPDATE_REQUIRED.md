# David website Goliath handoff

Target Goliath URL:

`https://goliath-project-management-tracker.vercel.app/`

## Required live-site changes

The saved David implementation audit identifies the website handoff as:

`/workspace` → fixed external EDAPOS Project Management Tracker link.

The editable David website implementation previously referenced `app/workspace/page.tsx` and shared site navigation/header files.

When the live David source becomes writable, update only Project Management Tracker references:

1. Replace the old EDAPOS Project Management Tracker destination with the Goliath production URL above.
2. Change tracker-specific visible `EDAPOS` wording around that handoff to `Goliath`.
3. Re-check shared `Open workspace` links/navigation for the same old tracker destination.
4. Do not replace historical or unrelated EDAPOS references that describe a different product/system/context.
5. Validate `/workspace`, header/footer workspace links, redirects and browser navigation after publish.

## Current blocker

The connected GitHub account does not expose a David website repository, and the native ChatGPT Site projection available in Library is read-only from this execution environment. Therefore this repository records the exact required change but does **not** claim that the live David site has been modified.
