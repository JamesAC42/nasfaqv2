"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Sparkline } from "@/app/components/common/sparkline";
import { AdminFrame, AdminGate, AdminLoading, useAdminAccess, useNow } from "@/app/components/admin/admin-frame";
import { Notice, Section, adminUi as ui, until } from "@/app/components/admin/admin-ui";
import {
  cancelIpo,
  compactCount,
  createIpo,
  detectTalents,
  etMoment,
  fetchAdminIpo,
  ipoErrorText,
  ipoStage,
  ipoWindow,
  listIpoNow,
  listingDay,
  openIpoWindow,
  removeIpoTalent,
  updateIpo,
  type AdminIpoOverview,
  type DetectedTalent,
  type IpoEvent,
  type IpoSettings,
  type IpoTalent,
} from "@/app/lib/ipo";
import { talentAccent } from "@/app/lib/talent-color";
import { money } from "@/app/lib/time";
import { useTheme } from "@/app/providers/theme-provider";
import styles from "@/app/components/admin/admin-ipo-page.module.scss";

const SYMBOL = /^[A-Z]{2,5}$/;
const HEX = /^#[0-9a-f]{6}$/i;

type Draft = { selected: boolean; symbol: string; color: string; unit: string };

function settingsFrom(event: IpoEvent): IpoSettings {
  return {
    title: event.title,
    listing_date: event.listing_date,
    window_hours: Math.round((Date.parse(event.window_closes_at) - Date.parse(event.window_opens_at)) / 3_600_000),
    discount_pct: event.discount_pct,
    offering_pct: event.offering_pct,
    player_cap_pct: event.player_cap_pct,
  };
}

/** Title, listing date, window and the three percentages; shows the window it implies. */
function SettingsFields({ value, onChange, hour }: { value: IpoSettings; onChange: (next: IpoSettings) => void; hour: number }) {
  const window = ipoWindow(value.listing_date, value.window_hours, hour);
  const weekday = value.listing_date ? new Date(`${value.listing_date}T12:00:00Z`).getUTCDay() : null;
  const set = (key: keyof IpoSettings, raw: string) => onChange({ ...value, [key]: key === "title" || key === "listing_date" ? raw : Number(raw) });
  return (
    <div className={styles.settings}>
      <label className={`${ui.field} ${styles.wide}`}>
        <span>Title</span>
        <input className={ui.input} value={value.title} maxLength={120} onChange={(event) => set("title", event.target.value)} />
      </label>
      <label className={ui.field}>
        <span>Starts trading</span>
        <input className={ui.input} type="date" value={value.listing_date} onChange={(event) => set("listing_date", event.target.value)} />
      </label>
      <label className={ui.field}>
        <span>Window (hours)</span>
        <input className={ui.inputNum} type="number" min={1} max={336} value={value.window_hours} onChange={(event) => set("window_hours", event.target.value)} />
      </label>
      <label className={ui.field}>
        <span>Discount %</span>
        <input className={ui.inputNum} type="number" min={0} max={50} step={1} value={value.discount_pct} onChange={(event) => set("discount_pct", event.target.value)} />
      </label>
      <label className={ui.field}>
        <span>Offered % of max</span>
        <input className={ui.inputNum} type="number" min={1} max={100} step={1} value={value.offering_pct} onChange={(event) => set("offering_pct", event.target.value)} />
      </label>
      <label className={ui.field}>
        <span>Cap % per player</span>
        <input className={ui.inputNum} type="number" min={1} max={100} step={1} value={value.player_cap_pct} onChange={(event) => set("player_cap_pct", event.target.value)} />
      </label>
      <p className={styles.windowNote}>
        {window ? (
          <>
            Window <b>{etMoment(window.opens)}</b> → <b>{etMoment(window.closes)}</b>, listing at that settlement.
            {weekday === 6 || weekday === 0 ? <span className={styles.warnText}> A weekend listing day: Saturday is the weekly evaluation; a weekday is better.</span> : null}
          </>
        ) : (
          "Pick a listing date."
        )}
      </p>
    </div>
  );
}

function Badge({ symbol, color }: { symbol: string; color: string | null }) {
  const { theme } = useTheme();
  return (
    <span className={styles.badge} style={{ "--tal": talentAccent(color, theme) } as React.CSSProperties}>
      {symbol}
    </span>
  );
}

function FunnelRow({ event, talent, onRemove, busy }: { event: IpoEvent; talent: IpoTalent; onRemove: () => void; busy: boolean }) {
  const subs = talent.series.map((day) => day.subscribers ?? NaN);
  const fair = (talent.fair_value_series || []).map((day) => day.fair_value);
  const offered = talent.shares_offered ?? 0;
  return (
    <tr data-cancelled={talent.status === "cancelled" || undefined}>
      <td>
        <Badge symbol={talent.symbol} color={talent.color} />
      </td>
      <td className={styles.nameCell}>
        <b>{talent.name_english || talent.display_name}</b>
        <small>
          {talent.name_japanese ? <span lang="ja">{talent.name_japanese} · </span> : null}
          <a href={`https://www.youtube.com/channel/${talent.youtube_channel_id}`} target="_blank" rel="noreferrer">
            {talent.youtube_channel_id}
          </a>
        </small>
        <small>
          {talent.is_active ? "Scraping" : "Not scraping"} · stock {talent.asset_status}
        </small>
      </td>
      <td className={styles.num}>
        <b>{talent.channel.days_tracked}d</b>
        <small>{talent.channel.tracked_since ? `since ${listingDay(talent.channel.tracked_since)}` : "no stats yet"}</small>
      </td>
      <td className={styles.num}>
        <b>{compactCount(talent.channel.latest?.subscribers)}</b>
        <small>{talent.channel.week ? `${talent.channel.week.subscribers >= 0 ? "+" : ""}${compactCount(talent.channel.week.subscribers)} / ${talent.channel.week.days}d` : "—"}</small>
      </td>
      <td className={styles.num}>
        <b>{talent.channel.week ? compactCount(talent.channel.week.views) : "—"}</b>
        <small>{talent.channel.week ? `views / ${talent.channel.week.days}d` : "views"}</small>
      </td>
      <td className={styles.sparkCell}>
        <Sparkline values={subs} tone="blue" width={90} height={26} className={styles.spark} />
      </td>
      <td className={styles.num}>
        <b>{money(talent.current_fair_value ?? null)}</b>
        <small>{fair.length ? `${fair.length}d of values` : "no value yet"}</small>
      </td>
      <td className={styles.sparkCell}>
        <Sparkline values={fair} tone="flat" width={90} height={26} className={styles.spark} />
      </td>
      <td className={styles.num}>
        <b>{talent.ipo_price !== null ? money(talent.ipo_price) : "—"}</b>
        <small>{talent.debut_fair_value ? `debut ${money(talent.debut_fair_value)}` : "set at open"}</small>
      </td>
      <td className={styles.num}>
        <b>{offered ? offered.toLocaleString("en-US") : "—"}</b>
        <small>{talent.starting_max_supply ? `of ${talent.starting_max_supply.toLocaleString("en-US")} max` : "offered"}</small>
      </td>
      <td className={styles.num}>
        <b>{talent.status === "listed" ? (talent.shares_allocated ?? 0).toLocaleString("en-US") : talent.subscribed_shares.toLocaleString("en-US")}</b>
        <small>
          {talent.status === "listed" ? "allocated" : "asked"} · {talent.subscribers} player{talent.subscribers === 1 ? "" : "s"}
        </small>
      </td>
      <td>
        {event.status === "announced" && talent.status === "pending" ? (
          <button type="button" className={ui.btnGhost} onClick={onRemove} disabled={busy} title="Take her out of this IPO (she stays tracked)">
            Remove
          </button>
        ) : talent.status === "listed" ? (
          <Link href={`/stocks/${talent.symbol}`} className={ui.btnGhost}>
            Stock →
          </Link>
        ) : null}
      </td>
    </tr>
  );
}

function EventCard({ event, now, hour, run, busy }: { event: IpoEvent; now: number; hour: number; run: (label: string, action: () => Promise<unknown>, done: string) => void; busy: boolean }) {
  const [editing, setEditing] = useState<IpoSettings | null>(null);
  const [confirm, setConfirm] = useState<"list" | "cancel" | null>(null);
  const stage = ipoStage(event, now);
  return (
    <article className={styles.event}>
      <header className={styles.eventHead}>
        <div className={styles.eventTitle}>
          <span className={ui.pill} data-tone={stage.tone === "blue" ? "blue" : stage.tone === "warn" ? "warn" : "dim"}>
            {stage.label}
          </span>
          <h3>{event.title}</h3>
          <p>
            Window {etMoment(event.window_opens_at)} → {etMoment(event.window_closes_at)} · trading starts {listingDay(event.listing_date)}
            {stage.next ? <b> · {stage.next.label.toLowerCase()} {until(stage.next.at, now)}</b> : null}
          </p>
          <p className={styles.terms}>
            IPO price = debut value − {event.discount_pct}% · {event.offering_pct}% of max shares offered · {event.player_cap_pct}% of the offering per player
          </p>
        </div>
        <div className={styles.eventActions}>
          {event.status === "announced" ? (
            <>
              <button type="button" className={ui.btn} disabled={busy} onClick={() => setEditing(editing ? null : settingsFrom(event))}>
                {editing ? "Close" : "Edit"}
              </button>
              <button type="button" className={ui.btnPrimary} disabled={busy} onClick={() => run("open", () => openIpoWindow(event.id), "Window open: prices and offerings are set.")}>
                Open window now
              </button>
            </>
          ) : null}
          {event.status === "open" ? (
            confirm === "list" ? (
              <button type="button" className={ui.btnPrimary} disabled={busy} onClick={() => (setConfirm(null), run("list", () => listIpoNow(event.id), "Listed: subscriptions filled and the stocks are tradable."))}>
                Confirm: list now
              </button>
            ) : (
              <button type="button" className={ui.btn} disabled={busy} onClick={() => setConfirm("list")} title="Normally the 09:00 settlement on the listing day does this">
                List now…
              </button>
            )
          ) : null}
          {event.status === "announced" || event.status === "open" ? (
            confirm === "cancel" ? (
              <button type="button" className={ui.btnDangerSolid} disabled={busy} onClick={() => (setConfirm(null), run("cancel", () => cancelIpo(event.id), "IPO called off; subscriptions refunded."))}>
                Confirm: call it off
              </button>
            ) : (
              <button type="button" className={ui.btnDanger} disabled={busy} onClick={() => setConfirm("cancel")}>
                Call off…
              </button>
            )
          ) : null}
          {event.status !== "cancelled" ? (
            <Link href="/market/ipo" className={ui.btnGhost}>
              Public page →
            </Link>
          ) : null}
        </div>
      </header>
      {event.last_error ? <Notice tone="error">Last attempt: {ipoErrorText(Object.assign(new Error(event.last_error.split(":")[0]), { body: { field: event.last_error.split(": ")[1] } }))}</Notice> : null}
      {editing ? (
        <form
          className={styles.editForm}
          onSubmit={(formEvent) => {
            formEvent.preventDefault();
            run("save", () => updateIpo(event.id, editing), "Saved.");
            setEditing(null);
          }}
        >
          <SettingsFields value={editing} onChange={setEditing} hour={hour} />
          <button type="submit" className={ui.btnPrimary} disabled={busy}>
            Save
          </button>
        </form>
      ) : null}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th />
              <th>Talent</th>
              <th>Tracked</th>
              <th>Subscribers</th>
              <th>Views</th>
              <th aria-label="Subscribers trend" />
              <th>Fair value</th>
              <th aria-label="Fair value trend" />
              <th>IPO price</th>
              <th>Offered</th>
              <th>Demand</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {event.talents.map((talent) => (
              <FunnelRow key={talent.listing_id} event={event} talent={talent} busy={busy} onRemove={() => run("remove", () => removeIpoTalent(event.id, talent.listing_id), `${talent.symbol} taken out of the IPO.`)} />
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function CandidateRow({ talent, draft, onDraft, used }: { talent: DetectedTalent; draft: Draft; onDraft: (next: Draft) => void; used: Set<string> }) {
  const symbolOk = SYMBOL.test(draft.symbol) && !used.has(draft.symbol);
  return (
    <tr data-selected={draft.selected || undefined}>
      <td>
        <input type="checkbox" checked={draft.selected} onChange={(event) => onDraft({ ...draft, selected: event.target.checked })} aria-label={`Include ${talent.name_english || talent.name_short}`} />
      </td>
      <td className={styles.refCell}>
        {talent.reference_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={talent.reference_image_url} alt="" loading="lazy" referrerPolicy="no-referrer" />
        ) : null}
      </td>
      <td className={styles.nameCell}>
        <b>{talent.name_english || talent.name_short}</b>
        <small>
          {talent.name_japanese ? <span lang="ja">{talent.name_japanese} · </span> : null}
          {talent.birthday ? `born ${talent.birthday.slice(5)} · ` : ""}
          {talent.twitter_id ? `@${talent.twitter_id}` : ""}
        </small>
        <small>
          <a href={talent.youtube_channel_url} target="_blank" rel="noreferrer">
            YouTube ↗
          </a>{" "}
          <a href={talent.profile_url} target="_blank" rel="noreferrer">
            Profile ↗
          </a>
        </small>
      </td>
      <td>
        <input
          className={`${ui.input} ${styles.symbolInput}`}
          value={draft.symbol}
          maxLength={5}
          aria-invalid={!symbolOk || undefined}
          aria-label="Ticker"
          onChange={(event) => onDraft({ ...draft, symbol: event.target.value.toUpperCase().replace(/[^A-Z]/g, "") })}
        />
        {!symbolOk ? <small className={styles.warnText}>{used.has(draft.symbol) ? "taken" : "2–5 letters"}</small> : null}
      </td>
      <td>
        <span className={styles.colorField}>
          <input type="color" value={HEX.test(draft.color) ? draft.color : "#3fb8f5"} onChange={(event) => onDraft({ ...draft, color: event.target.value })} aria-label="Colour" />
          <input className={`${ui.input} ${styles.hexInput}`} value={draft.color} maxLength={7} placeholder="#rrggbb" onChange={(event) => onDraft({ ...draft, color: event.target.value.trim() })} aria-label="Colour hex" />
        </span>
      </td>
      <td>
        <input className={ui.input} value={draft.unit} onChange={(event) => onDraft({ ...draft, unit: event.target.value })} aria-label="Unit" />
      </td>
    </tr>
  );
}

/**
 * IPOs: find new talents on hololive's site, start tracking them as prelaunch stocks inside an IPO,
 * watch their channel data come in, then open the window and list (both also happen on schedule).
 */
export function AdminIpoPage() {
  const access = useAdminAccess();
  const now = useNow(1000);
  const [data, setData] = useState<AdminIpoOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [detected, setDetected] = useState<{ talents: DetectedTalent[]; checkedAt: string; profiles: number; errors: number } | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [pickedAssets, setPickedAssets] = useState<Set<number>>(new Set());
  const [settings, setSettings] = useState<IpoSettings | null>(null);

  const load = useCallback(() => {
    fetchAdminIpo()
      .then((next) => {
        setData(next);
        setError(null);
        setSettings((current) =>
          current ?? {
            title: "",
            listing_date: next.defaults.listing_date,
            window_hours: next.defaults.windowHours,
            discount_pct: next.defaults.discountPct,
            offering_pct: next.defaults.offeringPct,
            player_cap_pct: next.defaults.playerCapPct,
          },
        );
      })
      .catch((caught) => setError(ipoErrorText(caught)));
  }, []);

  useEffect(() => {
    if (!access.initialized || !access.isAdmin) return;
    load();
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, [access.initialized, access.isAdmin, load]);

  const used = useMemo(() => new Set(data?.used_symbols ?? []), [data]);
  const draftSymbols = useMemo(() => Object.values(drafts).filter((draft) => draft.selected).map((draft) => draft.symbol), [drafts]);
  const duplicateSymbol = draftSymbols.find((symbol, index) => draftSymbols.indexOf(symbol) !== index) ?? null;

  const run = useCallback(
    (label: string, action: () => Promise<unknown>, done: string) => {
      setBusy(true);
      setError(null);
      setOk(null);
      action()
        .then(() => {
          setOk(done);
          load();
        })
        .catch((caught) => setError(ipoErrorText(caught)))
        .finally(() => setBusy(false));
    },
    [load],
  );

  const detect = () => {
    setDetecting(true);
    setError(null);
    detectTalents()
      .then((result) => {
        setDetected({ talents: result.talents, checkedAt: result.checked_at, profiles: result.profiles_checked, errors: result.errors.length });
        setDrafts((current) => {
          const next = { ...current };
          for (const talent of result.talents) {
            next[talent.youtube_channel_id] ??= { selected: true, symbol: talent.symbol || "", color: "", unit: talent.unit || "" };
          }
          return next;
        });
        setSettings((current) => (current && !current.title && result.talents[0]?.unit ? { ...current, title: `${result.talents[0].unit} IPO` } : current));
      })
      .catch((caught) => setError(ipoErrorText(caught)))
      .finally(() => setDetecting(false));
  };

  const selectedNew = (detected?.talents ?? []).filter((talent) => drafts[talent.youtube_channel_id]?.selected);
  const invalidNew = selectedNew.filter((talent) => {
    const draft = drafts[talent.youtube_channel_id];
    return !SYMBOL.test(draft.symbol) || used.has(draft.symbol) || (draft.color !== "" && !HEX.test(draft.color));
  });
  const pickedCount = selectedNew.length + pickedAssets.size;
  const canCreate = Boolean(settings && settings.title.trim() && settings.listing_date && pickedCount > 0 && !invalidNew.length && !duplicateSymbol && !busy);

  const create = () => {
    if (!settings || !canCreate) return;
    const talents = selectedNew.map((talent) => {
      const draft = drafts[talent.youtube_channel_id];
      return {
        youtube_channel_id: talent.youtube_channel_id,
        name_short: talent.name_short,
        name_english: talent.name_english,
        name_japanese: talent.name_japanese,
        twitter_id: talent.twitter_id,
        profile_id: talent.profile_id,
        birthday: talent.birthday,
        height: talent.height,
        icon: talent.icon,
        reference_image_url: talent.reference_image_url,
        symbol: draft.symbol,
        color: draft.color,
        unit: draft.unit,
      };
    });
    run(
      "create",
      async () => {
        const result = await createIpo({ ...settings, talents, asset_ids: [...pickedAssets] });
        setDetected((current) => (current ? { ...current, talents: current.talents.filter((talent) => !drafts[talent.youtube_channel_id]?.selected) } : current));
        setPickedAssets(new Set());
        setSettings((current) => (current ? { ...current, title: "" } : current));
        const uploaded = result.reference_images.filter((image) => image.uploaded).length;
        return uploaded;
      },
      `IPO created. ${selectedNew.length ? "Their channels are being tracked from tonight's 00:05 ET scrape." : ""}`,
    );
  };

  if (!access.initialized) return <AdminLoading title="IPOs" />;
  if (!access.isAdmin) return <AdminGate title="IPOs" signedIn={access.signedIn} need="admins" headline="Admins only." />;

  const hour = data?.settlement.hour ?? 9;
  const liveEvents = (data?.events ?? []).filter((event) => event.status === "announced" || event.status === "open");
  const pastEvents = (data?.events ?? []).filter((event) => event.status === "listed" || event.status === "cancelled");

  return (
    <AdminFrame
      title="IPOs"
      blurb={
        <>
          New talents come to market through an IPO (<Link href="/market/ipo">public page</Link>). Creating one starts tracking their channels right away as
          prelaunch stocks: not tradable, never holding up settlement. The window opens on its own, pricing each talent at her debut value less the
          discount; the 09:00 settlement on the listing day fills subscriptions and lists her.
        </>
      }
    >
      {error ? <Notice onClose={() => setError(null)}>{error}</Notice> : null}
      {ok ? (
        <Notice tone="ok" onClose={() => setOk(null)}>
          {ok}
        </Notice>
      ) : null}

      <Section
        title="Detect new talents"
        count={detected ? detected.talents.length : undefined}
        hint={detected ? `Checked ${detected.profiles} profiles on hololive's site ${etMoment(detected.checkedAt)}${detected.errors ? ` · ${detected.errors} couldn't be read` : ""}` : "Talents on hololive's official site that aren't channels here yet."}
        actions={
          <button type="button" className={ui.btnPrimary} onClick={detect} disabled={detecting}>
            {detecting ? "Checking…" : detected ? "Check again" : "Check hololive's site"}
          </button>
        }
      >
        {detected && !detected.talents.length ? <p className={ui.empty}>Nobody new. Every talent on the site is already a channel here.</p> : null}
        {detected?.talents.length ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th aria-label="Include" />
                  <th aria-label="Reference picture" />
                  <th>Talent</th>
                  <th>Ticker</th>
                  <th>Colour</th>
                  <th>Unit</th>
                </tr>
              </thead>
              <tbody>
                {detected.talents.map((talent) => (
                  <CandidateRow
                    key={talent.youtube_channel_id}
                    talent={talent}
                    used={used}
                    draft={drafts[talent.youtube_channel_id]}
                    onDraft={(next) => setDrafts((current) => ({ ...current, [talent.youtube_channel_id]: next }))}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {duplicateSymbol ? <p className={styles.warnText}>Two talents share the ticker {duplicateSymbol}.</p> : null}
      </Section>

      {data?.unassigned.length ? (
        <Section title="Tracked, not in an IPO" count={data.unassigned.length} hint="Prelaunch stocks (added another way, or from a called-off IPO). Tick to add them to the next IPO.">
          <ul className={styles.unassigned}>
            {data.unassigned.map((talent) => (
              <li key={talent.asset_id}>
                <label>
                  <input
                    type="checkbox"
                    checked={pickedAssets.has(talent.asset_id)}
                    onChange={(event) =>
                      setPickedAssets((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(talent.asset_id);
                        else next.delete(talent.asset_id);
                        return next;
                      })
                    }
                  />
                  <Badge symbol={talent.symbol} color={talent.color} />
                  <span>
                    <b>{talent.display_name}</b>
                    <small>
                      {talent.unit || "no unit"} · {talent.channel.days_tracked}d tracked · {compactCount(talent.channel.latest?.subscribers)} subs
                    </small>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="New IPO" hint={pickedCount ? `${pickedCount} talent${pickedCount === 1 ? "" : "s"} picked` : "Pick talents above first."}>
        {settings ? (
          <form
            className={styles.createForm}
            onSubmit={(formEvent) => {
              formEvent.preventDefault();
              create();
            }}
          >
            <SettingsFields value={settings} onChange={setSettings} hour={hour} />
            <div className={styles.createActions}>
              <button type="submit" className={ui.btnPrimary} disabled={!canCreate}>
                {busy ? "Working…" : `Create IPO${pickedCount ? ` with ${pickedCount}` : ""} and start tracking`}
              </button>
              {invalidNew.length ? <small className={styles.warnText}>Fix the ticker or colour for {invalidNew.map((talent) => talent.name_short).join(", ")}.</small> : null}
            </div>
          </form>
        ) : (
          <p className={ui.empty}>Loading…</p>
        )}
      </Section>

      <Section title="IPOs" count={liveEvents.length} hint="Coming and open. Data refreshes every 30 seconds; stats arrive with the nightly scrape.">
        {data && !liveEvents.length ? <p className={ui.empty}>No IPO in progress.</p> : null}
        {liveEvents.map((event) => (
          <EventCard key={event.id} event={event} now={now} hour={hour} run={run} busy={busy} />
        ))}
      </Section>

      {pastEvents.length ? (
        <Section title="Past IPOs" count={pastEvents.length}>
          {pastEvents.map((event) => (
            <EventCard key={event.id} event={event} now={now} hour={hour} run={run} busy={busy} />
          ))}
        </Section>
      ) : null}
    </AdminFrame>
  );
}
