# Security updates

How we hear about vulnerable dependencies and code, and how the fixes ship. The config is
`.github/dependabot.yml`, `.github/workflows/codeql.yml` and `.github/workflows/security-scan.yml`.

## What watches what

| Watcher | Covers | Runs | Shows up in |
| --- | --- | --- | --- |
| Dependabot alerts | Every manifest in the repo, dormant ones included | As soon as an advisory is published | Security tab > Dependabot; email |
| Dependabot security updates | The same manifests: a pull request with the fix | As soon as an alert has a fixed version | Pull requests from `dependabot[bot]` |
| Dependabot version updates | npm in `api/` and `app-client/`; Go modules in `holonews/`, `superchatscraper/`, `ytscraper/`; the five Dockerfiles' base images; GitHub Actions | Mondays 10:00 ET | Pull requests, labelled `dependencies` |
| CodeQL | JavaScript/TypeScript in `api/` and `app-client/`, the three Go services, the workflows | Every pull request, every push to main, Mondays | Security tab > Code scanning; the PR's checks |
| `security-scan`: npm audit | Production dependencies of `api` and `app-client`, high and critical | Every pull request (from `ci`), daily on main | The PR's checks; an email when the daily run fails |
| `security-scan`: govulncheck | The three Go services: only vulnerabilities their code can reach | Same | Same |
| Secret scanning, push protection | Credentials in commits | Every push | Security tab > Secret scanning; the push is refused |

The security check doesn't run on deploys (`deploy.yml` calls `ci.yml`), so an advisory published
overnight can't hold up an unrelated fix. The daily run catches it on main instead.

Version updates are grouped: one pull request per directory for minor and patch releases, majors one
at a time. They skip releases less than a week old (`cooldown`), which keeps out most hijacked
packages. Security updates skip both the schedule and the cooldown.

### Not covered

- **The Node.js runtime.** The API and app-client images are `node:20-alpine`, and Node 20 stopped
  getting security fixes on 2026-04-30. Move to the next LTS (`node:24-alpine`) with `node-version`
  in the workflows and `@types/node`. Dependabot is told to skip Node majors, so it won't propose
  odd-numbered releases.
- **Go and Alpine patch releases.** `golang:1.27-alpine` and `alpine:3.21` pick up the latest patch
  whenever an image is built, so any deploy rebuilds with them. After a Go security release
  (announced on golang-announce), deploy. Dependabot proposes the next Go minor (1.28) as its own PR.
- **`redis:7-alpine`** in `deploy/k8s/10-redis.yaml`. Nodes pull it once and keep it, so patches
  don't arrive on their own. Bump the tag by hand.
- **Dormant code**: `client/`, `brokerbot/`, `channelscraper/`, `4chanscraper/`,
  `holonews/reference_image_scraper/`. None of it is deployed, so there are no version updates.
  Dependabot alerts and security updates still cover it: on 2026-10-30 `client/` had 13 npm
  advisories and `brokerbot/app/` 5. Dismiss them as "Vulnerable code is not actually used", close
  their pull requests, or delete the directories.

## Getting notified

1. <https://github.com/settings/notifications>, under **Dependabot alerts: New vulnerabilities**: tick
   **On GitHub** and **Email**. Leave the weekly digest off: it's a summary, not an alert.
2. Same page, under **Actions**: email on, **Only notify for failed workflows**. The daily
   `security-scan` emails the person who last changed its `cron` line.
3. On the repository, **Watch > Custom**: tick **Security alerts** (and **Pull requests**, to see
   Dependabot's).
4. Optional: GitHub Mobile (Settings > Notifications) pushes the **On GitHub** notifications above
   to your phone.

## Triage a Dependabot pull request

Merging to main deploys. Don't merge from 08:55 to 09:30 ET (settlement) or from Friday 23:00 to
Saturday 01:00 ET (weekly evaluation).

1. **Security PR** (it links the advisory). Read the severity and whether we call the affected code.
   Critical or high in `api` or `app-client`: merge the same day.
2. **Wait for CI**: tests, build, `security`, CodeQL. All green, then merge. The release follows on its
   own ([releasing.md](releasing.md)); watch the deploy run and `/api/health`.
3. **Minor/patch group**: skim the release notes, then merge.
4. **Major**: read the breaking changes, check out the branch and run the app. Leave it until after
   launch week unless it fixes a vulnerability.
5. **`golang` image bump**: in the same PR, set `go-version` in `ci.yml`, `codeql.yml` and
   `security-scan.yml` to match.

Comment `@dependabot rebase` to refresh a stale PR, or `@dependabot ignore this major version` to
drop one.

## When the security check fails on a pull request

An advisory came out, usually about something the PR didn't touch. Merge Dependabot's fix first, or
fix it by hand in that directory, then update the PR's branch:

```bash
cd api && npm audit fix && npm audit --omit=dev --audit-level=high
cd holonews && go get example.com/module@FIXED_VERSION && go mod tidy
cd holonews && GOWORK=off go run golang.org/x/vuln/cmd/govulncheck@v1.9.0 ./...
```

npm audit blocks on high and critical only. govulncheck blocks only on code the service can reach;
it names the call path.

## Repository settings

These live in **Settings > Advanced Security** ("Code security" on older layouts), owner only.
Secret scanning and push protection are already on. To turn on:

| Setting | Command |
| --- | --- |
| Dependabot alerts | `gh api -X PUT repos/JamesAC42/nasfaqv2/vulnerability-alerts` |
| Dependabot security updates | `gh api -X PUT repos/JamesAC42/nasfaqv2/automated-security-fixes` |
| Private vulnerability reporting | `gh api -X PUT repos/JamesAC42/nasfaqv2/private-vulnerability-reporting` |
| Secret scanning: non-provider patterns, validity checks | see below |

```bash
gh api -X PATCH repos/JamesAC42/nasfaqv2 --input - <<'EOF'
{"security_and_analysis": {
  "secret_scanning_non_provider_patterns": {"status": "enabled"},
  "secret_scanning_validity_checks": {"status": "enabled"}}}
EOF
```

Leave **CodeQL default setup** off: `codeql.yml` is the advanced setup, and GitHub refuses its
results while default setup is on. **Grouped security updates** can stay off too; the `*-security`
groups in `dependabot.yml` already group them.

Check with `gh api repos/JamesAC42/nasfaqv2 --jq .security_and_analysis` and
`gh api repos/JamesAC42/nasfaqv2/automated-security-fixes`
(`vulnerability-alerts` answers 204 when on, 404 when off).
