# Repository privacy and GitHub Pages retirement pre-deploy

Status: `PREPARED — NOT EXECUTED`

Snapshot date: 2026-08-25 (Europe/Rome)

This runbook prepares R7 without changing the live site, repository visibility,
DNS, Actions settings, tags, releases, or account state. Execute it only after
the production backend and production Desktop prerequisites in
`docs/LIFE_TRACKER_OS_PROGRESS.md` are satisfied and Francesco gives one exact
approval for the reviewed GitHub mutations.

## Safety outcome

The intended end state is:

- the existing GitHub Pages deployment is explicitly unpublished and cannot be
  recreated by a later push;
- `FrancescoPuglia/life-tracker` is private and remains fetchable/pushable by
  Francesco;
- the installed Desktop has no runtime dependency on GitHub Pages, repository
  visibility, Releases, or anonymous repository assets;
- a known-good source ref, installer hashes, Firebase recovery evidence, and a
  non-Pages CI path exist before the visibility change;
- no repository history is deleted or rewritten.

Making the repository private is not a substitute for unpublishing Pages.
GitHub documents that Pages sites can remain public even when their source
repository is private. GitHub's explicit unpublish operation removes the
current deployment without deleting repository content. See
[Configuring a publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
and
[Unpublishing a GitHub Pages site](https://docs.github.com/en/pages/getting-started-with-github-pages/unpublishing-a-github-pages-site).

## Read-only live snapshot

Anonymous GitHub API and HTTP probes on 2026-08-25 established:

- repository visibility: `public`; default branch: `main`;
- `main`: `5ea328066d207d695fcf689015fd610e3751f457`, not protected;
- `codex/life-tracker-os`:
  `4ea68b614b0073641b0fc8add348700782b48324`, not protected;
- repository API `has_pages`: `true`;
- `https://francescopuglia.github.io/life-tracker/`: HTTP 200 with no redirect;
- active workflow: `.github/workflows/deploy.yml`, named
  `Deploy to GitHub Pages`;
- latest deployment run: `29420289081`, successful from
  `main@5ea328066d207d695fcf689015fd610e3751f457`;
- Releases: none; Git tags: none; forks: 0; stars: 0; subscribers: 0;
- 30 historical `github-pages` artifacts are listed and all are expired;
- repository homepage is empty and the tracked tree has no `CNAME` file.

The effective Pages URL and tracked tree provide no evidence of a custom
domain, but the unauthenticated Pages-settings API returned 404. Therefore the
authoritative custom-domain setting is `NOT VERIFIED` until an authenticated
admin checks Settings -> Pages. A custom domain or DNS record is a hard pause:
GitHub warns that DNS should be removed or updated before a public-to-private
change to avoid domain-takeover risk. See
[Setting repository visibility](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility)
and
[Managing a Pages custom domain](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site).

The local GitHub CLI session is expired. It must be reauthenticated through
GitHub's trusted interactive flow at execution time; no token belongs in chat,
a command argument, a document, or a log. The separate HTTPS Git credential
path successfully pushed the R6 checkpoint to `codex/life-tracker-os`, but it
must be tested again after privacy conversion.

## Desktop and release independence

Current evidence:

- Tauri packages the committed static `out/` tree into the NSIS application;
- both Desktop environments call only their exact Firebase/Google origins;
- `createUpdaterArtifacts` is `false`;
- neither JavaScript nor Rust includes the Tauri updater plugin;
- there are no GitHub Releases or release assets;
- source/config scanning found no GitHub Pages, raw-content, repository API,
  release-download, or GitHub-hosted object URL in Desktop runtime material.

`npm run check:desktop-security` now enforces that boundary. Its pure negative
tests cover Pages, raw repository, API, release-download, and GitHub-hosted
object URLs without printing matched URL/query content. Run the same check on
the final source and scan the final executable/installer before R7.

Manual updates remain the first private-release policy. Adding an updater later
requires a separate signed N -> N+1 design and must not reuse anonymous public
repository assets.

## Preconditions

Do not begin GitHub mutations until every item is true:

1. Production secure backend smoke acceptance and rollback evidence are green.
2. The production Windows Desktop is installed and works with Francesco's real
   data and AI.
3. Native notification and autostart acceptance are green.
4. A final production installer is retained outside the repository with its
   SHA-256 and source SHA.
5. The branch is clean, pushed, reviewed, and has no open implementation P0/P1.
6. Firebase application, Rules, indexes, Functions, and data-recovery evidence
   are recorded.
7. GitHub admin authentication is current and the exact repository identity is
   displayed before every setting change.
8. Authenticated Pages settings confirm the publishing source and whether any
   custom domain exists; any corresponding DNS action has explicit approval.
9. GitHub Actions plan/usage is checked without changing billing or budget.
10. Francesco explicitly approves the exact workflow/Pages/visibility sequence.

## Recovery refs before settings changes

At execution time, first record:

```text
git status --short
git rev-parse HEAD
git rev-parse origin/main
git rev-parse origin/codex/life-tracker-os
git remote -v
git tag --list
```

The worktree must be clean and each recorded SHA must match GitHub's
authenticated view. Create one annotated known-good tag such as
`life-tracker-os-pre-private-20260825` at the final reviewed release commit,
then push only that exact tag after approval. Also retain the already-pushed
`codex/life-tracker-os` branch. Never force-push, rewrite Goal 1 history, delete
recovery branches, or use `main` as scratch space.

The final receipt must record:

- pre-conversion `main` and Master branch SHAs;
- the recovery tag/ref and remote confirmation;
- production and staging installer filenames, source SHAs, sizes, and hashes;
- the Firebase backup/recovery receipt and pre-change Rules/index/Function
  metadata.

## Prevent Pages from coming back

The current workflow grants `pages: write` and `id-token: write`, uploads `out`,
and deploys on every push to `main` or manual dispatch. Unpublishing while this
workflow remains deployable is not durable: a later successful run can publish
the site again.

Before unpublishing, merge a separately reviewed workflow patch that:

- removes `.github/workflows/deploy.yml` or removes every Pages deployment
  trigger, permission, artifact upload, environment, and deploy action;
- adds a non-deploying private CI workflow with `contents: read` only;
- uses SHA-pinned official actions and Node 22;
- runs the repository-real type, unit, Rules-emulator, build, dependency-audit,
  static-security, and Desktop-security gates;
- uses no provider secret, Firebase credential, production data, Pages
  variable, release asset, or deployment permission;
- cancels superseded runs and sets a bounded timeout.

This preparatory branch deliberately leaves the active workflow unchanged.
Workflow removal affects service availability and must remain coupled to the
approved R7 execution window. After merging the replacement, verify that no
new Pages deployment was created and that the replacement CI passed.

Private-repository GitHub-hosted Actions consume the account's included minutes
and storage; usage above the plan allowance can be billable. Do not add a paid
runner, payment method, budget increase, or uncontrolled matrix. The expected
personal-use volume is one bounded Linux job per release/main update. See
[GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

## Exact execution sequence

### 1. Freeze and identify

- Stop merges and workflow dispatches for the short conversion window.
- Confirm the exact repository, owner, default branch, current SHAs, visibility,
  workflow list, releases, tags, forks, Pages source, custom domain, environments,
  and Actions variables/secrets **metadata only**.
- Do not display any Actions secret value.
- Confirm the replacement non-Pages CI is green and the recovery tag is remote.

### 2. Explicitly unpublish Pages

Using the authenticated GitHub UI, open Settings -> Pages. Next to the live-site
message, choose `Unpublish site`. This is the documented unpublish action; do
not delete the repository and do not treat changing a branch source alone as
equivalent evidence.

### 3. Verify public unavailability

From an unauthenticated session and a second network/device where feasible,
request both:

```text
https://francescopuglia.github.io/life-tracker/
https://francescopuglia.github.io/life-tracker/index.html
```

Use a cache-busting query and `Cache-Control: no-cache`. Both requests must stop
serving Life Tracker content; a redirect to the same live application is a
failure. Record HTTP status, effective URL, time, and a content hash or bounded
non-sensitive marker check. Recheck the Actions/deployments view to prove no
replacement deployment was created. If content remains, stop before changing
visibility and resolve Pages/CDN/custom-domain state.

### 4. Make the repository private

In Settings -> General -> Danger Zone, choose Change repository visibility ->
Private and complete GitHub's exact repository-name confirmation. Recheck forks,
stars, watchers, rulesets, Pages, Actions, and security features immediately
before confirming because those values may have changed since this snapshot.

GitHub documents that existing public forks are detached rather than made
private. The current anonymous snapshot shows zero forks, but this must be
rechecked at execution time. Historic clones, caches, logs, and prior public
exposure cannot be retroactively erased.

### 5. Verify access and CI

- Authenticated GitHub metadata reports `private: true` for the exact repository.
- Anonymous repository/API/clone requests no longer reveal repository content.
- The Pages URLs remain unavailable.
- Existing local clone can fetch, and a fresh authenticated clone into a
  `mktemp -d` directory succeeds.
- A normal non-force push of the next focused progress checkpoint succeeds.
- The replacement CI runs successfully with no Pages permission/deployment.
- No Desktop build/runtime path references Pages, GitHub Releases, or anonymous
  repository assets.
- Installed production Desktop still launches, authenticates, reads real data,
  and calls only the verified production Firebase/backend origins.

### 6. Final privacy scan

Run the repository-real static/Desktop scans, high-confidence credential scan
of changed/staged content, executable/resources, and installer, plus
`git diff --check`. Check historical Actions logs/artifact metadata for exposure
without downloading or printing secret values. Expired artifacts and deleted
public deployment do not erase historic exposure; record this limitation.

## Failure and recovery matrix

| Failure | Required response |
| --- | --- |
| Admin authentication unavailable | Stop; use GitHub's trusted interactive login later. Never move a token through chat. |
| Custom domain/DNS exists | Stop before visibility change; review and explicitly approve the DNS removal/update. |
| Pages URL still serves the app | Do not make the repository private or claim privacy PASS; inspect deployment and cache state. |
| A workflow can still deploy Pages | Disable/remove that authority in a reviewed main-branch change, rerun CI, then unpublish again. |
| Private conversion breaks CI | Keep the repository private; fix least-privilege permissions or reduce the workflow. Do not enable paid usage implicitly. |
| Authenticated fetch/push fails | Use the recorded local clone/recovery tag and restore credentials through GitHub's trusted flow; do not rewrite history. |
| Desktop attempts a GitHub URL | Stop release, remove the dependency, rebuild/reinstall, and repeat runtime/binary scans. |
| Production Desktop fails after conversion | Repository visibility is not a runtime rollback. Reinstall the retained known-good artifact and diagnose Firebase/backend state independently. |

## Acceptance evidence

R7 is not complete until the final receipt contains observable evidence for all
of the following:

- pre/post visibility and exact repository identity;
- recovery branch/tag and installer hashes;
- explicit Pages unpublish action;
- two unauthenticated Pages URL failures after cache bypass;
- anonymous repository access failure and authenticated clone/fetch/push PASS;
- replacement private CI PASS with no Pages deployment authority;
- Desktop runtime-independence check and installed production smoke PASS;
- final secret scans and diff hygiene;
- custom-domain/DNS result;
- acknowledgement that prior public exposure cannot be undone.

Until then the correct status remains `R7 PREPARED — NOT EXECUTED`.
