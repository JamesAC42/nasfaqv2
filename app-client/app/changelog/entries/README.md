# Changelog entries

Each file here is one entry on the player-facing [/changelog](https://holo.nasfaq.biz/changelog) page. `app/lib/changelog.ts` reads the folder when the site builds, newest first.

**Only bigger, player-visible features get an entry.** A new game, a new page, a change to how trading or predictions work: yes. A small bug fix, a layout tweak or a behind-the-scenes change: no, leave it out.

## Adding one

Add a new file. Don't edit other entries to add yours, and never go back to a single shared list: separate files are why PRs don't conflict here.

Name it `YYYY-MM-DD-HHMM-short-name.json`: the date and US Eastern time you wrote it, then a few words in lowercase with hyphens. For example, `2026-11-06-1430-stream-calendar.json`. The date is the one the page shows. Files sort by name, so the time keeps entries from the same day in order.

```json
{
  "title": "Stream calendar",
  "changes": [
    { "kind": "new", "text": "A calendar of upcoming streams on the market page." },
    { "kind": "improved", "text": "Each tick says what moved a stock." }
  ]
}
```

`kind` is `new`, `improved` or `fixed`. Write for players, in plain language and American spelling, with no developer notes. The owner edits the wording before merging.

A misnamed file or bad JSON fails the build, so CI catches it on the PR.
