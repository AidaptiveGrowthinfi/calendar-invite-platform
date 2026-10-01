# Build the React and Vite dashboard new, hosted on the VPS

Date: 2026-09-07
Supersedes: ADR 0053
Refs: 0001, 0006, 0053, W22

ADR 0053 chose React and Vite over Next.js and gave two reasons. The second one
holds. The first was false, and it was the one carrying the cost argument.

0053 opened: "A working React 19, Vite, and Tailwind 4 single page application
already exists with campaign, campaign detail, settings, sidebar, and
protected-route screens. Following 0004 as written means discarding it and
rebuilding the same screens."

Inspection of `C:\growthInfi\Frontend` on 2026-09-07 does not support that.
796 lines across twelve source files, and:

- No screen calls an API. There is no `fetch`, no HTTP client, and no API base
  URL. Every screen renders a hardcoded array - four campaigns all named
  "Test", three sender accounts all `test@gmail.com`, seven days of chart data.
- The protected routes do not exist. `ProtectedRoutes`, `PublicRoutes`, and
  `RootRedirect` all import `../auth/useAuth`; there is no `src/auth`
  directory. Nothing imports the three guards, which is why the build still
  succeeds. `RootRedirect.jsx:5` destructures `useAuth` without calling it.
- The campaign screen is not reachable. `/campaign` renders a `ToolRedirect`
  that sends the browser to `VITE_PIPELINE_TOOLS_URL/bulk-calendar`.
  `CampaignDetails.jsx`, the only substantial file at 381 lines, is never
  routed.
- It is a different product. "Emails sent vs replies", "Reply rate", a
  "Sequence" tab, and `{{first_name}}` subject and body templating describe a
  cold-email sequencer. This product sends calendar invitations and measures
  attendance; it has no replies and no sequences (CONTEXT.md).

It is a tools-hub shell that links out to other GrowthInfi tools, with a mock
dashboard attached. There is no working UI, so there is nothing to discard by
rebuilding, and 0053's premise cannot support its conclusion.

## The decision, on the reason that survives

The dashboard is React, Vite, and Tailwind, built new.

The reason is deployment, which 0053 already stated correctly and which the
product owner confirmed on 2026-09-07: frontend and backend are both
self-hosted on one VPS under ADR 0006. A Vite build is static files the
existing reverse proxy serves directly. Next.js would mean operating a second
Node process beside the NestJS application on the same box, for server
rendering that an entirely authenticated dashboard does not need and search
visibility it cannot use. Nothing about the hosting model makes the framework
choice consequential, which is itself the argument for the cheaper one.

Everything in 0053 about public pages carries over unchanged. Hosted RSVP,
unsubscribe, and one-click unsubscribe are rendered by the NestJS backend on
the customer's branded domains, because they must work without JavaScript,
answer a mail client's automated unsubscribe correctly, and be fast on first
byte from an email link. The accepted cost of two rendering models carries over
with it, on the same reasoning.

## What actually carries over from the existing repository

The stack choice, and nothing that runs. The Tailwind visual vocabulary is
usable as a starting palette if it is liked, and the CSV upload and
column-mapping interaction in `CampaignDetails.jsx` is a usable sketch for the
audience import in ADR 0024. Both are references, not code to keep.

The repository still lives under a personal GitHub account and still must move
to the Growth-Infi organisation, per W23. That obligation is unaffected by
whether its contents are kept.

## Consequence, and it is not small

The dashboard is a greenfield build, not an adoption. Campaign creation,
audience import with mapping and rejection review, mailbox connection, send
plan approval, deliverability status, and attendance reporting are all screens
that do not exist in any form.

W1, MVP build scope, was deferred by the product owner on the basis that scope
depends on available warmed-up mailboxes. This ADR removes an item the estimate
was implicitly crediting. It does not reopen W1 by itself, but it is the second
recorded reason to - mailbox count does not change how long the dashboard takes
to build either.
