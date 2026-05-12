# Heimdall — Engineering Documentation

This directory is a single reviewable engineering briefing on the Heimdall
application. It is written for an Amazon technical audience. No marketing
language; every claim points to a specific file in the repository.

## Document set

| # | Title | Purpose |
|---|---|---|
| 01 | [Overview](./01-overview.md) | One-page summary: problem, users, surface, non-goals. |
| 02 | [Architecture](./02-architecture.md) | AWS resources, data flow, request lifecycle, boundaries. |
| 03 | [Security & Authorization](./03-security.md) | AuthN/Z model, trust boundaries, data handling, PII posture. |
| 04 | [Features](./04-features.md) | Per-feature deep dive with inputs, algorithms, outputs. |
| 05 | [Build, Deploy & Operations](./05-operations.md) | Toolchain, CI/CD path, observability, runbook gaps. |
| 06 | [Risks & Roadmap](./06-risks-and-roadmap.md) | Known defects, technical debt, the path to GA. |
| 07 | [Architecture & User Journey](./07-architecture-and-journey.md) | DDD-aligned metro map + reviewable DynamoDB schema. |

## How to read this

- Start with **01-overview.md** for the two-minute version.
- Skim **06-risks-and-roadmap.md** before the architecture doc if you want to
  know what breaks first under scrutiny.
- Every file is standalone; cross-references are by link.

## Conventions

- File paths are relative to the repository root.
- Commit SHAs refer to the `main` branch of this repository.
- "Cognito" refers to the Amazon Cognito User Pool provisioned by Amplify.
- "DDB" refers to the Amazon DynamoDB tables provisioned by the Amplify data
  layer.

## Scope of this review

Code reviewed corresponds to `main` at commit `e3fd751` (May 12, 2026). The
application is a **single-page web app plus an AWS Amplify Gen 2 backend**.
It is an internal tool in active development; a production hardening pass
has not been completed. Sections 03, 05, and 06 call out what is not yet
production-ready and why.
