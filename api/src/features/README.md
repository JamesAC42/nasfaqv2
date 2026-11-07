# Feature flags

A flag keeps something new with staff until it's ready. Merge the feature behind a flag, preview it in production as an admin, then turn it on for everyone in its own small PR.

Each flag is one JSON file in this folder, named after the flag: `tick-reasons.json` is the `tick-reasons` flag. Separate files mean PRs that add flags never touch the same file.

```json
{
  "state": "staff",
  "description": "What the flag hides, and where it shows.",
  "fields": ["reasons"]
}
```

- **`state`**:
  - `off`: nobody sees it.
  - `staff`: only admins (`is_admin`) see it.
  - `on`: everyone sees it.
- **`description`**: what's behind the flag, for whoever turns it on.
- **`fields`** (optional): payload keys that only viewers with the flag get. The API drops them, at any depth, from every payload sent through `forAudience` or a cached response with `features: true`. Pick key names that only this feature uses.

A misnamed file, bad JSON or an unknown state stops the API at startup, and `api/test/features.test.js` fails on it in CI.

## Turning one on

Change `"state": "staff"` to `"state": "on"` in its own PR. That PR is also where the feature's changelog entry goes (`app-client/app/changelog/entries/`), so the changelog announces it when players can actually see it.

## Gating something new

The API is the authority. The client only hides what the API already withholds.

**In the API** (`require("../features")`):
- **A whole endpoint:** add the `requireFeature("my-flag")` middleware. Anyone without the flag gets a 404.
- **A field in a payload:** list it under `fields`.
  - Cached responses: pass `features: true` to `sendCachedJson`. It builds a separate copy for staff under its own key and marks the response private.
  - Uncached responses: send `forAudience(payload, audienceOf(req.ctx.user))` and call `viewerVaries(res)`.
  - Market socket events: these are split by audience already (`audienceTexts` in `server.js`).
- **Anything else:** branch on `isEnabled("my-flag", req.ctx.user)`. If the answer changes what a response contains, call `markPrivate(res)`.
- **Background work** (ticks, scrapers, jobs): don't gate it. Keep recording, so there's history when the flag turns on.

**In the client:**
- `useFeature("my-flag")` (`app/lib/features.ts`) hides links, tabs and boxes.
- A nav link can carry `feature: "my-flag"`.
- A gated page's server component calls `await requireFeature("my-flag")` (`app/lib/features-server.ts`), which renders the 404 page for anyone without the flag. If the page has metadata, do the same in `generateMetadata`.

**Watch shared caches.** Anything cached once and served to many people must never hold a staff copy that reaches everyone. That covers Redis response caches, `getCachedBody`, Next `fetch` with `revalidate`, static pages and anything Cloudflare keeps.
- Next's server-side fetches go out without the visitor's cookie, so they get the everyone copy.
- The exception is `requireFeature` in `features-server.ts`, which forwards the cookie and never caches.

## Retiring one

Once a flag has been `on` for a while, delete its checks in the API and the client first, then the file. `features.test.js` fails if code names a flag that has no file.

## Tests

`features.override({ "my-flag": "on" })` changes a state until you call the function it returns.
