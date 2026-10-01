# Use the existing React and Vite SPA, with public pages rendered by the backend

Date: 2026-09-03
Supersedes: ADR 0004
Closes: W22

SUPERSEDED by ADR 0056 on 2026-09-07. The stack choice is unchanged - React,
Vite, Tailwind, with public pages rendered by the NestJS backend - and 0056
carries the deployment reasoning and the public-page section forward intact.
What failed is this ADR's opening premise: the existing SPA is not working
screens but a mock-data tools-hub shell for a different product, so the
dashboard is a greenfield build rather than an adoption. Retained unedited as
the original record.

ADR 0004 specified Next.js. A working React 19, Vite, and Tailwind 4 single
page application already exists with campaign, campaign detail, settings,
sidebar, and protected-route screens. Following 0004 as written means
discarding it and rebuilding the same screens.

The dashboard is built on the existing React and Vite application. ADR 0004 is
superseded.

Next.js earns its cost through server rendering, routing conventions, and
search visibility. The dashboard is entirely behind authentication, so search
visibility is irrelevant and server rendering buys nothing a client-rendered
application does not already provide. The deployment settles it: both frontend
and backend are self-hosted on one VPS, where a Vite build is static files the
existing reverse proxy serves directly, while Next.js would require operating a
second Node process for no benefit.

The public pages are a different problem and do not belong in the SPA. Hosted
RSVP, unsubscribe, and one-click unsubscribe endpoints are rendered by the
NestJS backend and served on the customer's branded domains. They must work
without JavaScript, must respond correctly to a mail client's automated
unsubscribe request, and must be fast on first byte from a link click in an
email. Those are server-rendering requirements met by the backend that already
owns the tokens and the suppression state, and routing them through a separate
frontend application would add a hop and a failure mode for no gain.

Accepted cost: two rendering models in one product. It is a smaller cost than it
appears, because the boundary is not arbitrary - it separates the authenticated
application from the unauthenticated pages that recipients reach from an email,
and those already differ in domain, in audience, and in what they are allowed
to depend on.

Carried over from the existing repository: it lives under a personal GitHub
account rather than the company organisation. It moves to the Growth-Infi
organisation before it becomes the project frontend, for the reason recorded in
W23.
