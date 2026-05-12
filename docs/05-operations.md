# 05 — Build, Deploy & Operations

## Toolchain

| Concern | Tool | Version |
|---|---|---|
| Language | TypeScript | 5.9.3 |
| UI framework | React | 19.2 |
| Bundler | Vite | 7.2 |
| Routing | react-router-dom | 7.12 |
| Backend IaC | `@aws-amplify/backend` + AWS CDK | 1.21 / 2.234 |
| Lint | ESLint + typescript-eslint | 9.39 / 8.46 |
| Package manager | npm (lockfile present) | — |

Source: `package.json` lines 11–55.

## Scripts

```
npm run dev      # vite dev server (HMR) at http://localhost:5173
npm run build    # vite production build to dist/
npm run lint     # eslint . over ts/tsx
npm run preview  # preview production build locally
```

## TypeScript configuration

- `tsconfig.json` — project references only (`tsconfig.app.json`,
  `tsconfig.node.json`).
- `tsconfig.app.json` — strict mode on, `noUnusedLocals`,
  `noUnusedParameters`, `erasableSyntaxOnly`, `noFallthroughCasesInSwitch`,
  `noUncheckedSideEffectImports`, `verbatimModuleSyntax`,
  `moduleResolution: bundler`. Target `ES2022`. Libs: `ES2022`, `DOM`,
  `DOM.Iterable`. `noEmit: true`.

## Vite configuration

Minimal. `@vitejs/plugin-react` only (`vite.config.ts`). No custom
`manualChunks`, no code-splitting hints. The resulting bundle is a single
large JS file — see the warning at the bottom of `npm run build`:

```
dist/assets/index-*.js   1,842.21 kB │ gzip: 568.35 kB
```

At the current scale this is tolerable but it will hurt load time on
constrained corporate networks. Splitting out the XLSX/JSZip/recharts
dependencies into async chunks would meaningfully reduce initial payload.

## ESLint configuration

Flat config (`eslint.config.js`):

- Ignores `dist`.
- Extends `@eslint/js recommended`, `typescript-eslint recommended`,
  `react-hooks` (flat recommended), and `react-refresh/vite`.

No Prettier configuration is present; formatting is implicit.

## Backend toolchain

- `@aws-amplify/backend-cli` drives sandbox deploys:
  `npx ampx sandbox` (not wired into package scripts; run manually).
- CDK artifacts are emitted under `.amplify/artifacts/cdk.out/` when the
  sandbox builds. This directory is large (60+ VTL files and Lambda
  bundles) and should be gitignored in a production setup.
- `amplify_outputs.json` is produced by the sandbox and committed; the
  client reads it at startup via `src/main.tsx`.

## Deploy

- **Platform:** AWS Amplify Hosting, main-branch auto-deploy from the
  GitHub repository (`QuarksG/heimdall`). The production SPA is served
  from `https://main.d3p8snpek9jhao.amplifyapp.com` (referenced in
  `amplify/backend.ts` line 28 and `terms-api/handler.ts` line 9 as the
  documented production origin).
- **Current state:** the `ALLOWED_ORIGIN` values in `backend.ts` and
  `handler.ts` are temporarily set to `http://localhost:5173` for local
  development. These must be reverted before any production deploy (flagged
  in `handler.ts` line 9 with an explicit `revert before commit` comment).
- **Environment:** there is one environment — the sandbox behind
  `main`. No separate `dev`, `staging`, or `prod` stacks.

## Build verification

`npm run build` succeeds on `main` (`e3fd751`). Output:

```
vite v7.3.0 building client environment for production...
✓ 3617 modules transformed.
✓ built in 4.34s
```

`npx tsc -p tsconfig.app.json --noEmit` reports 3 errors in
`src/features/payment-reconciliation/config/regions/index.ts`:

1. Cannot find module `./base/RegionConfig.interface`.
2. Module `./implementations/tr.config` has no exported member `TurkeyConfig`.
3. Cannot re-export `RegionConfig` from the missing interface.

The errors are isolated to a file that the runtime does not import, so the
bundle still builds. See `06-risks-and-roadmap.md` for remediation.

## Observability — what exists and what does not

### Exists
- Lambda `console.log` / `console.error` statements are captured by
  CloudWatch Logs automatically.

### Does not exist
- **No log retention policy** in code. CloudWatch default is "never
  expire".
- **No structured logging.** Logs are ad-hoc human-readable strings.
- **No request correlation IDs** across the client → HTTP API → Lambda →
  DDB path.
- **No metrics.** No custom CloudWatch metrics, no dashboards, no alarms.
- **No client-side error telemetry.** React error boundary is not wired up;
  `window.onerror` is not captured.
- **No X-Ray tracing.**
- **No alerting** on Lambda errors, throttled DDB calls, or HTTP API 5xx
  responses.

### Minimum viable additions (recommended, not implemented)
- Set log retention to 30 days on all three Lambdas.
- Add a CloudWatch alarm on Lambda `Errors` metric.
- Add a single dashboard: Lambda invocations, errors, duration p95;
  DDB consumed capacity per table; HTTP API 4xx / 5xx.
- Wrap the SPA in a React error boundary that surfaces unhandled errors
  and forwards them to CloudWatch RUM or a logging endpoint.

## Runbook stubs

Scenarios that need documented responses before production rollout. None of
these are written yet.

1. **Admin cannot approve requests.** Verify they are in the Cognito
   `Admin` group. Model-level authorization requires `allow.group("Admin")`.
2. **User approved but still locked out.** `custom:entitlements` is only
   injected at token issuance. User must sign out and sign back in. The
   `Home.tsx` Quick Start calls this out to users, but no ops doc covers
   it.
3. **Terms API returns 500.** The Lambda returns a JSON error. The most
   likely causes are missing `TERMS_TABLE_NAME` env var or a transient DDB
   throttle. Check Lambda CloudWatch logs.
4. **DF/Retail validator throws on upload.** The component has try/catches
   that render the error message in-chat. For root cause, open DevTools
   console; the component also logs to console.

## Backup and recovery

DynamoDB default configuration is in effect. No point-in-time recovery is
explicitly enabled in code. For the current data volumes (access requests
and terms acceptances number in the low thousands at most), this is low
risk, but enabling PITR on the Entitlement and AccessRequest tables is
cheap insurance.

## Cost posture

The backend is effectively zero-cost at current scale:

- One Cognito user pool (free tier covers the expected monthly active
  users many times over).
- Three DynamoDB on-demand tables with tiny row counts.
- Three Lambdas triggered only at sign-up, token issuance, and terms
  acceptance.
- One HTTP API with a single route.

The dominant cost driver is Amplify Hosting storage and data transfer,
which scales with build frequency and traffic.
