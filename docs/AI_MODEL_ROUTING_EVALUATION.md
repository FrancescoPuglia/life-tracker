# Economical AI model routing and evaluation

Status: `TECHNICALLY GREEN — LIVE MODEL EVALUATION NOT RUN`

Reviewed: 2026-08-25 (Europe/Rome)

This document defines the cost-controlled evidence required before Life Tracker
may route an AI workload away from the verified Goal 1 configuration. It is not
an activation receipt. No OpenAI request, secret access, deployment, billing
change, spend-limit change, or automatic recharge occurred in this slice.

## Safety boundary

`AI_MODEL_ROUTING_ENABLED` defaults to exact `false`. In that state:

- `AI_MODEL_ROUTING_CONFIG` is not read;
- the deployed Goal 1 model and reasoning parameters remain authoritative;
- the verified 30-second, 6-turn, 12-tool-call, 1,500-output-token, and
  512,000-tool-output-byte limits remain exact;
- response and runtime metadata retain their existing shape; and
- deterministic tracking, reminders, metrics, charts, report generation, and
  deterministic report narratives do not require OpenAI.

Exact `true` requires a complete, canonical, versioned routing manifest with all
five workloads, current price-catalog version, valid evaluation receipts, and
routes within their hard cost ceilings. Missing, partial, stale, malformed, or
over-ceiling configuration fails closed. There is no automatic fallback to a
more expensive model after timeout, quota exhaustion, malformed output, or any
other provider failure.

Routing authority comes only from the authenticated request mode enum. Prompt,
Note, title, description, imported text, tool result, or model output cannot
select a model or expand its limits.

## Current official model facts

The following direct-API text-token prices were reviewed from the official
OpenAI model pages on 2026-08-25. Prices are USD per one million tokens.

| Model | Input | Cached input | Output |
| --- | ---: | ---: | ---: |
| `gpt-5.6-luna` | $0.20 | $0.02 | $1.20 |
| `gpt-5.6-terra` | $2.00 | $0.20 | $12.00 |
| `gpt-5.6-sol` | $4.00 | $0.40 | $20.00 |

Sources: [model overview](https://developers.openai.com/api/docs/models),
[Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna),
[Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra), and
[Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol).

The Sol page describes its price as promotional through at least 2026-11-21.
Therefore the production parser accepts only price catalog
`openai-pricing-2026-08-25`; official prices must be reviewed and the catalog
version intentionally updated before any later live evaluation or activation
when those facts may be stale. OpenAI's official model-selection guidance is to
establish an accuracy baseline and then optimize cost and latency against a
representative evaluation, which is the policy implemented here.

## Workloads and hard ceilings

| Workload | Purpose | Maximum model | Maximum reasoning | Runtime bounds |
| --- | --- | --- | --- | --- |
| `ask` | Grounded ordinary questions | Terra | low | 20 s, 3 turns, 6 tools, 800 output tokens |
| `coach` | Lightweight bounded coaching | Terra | low | 20 s, 3 turns, 6 tools, 800 output tokens |
| `analyze` | Multi-source period analysis | Sol | high | 30 s, 5 turns, 10 tools, 1,200 output tokens |
| `plan` | Typed preview-only planning | Sol | high | 30 s, 6 turns, 12 tools, 1,500 output tokens |
| `weekly_strategic_review` | Interpretation of immutable weekly metrics | Sol | high | 20 s, 1 turn, 0 tools, 900 output tokens |

The current evaluation ladders are cheaper still:

- Ask and Coach: Luna low, then Terra low.
- Analyze, Plan, and Weekly Strategic Review: Luna low, Luna medium, Terra low,
  Terra medium, Sol low, then Sol medium.

The selector stops at the first adequate profile. It will consider a later
candidate only when every required case for every cheaper candidate has
complete, deterministic failing evidence. Missing evidence never authorizes
escalation. If no profile is adequate, the outcome is
`no_adequate_candidate`; the product retains its deterministic path.

## Representative sanitized corpus

The versioned corpus contains seven synthetic cases and no personal data,
provider credential, mailbox, phone number, or production identifier.

| Case | Workload | Required evidence |
| --- | --- | --- |
| Grounded synthetic Goal nonce | Ask | Owner-scoped allowlisted read, exact nonce, no invented entity |
| Hostile Note containment | Ask | Note treated only as data, no authority expansion |
| Bounded scheduling experiment | Coach | Observation and uncertainty separated, one reversible experiment, no diagnosis |
| Exact planned-versus-actual | Analyze | Deterministic tool used; 60 planned, 40 actual, 20 variance unchanged |
| Missing Sessions | Analyze | Actual remains unknown, never silently reported as zero productivity |
| Preview-only TimeBlock move | Plan | One typed preview, fixed block preserved, no apply or implicit deletion |
| Metric-bound weekly strategy | Weekly | Immutable metric IDs/values preserved, uncertainty stated, no causal claim |

Each observation records only safe structured evidence: configured/provider
model, reasoning effort, bounded call/tool counts, token usage, latency, and the
exact Boolean criteria for its case. Raw model output, user data, prompts beyond
the committed synthetic corpus, secrets, headers, and provider response bodies
are not retained in the selection receipt.

The receipt hashes the normalized observations for the selected candidate and
every cheaper failed candidate. It also binds workload, cases, model, reasoning,
evaluation time, and price-catalog version. A complete runtime manifest is
produced only after all five workload selections validate and round-trip through
the production parser.

## Bounded live evaluation gate

Live evaluation is deliberately `NOT RUN`. Before it can run, the release owner
must approve one exact bounded-credit action. The run must then:

1. Recheck the official model names, API support, and prices; update and test
   the catalog if any fact changed.
2. Use only the dedicated staging OpenAI project and committed synthetic
   fixtures. Do not read Francesco's real data or expose private content to the
   evaluator.
3. Confirm the existing spend limit and automatic-recharge state by metadata or
   provider UI without displaying a credential. Do not change either setting.
4. Execute candidate-case runs sequentially, cheapest first, and stop each
   workload at the first profile satisfying every criterion.
5. Stop the entire run on timeout, quota error, unexpected model identity,
   malformed usage, criterion-harness failure, or an explicitly approved total
   cost ceiling. Never retry by escalating model tier.
6. Retain only the safe structured observations and generated receipt/config;
   manually inspect every criterion before activation.

There are seven candidate-case runs if Luna low is adequate for every workload
and at most 30 candidate-case runs if every ladder is exhausted. A run may make
more than one Responses call when an allowlisted tool is needed; existing
per-workload turn and output limits remain hard caps. No cost amount is approved
by this document. The exact maximum USD gate must be calculated from the current
catalog and approved before the first provider request.

After a green evaluation, activation remains a separate deployment decision:
set the complete non-secret manifest and change the kill switch to exact `true`
only on the explicitly named staging revision, inspect runtime attestation, and
run the affected authenticated read/proposal/hostile-content tests. Production
activation requires its own later approval and evidence.

## Weekly narrative policy

Weekly AI interpretation is not connected by this slice. When added, it must run
only after the deterministic report artifact has been archived. It may append a
versioned strategic interpretation referencing immutable metric IDs, but it may
not calculate, replace, mutate, or silently omit metric values. Provider
unavailability, quota exhaustion, malformed output, or rejected claims leave the
archived deterministic report and useful deterministic narrative intact.

## Local evidence

- 7 files / 64 focused tests passed for route parsing, ceilings, evaluation
  completeness, hostile/missing-data cases, provider-model binding, receipt
  construction, response metadata, runtime attestation, HTTP boundaries, and
  exact legacy behavior.
- Functions strict typecheck passed.
- Production bundle inspection must prove the synthetic evaluation corpus is
  absent; the runtime imports only routing policy and adapter code.
- Full Functions regression, build, dependency audit, static/Desktop security,
  credential scans, and diff hygiene are required before checkpointing this
  slice.

## Current verdict

`ROUTING IMPLEMENTATION GREEN LOCALLY — LIVE CHEAPEST-ADEQUATE SELECTION NOT VERIFIED`

Until the live gate passes, keep `AI_MODEL_ROUTING_ENABLED=false` and do not
claim that Luna, Terra, or Sol is the selected production model for any new
workload.
