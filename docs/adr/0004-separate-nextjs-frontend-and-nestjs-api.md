# Use a separate Next.js frontend and NestJS API

SUPERSEDED by ADR 0053 on 2026-09-03. The dashboard uses the existing React
and Vite SPA; public RSVP and unsubscribe pages are rendered by the NestJS
backend. Retained unedited as the original record.

We will keep the frontend and backend as separate applications in the same repository: a Next.js TypeScript frontend for product workflows, and a NestJS TypeScript API for durable domain logic, integrations, and background workers. The platform has complex sending, planning, retry, and audit behavior that should not be forced into Next.js API routes or coupled to page rendering.
