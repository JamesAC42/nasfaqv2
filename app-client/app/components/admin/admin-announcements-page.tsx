"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  createAnnouncement,
  deleteAnnouncement,
  fetchAnnouncements,
  restoreAnnouncement,
  retireAnnouncement,
  updateAnnouncement,
  type AdminAnnouncement,
  type AnnouncementDraft,
  type PopupAudience,
} from "@/app/components/admin/admin-api";
import { AdminFrame, AdminGate, AdminLoading, useAdminAccess } from "@/app/components/admin/admin-frame";
import { Notice, Section, adminErrorText, adminUi as ui, etTime, fmtCount } from "@/app/components/admin/admin-ui";
import { AnnouncementCard } from "@/app/components/common/announcement-popup";
import { apiErrorCode, type ApiError } from "@/app/lib/api";
import styles from "@/app/components/admin/admin-announcements-page.module.scss";

const TITLE_MAX = 120;
const BODY_MAX = 1000;
const BUTTON_LABEL_MAX = 40;

const AUDIENCES: Array<{ value: PopupAudience; label: string }> = [
  { value: "everyone", label: "Everyone" },
  { value: "signed_in", label: "Signed-in players" },
  { value: "signed_out", label: "Signed-out visitors" },
];
const audienceLabel = (value: PopupAudience) => AUDIENCES.find((entry) => entry.value === value)?.label ?? value;

const STATUS: Record<AdminAnnouncement["status"], { label: string; tone?: "blue" | "warn" | "dim" }> = {
  live: { label: "Live", tone: "blue" },
  scheduled: { label: "Scheduled", tone: "warn" },
  ended: { label: "Ended", tone: "dim" },
  retired: { label: "Retired", tone: "dim" },
};

const FIELD_ERRORS: Record<string, string> = {
  title: `Give it a title, up to ${TITLE_MAX} characters.`,
  body: `Write something, up to ${BODY_MAX} characters.`,
  button_label: `A button needs a label, up to ${BUTTON_LABEL_MAX} characters.`,
  button_link: "A button needs a link that starts with / or https://, with no spaces.",
  audience: "Pick who it's for.",
  starts_at: "That start time isn't valid.",
  ends_at: "The end has to be after the start.",
};

type Form = {
  title: string;
  body: string;
  button_label: string;
  button_link: string;
  audience: PopupAudience;
  hide_from_v1_linked: boolean;
  starts_at: string;
  ends_at: string;
};

const EMPTY: Form = { title: "", body: "", button_label: "", button_link: "", audience: "everyone", hide_from_v1_linked: false, starts_at: "", ends_at: "" };

const pad = (n: number) => String(n).padStart(2, "0");
/** An instant as a datetime-local input wants it: the admin's own time, to the minute. */
function toLocalInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const toForm = (row: AdminAnnouncement): Form => ({
  title: row.title,
  body: row.body,
  button_label: row.button_label ?? "",
  button_link: row.button_link ?? "",
  audience: row.audience,
  hide_from_v1_linked: row.hide_from_v1_linked,
  starts_at: toLocalInput(row.starts_at),
  ends_at: toLocalInput(row.ends_at),
});

/**
 * The form as the API wants it. The inputs only go to the minute, so an edit leaves a time out unless
 * it was changed, or every save would nudge it.
 */
function toDraft(form: Form, editing: AdminAnnouncement | null): AnnouncementDraft {
  const { starts_at: startsAt, ends_at: endsAt, ...rest } = form;
  const draft: AnnouncementDraft = rest;
  if (!editing || startsAt !== toLocalInput(editing.starts_at)) draft.starts_at = startsAt ? new Date(startsAt).toISOString() : null;
  if (!editing || endsAt !== toLocalInput(editing.ends_at)) draft.ends_at = endsAt ? new Date(endsAt).toISOString() : null;
  return draft;
}

function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode }) {
  return (
    <label className={ui.field}>
      <span>{label}</span>
      {children}
      {error ? (
        <small className={ui.inlineError} role="alert">
          {error}
        </small>
      ) : hint ? (
        <small className={styles.hint}>{hint}</small>
      ) : null}
    </label>
  );
}

/**
 * /admin/announcements: the popups visitors see once. Write one, schedule it or post it now, and
 * retire it when it's done. The banner under the header is separate: it's on the back office page.
 */
export function AdminAnnouncementsPage() {
  const access = useAdminAccess();
  const [rows, setRows] = useState<AdminAnnouncement[] | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [editing, setEditing] = useState<AdminAnnouncement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ field: string; text: string } | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [armed, setArmed] = useState<number | null>(null);
  const titleField = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setRows((await fetchAnnouncements()).announcements);
      setError(null);
    } catch (caught) {
      setError(adminErrorText(caught));
    }
  }, []);

  useEffect(() => {
    if (!access.initialized || !access.isAdmin) return;
    const first = setTimeout(() => void load(), 0);
    return () => clearTimeout(first);
  }, [access.initialized, access.isAdmin, load]);

  if (!access.initialized) return <AdminLoading title="Announcements" />;
  if (!access.isAdmin) return <AdminGate title="Announcements" signedIn={access.signedIn} need="admins" headline="Admins only." />;

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setFieldError((current) => (current?.field === key ? null : current));
    setSaved(null);
  };

  const reset = () => {
    setForm(EMPTY);
    setEditing(null);
    setFieldError(null);
  };

  const startEdit = (row: AdminAnnouncement) => {
    setEditing(row);
    setForm(toForm(row));
    setFieldError(null);
    setSaved(null);
    titleField.current?.scrollIntoView({ block: "center" });
    titleField.current?.focus({ preventScroll: true });
  };

  const run = async (work: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      await work();
      await load();
      if (done) setSaved(done);
      return true;
    } catch (caught) {
      const field = apiErrorCode(caught) === "invalid_announcement" ? String((caught as ApiError).body?.field ?? "") : "";
      if (FIELD_ERRORS[field]) setFieldError({ field, text: FIELD_ERRORS[field] });
      else setError(adminErrorText(caught));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const startsLater = Boolean(form.starts_at) && new Date(form.starts_at).getTime() > Date.now();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const draft = toDraft(form, editing);
    const label = editing ? "Saved." : startsLater ? "Scheduled." : "Posted. It reaches visitors within a few minutes.";
    const ok = await run(() => (editing ? updateAnnouncement(editing.id, draft) : createAnnouncement(draft)), label);
    if (ok) reset();
  };

  const errorOf = (field: string) => (fieldError?.field === field ? fieldError.text : null);
  const preview = {
    title: form.title.trim() || "Title goes here",
    body: form.body.trim() || "What you want to tell visitors goes here.",
    button_label: form.button_label.trim() || null,
    button_link: form.button_link.trim() || null,
  };

  return (
    <AdminFrame
      title="Announcements"
      blurb={
        <>
          Popups visitors see once. Each visitor gets the oldest one they haven&apos;t dismissed, one at a time and at most every 12 hours. It waits while they&apos;re signing in, trading, typing or in a game. For something everyone needs to
          know right now, use the banner on the <Link href="/admin">back office</Link> page instead.
        </>
      }
    >
      {error ? <Notice onClose={() => setError(null)}>{error}</Notice> : null}
      {saved ? (
        <Notice tone="ok" onClose={() => setSaved(null)}>
          {saved}
        </Notice>
      ) : null}

      <Section title={editing ? `Editing #${editing.id}` : "New announcement"} hint={editing ? "Anyone who already dismissed it won't see it again, even after an edit." : undefined}>
        <div className={styles.compose}>
          <form className={styles.form} onSubmit={(event) => void submit(event)}>
            <Field label={`Title (${form.title.trim().length}/${TITLE_MAX})`} error={errorOf("title")}>
              <input ref={titleField} className={ui.input} value={form.title} maxLength={TITLE_MAX} required aria-invalid={errorOf("title") ? true : undefined} onChange={(event) => set("title", event.target.value)} />
            </Field>
            <Field label={`Text (${form.body.trim().length}/${BODY_MAX})`} hint="Plain text. Line breaks show; links and formatting don't." error={errorOf("body")}>
              <textarea className={`${ui.input} ${styles.body}`} rows={6} value={form.body} maxLength={BODY_MAX} required aria-invalid={errorOf("body") ? true : undefined} onChange={(event) => set("body", event.target.value)} />
            </Field>
            <div className={styles.pair}>
              <Field label="Button label (optional)" error={errorOf("button_label")}>
                <input className={ui.input} value={form.button_label} maxLength={BUTTON_LABEL_MAX} aria-invalid={errorOf("button_label") ? true : undefined} onChange={(event) => set("button_label", event.target.value)} />
              </Field>
              <Field label="Button link" hint="A page here (/link-v1) or an https:// address." error={errorOf("button_link")}>
                <input className={ui.input} value={form.button_link} maxLength={300} placeholder="/link-v1" aria-invalid={errorOf("button_link") ? true : undefined} onChange={(event) => set("button_link", event.target.value)} />
              </Field>
            </div>
            <div className={styles.pair}>
              <Field label="Starts" hint="Your local time. Blank means now." error={errorOf("starts_at")}>
                <input className={ui.input} type="datetime-local" value={form.starts_at} aria-invalid={errorOf("starts_at") ? true : undefined} onChange={(event) => set("starts_at", event.target.value)} />
              </Field>
              <Field label="Ends" hint="Your local time. Blank means until you retire it." error={errorOf("ends_at")}>
                <input className={ui.input} type="datetime-local" value={form.ends_at} aria-invalid={errorOf("ends_at") ? true : undefined} onChange={(event) => set("ends_at", event.target.value)} />
              </Field>
            </div>
            <Field label="Who it's for" error={errorOf("audience")}>
              <select className={ui.select} value={form.audience} onChange={(event) => set("audience", event.target.value as PopupAudience)}>
                {AUDIENCES.map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </Field>
            <label className={styles.check}>
              <input type="checkbox" checked={form.hide_from_v1_linked} onChange={(event) => set("hide_from_v1_linked", event.target.checked)} />
              <span>Hide it from players who have linked a v1 account</span>
            </label>
            <div className={styles.buttons}>
              <button type="submit" className={ui.btnPrimary} disabled={busy}>
                {busy ? "Saving…" : editing ? "Save changes" : startsLater ? "Schedule" : "Post now"}
              </button>
              {editing ? (
                <button type="button" className={ui.btn} disabled={busy} onClick={reset}>
                  Cancel
                </button>
              ) : null}
            </div>
          </form>
          <div className={styles.preview}>
            <span className={styles.previewLabel}>Preview</span>
            <AnnouncementCard announcement={preview} />
          </div>
        </div>
      </Section>

      <Section title="All announcements" count={rows ? rows.length : "…"} hint="Dismissal counts are signed-in players only.">
        {!rows ? (
          <p className={ui.empty}>Loading…</p>
        ) : rows.length ? (
          <ul className={styles.list}>
            {rows.map((row) => (
              <li key={row.id} className={styles.row}>
                <div className={styles.main}>
                  <span className={styles.titleLine}>
                    <span className={ui.pill} data-tone={STATUS[row.status].tone}>
                      {STATUS[row.status].label}
                    </span>
                    <b>{row.title}</b>
                  </span>
                  <p className={styles.excerpt}>{row.body}</p>
                  <span className={styles.meta}>
                    <span>{audienceLabel(row.audience)}</span>
                    {row.hide_from_v1_linked ? <span>hidden from v1-linked players</span> : null}
                    <span>
                      from {etTime(row.starts_at)}
                      {row.ends_at ? ` to ${etTime(row.ends_at)}` : ", no end"}
                    </span>
                    {row.button_link ? (
                      <span>
                        {row.button_label} → {row.button_link}
                      </span>
                    ) : null}
                    <span>{fmtCount(row.dismissed_count)} dismissed</span>
                    {row.created_by ? <span>by {row.created_by}</span> : null}
                  </span>
                </div>
                <span className={styles.actions}>
                  <button type="button" className={ui.btn} disabled={busy} onClick={() => startEdit(row)}>
                    Edit
                  </button>
                  {row.status === "retired" ? (
                    <button type="button" className={ui.btn} disabled={busy} onClick={() => void run(() => restoreAnnouncement(row.id))}>
                      Bring back
                    </button>
                  ) : (
                    <button type="button" className={ui.btn} disabled={busy} onClick={() => void run(() => retireAnnouncement(row.id))}>
                      Retire
                    </button>
                  )}
                  {armed === row.id ? (
                    <>
                      <button
                        type="button"
                        className={ui.btnDangerSolid}
                        disabled={busy}
                        onClick={() => {
                          setArmed(null);
                          if (editing?.id === row.id) reset();
                          void run(() => deleteAnnouncement(row.id));
                        }}
                      >
                        Delete for good
                      </button>
                      <button type="button" className={ui.btn} disabled={busy} onClick={() => setArmed(null)}>
                        Keep
                      </button>
                    </>
                  ) : (
                    <button type="button" className={ui.btnDanger} disabled={busy} onClick={() => setArmed(row.id)}>
                      Delete
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={ui.empty}>No announcements yet.</p>
        )}
      </Section>
    </AdminFrame>
  );
}
