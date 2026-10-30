# Moderation playbook

For NASFAQ's volunteer moderators. Players see the rules at `/rules`
(`app-client/app/rules/page.tsx`); the legal version is the Usage policy at `/terms`. When a case
isn't covered here, use your judgement, write down what you did and why, and ask in the mod channel.

> **For now the owner, James, is the only moderator.** There's no mod channel and no rota yet:
> where this doc says to post in the mod channel, keep a note instead (the Admin log already records
> the actions). If others join, set up a private channel on the NASFAQ Discord and split the
> [windows](#rota) between you.

Most of the tools come from PR #54 (moderation tools), live since 2026-10-29.

## Who can moderate

- **There's no moderator-only role yet.** Every tool below needs **Admin** (`is_admin`), and Admin
  can do everything else too: pause trading, market tuning, IPOs, roles, prizes and predictions.
  The owner grants it only to people they trust.
- **Volunteers stick to the tools in this doc.** Leave market tuning, IPOs, assets, roles and
  predictions alone unless the owner asks.
- **To grant it,** an existing admin:
  1. opens `/admin/people` (People & roles);
  2. searches for the username;
  3. clicks the **Admin** switch, then **Yes, make admin**;
  4. asks the owner to add their email to Cloudflare Access (only the owner has the Cloudflare
     account): **Zero Trust → Access controls → Policies → Admin Allowed**, add it under **Emails**
     and save. `/admin` sits behind Cloudflare Access, so without this they have the role but can't
     open the admin pages. Use the email on their NASFAQ account unless they ask for another; they
     sign in with a code sent to it. Asset managers need it too, since they work on `/admin/assets`.

  It takes effect on the player's next request.
- **To take it away,** do the same thing, and have the owner remove their email from the Admin
  Allowed policy. Nobody can remove their own admin; another admin has to.
- **Every role change is logged** in the Admin log on `/admin/moderation`.
- **When someone joins or leaves the team,** add or remove them in the [rota](#rota) and the mod
  channel.
- **People & roles shows players' email addresses.** Never share them or paste them into
  Discord.
- **Admins can't be suspended.** To deal with a moderator who goes rogue, the owner takes their
  admin away first.

## Where the tools are

| What | Where | Notes |
| --- | --- | --- |
| Report queue | `/admin/moderation` → **Chat reports** (Open / Resolved / Dismissed) | **Remove message**, **Resolve**, **Dismiss**, **Reopen**. Removing a message resolves every open report on it. Open reports also show under **Needs attention** on `/admin`. |
| Remove a chat message | Hover the message (tap **⋯** on a phone) → **Remove message** | Type a reason in the **Reason** box first; it goes in the log. Removal can't be undone. |
| Mute from chat | Same menu → **Mute *name* in all of chat**: 10 minutes, 1 hour, 24 hours or 7 days | Applies to every room. They can still read. |
| Ban from chat | Same menu → **Ban from chat…** → **Ban** | Lasts until an admin lifts it. There's no timed ban; use a mute or a suspension for that. |
| Lift a mute or ban | `/admin/moderation` → **Chat mutes & bans** → **Unmute** / **Unban** | |
| Hide a comment | The **Hide** button on stock board, article and prediction comments | Optional reason. It's gone for everyone but admins, who see it dimmed with **Unhide**. |
| Suspend an account | `/admin/people` → find them → **Suspend…** → 24 hours, 7 days, 30 days or Until lifted | The reason is **required** and **the player sees it**, so keep it short and neutral. It signs them out everywhere. They can sign back in and read, but can't trade, post, chat or play, and they drop off the leaderboards. **Lift suspension** ends it early. |
| Reset a profile | `/admin/people` → **Reset profile…** | Renames them to `player_<id>` and clears their bio and banner. Use it for offensive or impersonating names and profiles. It also clears their 7-day rename wait, so they can pick a new name straight away. |
| Shared IP | `/admin/people` → **Shares an IP** under a player | Other accounts that signed up or played from the same IP address. Only a salted hash is kept, so nobody can see the address. A lead for alts, not proof: homes, schools and phone networks share one. Off until the owner sets `IP_HASH_SALT`. |
| Freeze the exchange | `/admin/people` → **Freeze exchange** (add a note) → **Unfreeze** later | Stops them using the card and item exchange. It doesn't stop stock trading, games or chat. |
| Exchange review | `/admin/exchange` | Read-only. Lopsided sales and trades involving new accounts, pairs that keep trading with each other, accounts dealing with several new ones, and groups of accounts sharing an IP address. **same IP** marks flagged accounts that share one. |
| Delete an article | On the article, as an admin: **DELETE** (a player's article) or **DELETE BODY** (the player-written part of a news article) | **Can't be undone and isn't in the Admin log.** Screenshot it and post in the mod channel before you press it. |
| Announcement banner | `/admin` → **Health** → **Post an announcement…** | 280 characters, Info or Warning, optional link, and an end time. **Edit…** and **Clear announcement** are in the same spot. |
| Admin log | `/admin/moderation` → **Admin log** | Every action above except article deletes, newest first, with who did it and why. |
| Bug reports | `/admin` → **Bug reports** | From the **Report a bug** button in the footer. They also post to Discord. |

**What doesn't exist yet:**

- a warning tool;
- a button to lock a room (the API can make a room read-only; ask the owner);
- restoring a removed chat message;
- per-room mutes in the UI;
- IP addresses (NASFAQ only keeps salted hashes of them, for **Shares an IP**).

**What the site refuses on its own** (no action needed): usernames with slurs or hate terms
(however they're spelled), names that look like staff or the site (admin, mod, official, NASFAQ…)
or that are a talent's name or ticker; slurs and hate speech in bios, chat, comments and article
titles; a second account on the same inbox (Gmail dots and +tags count as the same address);
throwaway email domains. Renames need a verified email and wait 7 days. Staked PvP tables need a
verified email and a week-old account, like the exchange. Unverified accounts aren't on the
leaderboards. Names that were taken before these rules stay until someone resets them.

A suspension also doesn't cancel the player's queued stock or prediction orders.

## Handling a report

1. **Read the context.** Scroll up in the room, not just the reported line. Check the player's
   profile and how old the account is.
2. **Pick a step from the ladder below.** First offences get the lightest step that stops it.
3. **Always write a reason.** It goes in the log, and for suspensions the player reads it.
4. **Post anything beyond a removal or a short mute in the mod channel:** who, what, and a
   screenshot. There's no warning tool, so this is the only record of warnings.
5. **Don't moderate an argument you're in.** Hand it to another moderator.
6. **Don't discuss actions in public chat.** If someone asks, say it's been handled and point them to
   the appeals contact on `/rules`.

## The escalation ladder

The usual order:

1. **Warning.** Remove the message and reply once in the room, for example: "@name, removed that.
   Keep it about the market, please: /rules". Note it in the mod channel.
2. **Chat mute.** 1 hour the first time, 24 hours the second time, 7 days the third time. Use 10
   minutes to cool down a heated moment.
3. **Suspension.** 24 hours the first time, 7 days the second time, 30 days the third time.
4. **Permanent ban.** **Suspend…** with **Until lifted**, plus **Ban from chat** if chat was the
   problem. Get a second moderator or the owner to agree first. Obvious spam and raid accounts don't
   need a second opinion.

Severe cases skip steps. The table suggests where to start. Repeat offences move up from there.

| Case | Start at | Also |
| --- | --- | --- |
| An insult in a heated argument | Warning | Mute for 1 hour if it carries on. |
| Spam, ads, referral links or flooding from a new account | Remove, **Ban from chat**, suspend **Until lifted** | Throwaway accounts don't get a ladder. |
| A slur, or hate aimed at a group | Remove, mute for 24 hours | If it's aimed at a person, suspend for 7 days. |
| Threats, or a pile-on organised against a player | Remove, suspend for 7 days | Tell the owner. |
| Doxxing: someone's real name, address, photos or accounts elsewhere | Remove at once, suspend **Until lifted** | Hide or delete every other copy. Tell the owner. Don't repeat the information in the mod channel; describe it. |
| Harassing a talent, their staff or their chat, or organising a raid | Remove, mute for 24 hours to 7 days | Suspend for 7 days if they're organising others. |
| Leaks of members-only or paid content, or a talent's private info | Remove, suspend for 7 days | |
| An NSFW or offensive username, bio or banner | **Reset profile** | Suspend for 7 days if they put it back. |
| An NSFW or offensive comment or article | **Hide** the comment or **DELETE** the article (screenshot first) | Warning, then the ladder. |
| Impersonating a talent, NASFAQ staff or another player | **Reset profile** | Suspend for 7 days if they used it to mislead or scam. |
| Made-up news meant to move a price | Remove, warning | Suspend for 24 hours on a repeat. |
| Arguing a moderation decision in chat | Point them to the appeals contact | Mute for 10 minutes if it carries on. |
| Selling accounts, Cash or items for real money | Remove, suspend for 7 days | Tell the owner. |
| Bots, scripts or alts; bug exploits | See [alts and exploits](#suspected-alts-and-exploits) | |

## Suspected alts and exploits

**Don't accuse anyone in public.** Not in chat, not in comments, and not in an announcement. We
can't see IP addresses, so the evidence is only ever circumstantial, and a public accusation can't
be taken back. If anyone asks, say "we're looking into it".

1. **Freeze the exchange** on every account involved (`/admin/people` → **Freeze exchange**). Use a
   neutral note, like "under review, see mod channel". The freeze stops cards and items moving.
2. **Stop anything else that moves value.** If they're also passing value another way, for example
   through table-game wagers or a stock they're both trading, suspend them for **24 hours**. Use the
   reason "Account under review. Contact us through /rules if you have questions."
3. **Collect evidence** in a thread in the mod channel:
   - the usernames and account ages;
   - the matching rows from `/admin/exchange`;
   - screenshots with times (ET);
   - what makes you think it's one person or a bot, for example matching names, accounts that only
     ever trade with each other, a new account handing everything to an old one, or Ticker Tap
     scores no human could get.
4. **Escalate to the owner** (James, on the NASFAQ Discord). The owner decides:
   - on clawbacks (there's no UI for them);
   - on any suspension longer than 24 hours;
   - on what to do about the bug itself.

**Bug exploits.** Someone who reports a bug in good faith is never punished; `/rules` promises
that. If someone is quietly using one:

1. Freeze them and escalate.
2. If it's spreading or breaking the market for everyone, see the next section.
3. Don't describe the exploit in public until it's fixed. That includes announcements and the
   changelog.

## When something is on fire

Moderators aren't responsible for the servers. If the site itself is broken, rather than a player
misbehaving, do this:

1. **Tell the owner straight away** (James, on the NASFAQ Discord). Production alerts post to the
   Discord alerts channel (see `docs/ops/alerts.md`, from PR #53), so the owner may already know.
2. **If an exploit is draining the market or prices have gone wrong,** pause trading:
   1. go to `/admin` → **Health** → **Pause trading…**;
   2. write a short message for players;
   3. press **Pause trading**.

   Queued orders wait, and settlement catches up after the market reopens. You can't pause during
   a settlement. Leave reopening to the owner.
3. **If it's in the games,** go to `/admin` → **Health** → **Games maintenance…**. That pauses new
   games site-wide; games already in play finish.
4. **Tell players.** Post an announcement with the **Warning** tone, saying what's paused and that
   you're on it. Don't speculate about the cause.
5. **For a chat raid,** mute or ban the accounts as they show up and ask the owner to make the room
   read-only.
6. **Don't deploy, restart anything or touch the database.** That's the owner's job:
   - `docs/ops/releasing.md` covers rollbacks;
   - `docs/ops/alerts.md` covers what each alert means;
   - `docs/market-operations.md` covers the market workers.

## Appeals

- Appeals come in through the NASFAQ Discord (https://discord.gg/Bw4S6EbBNW), the contact on
  `/rules` (`APPEALS_CONTACT` in `app-client/app/rules/page.tsx`); the Usage policy also lists
  nasfaqsite@gmail.com.
- A moderator who wasn't involved reviews the appeal and answers within a few days.
- If we got it wrong, undo it with the same tool and say sorry.
- If we got it right, give a one-line answer and leave it there.

## Rota

There are no shifts: James moderates alone, when there's time, and nobody is on call. These are the
windows when a look is worth the most. All times are ET, the market's clock.

| Window (ET) | Why |
| --- | --- |
| Daily, 08:45–09:30 | The 09:00 settlement: big movers, a busy chat, and any settlement alerts |
| Friday 23:30 – Saturday 01:00 | The weekly evaluation at Saturday 00:00: dividends and fees land, and so do complaints |
| Evenings, 19:00–23:00 | The busiest chat |
| Launch day and the day after | Public links bring trolls in the first hours |

A look means:

1. check `/admin` (**Needs attention**, **Bug reports**);
2. clear the queue on `/admin/moderation`;
3. skim Global chat.

If more moderators join, add a Moderator column to the table and post anything left open in the
mod channel at the end of a window.
