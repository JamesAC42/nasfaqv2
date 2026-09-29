"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { MarketPreview, type PreviewOutcome } from "@/app/components/predictions/admin/market-preview";
import { useNow, useStaffFlags } from "@/app/components/predictions/admin/staff-parts";
import { TalentPicker, useTalents, type TalentOption } from "@/app/components/predictions/admin/talent-picker";
import { PredictionsFrame } from "@/app/components/predictions/shell/predictions-frame";
import { createMarket, fetchCategories, type PredictionApiError } from "@/app/lib/predictions/api";
import { predictionErrorText } from "@/app/lib/predictions/errors";
import { money, outcomeColor, percent } from "@/app/lib/predictions/format";
import type { Category, CreateMarketInput } from "@/app/lib/predictions/types";
import { talentAccent } from "@/app/lib/talent-color";
import { useAuth } from "@/app/providers/auth-provider";
import styles from "@/app/components/predictions/admin/create-market.module.scss";

// /predictions/create: the new-market form (spec §1, §2, §7). Everything the API validates is
// checked here first; a server-side `invalid_prediction_market` highlights `error.body.field`.

type Shape = "binary" | "multi";
type OutcomeDraft = { key: number; label: string; symbol: string; weight: string };
type Mode = "publish" | "submit" | "draft";

const DEFAULT_B: Record<Shape, number> = { binary: 1000, multi: 800 };
const B_PRESETS = [
  { b: 300, label: "Thin" },
  { b: 1000, label: "Normal" },
  { b: 2500, label: "Deep" },
  { b: 5000, label: "Very deep" },
];
const LABEL_PRESETS = [
  ["Yes", "No"],
  ["Up", "Down"],
  ["Over", "Under"],
];

const FIELD_COPY: Record<string, string> = {
  title: "Give it a question between 4 and 200 characters.",
  subtitle: "Keep the subtitle under 240 characters.",
  description: "The description is too long.",
  rules_text: "Rules need at least 10 characters. Spell out what counts.",
  resolution_source_text: "Say where the answer will come from.",
  closes_at: "Close time has to be in the future.",
  resolves_after: "Resolves-after can't be before the close.",
  opens_at: "Check the open time.",
  outcomes: "Multi markets need 3–12 outcomes, each with a different name.",
  yes_label: "Name this side (up to 40 characters).",
  no_label: "Name this side (up to 40 characters).",
  featured_image_url: "Check the image link.",
};

const pad = (n: number) => String(n).padStart(2, "0");
function toLocalInput(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

let outcomeKey = 0;
const blankOutcome = (): OutcomeDraft => ({ key: ++outcomeKey, label: "", symbol: "", weight: "" });

/** Price after spending `cash` on an outcome at starting price p (LMSR, fee excluded): 1 − (1 − p)·e^(−c/b). */
const priceAfter = (p: number, cash: number, b: number) => 1 - (1 - p) * Math.exp(-cash / b);

function Field({ field, label, hint, error, children, optional }: { field: string; label: string; hint?: ReactNode; error?: string; children: ReactNode; optional?: boolean }) {
  return (
    <div className={styles.field} data-field={field} data-invalid={error ? true : undefined}>
      <span className={styles.fieldLabel}>
        {label}
        {optional ? <small>optional</small> : null}
      </span>
      {children}
      {error ? (
        <em className={styles.fieldError} role="alert">
          {error}
        </em>
      ) : hint ? (
        <span className={styles.hint}>{hint}</span>
      ) : null}
    </div>
  );
}

export function CreateMarketForm() {
  const router = useRouter();
  const { initialized, user } = useAuth();
  const flags = useStaffFlags();
  const talents = useTalents();
  const now = useNow(15_000);
  const id = useId();

  const [shape, setShape] = useState<Shape>("binary");
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [description, setDescription] = useState("");
  const [rules, setRules] = useState("");
  const [source, setSource] = useState("");
  const [category, setCategory] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [probability, setProbability] = useState(50);
  const [yesLabel, setYesLabel] = useState("");
  const [noLabel, setNoLabel] = useState("");
  const [outcomes, setOutcomes] = useState<OutcomeDraft[]>(() => [blankOutcome(), blankOutcome(), blankOutcome()]);
  const [closesAt, setClosesAt] = useState(() => toLocalInput(new Date(Date.now() + 7 * 86_400_000)));
  const [resolvesAfter, setResolvesAfter] = useState("");
  const [disputeHours, setDisputeHours] = useState("12");
  const [b, setB] = useState("");
  const [feePct, setFeePct] = useState("1");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Mode | null>(null);

  useEffect(() => {
    let alive = true;
    fetchCategories()
      .then((result) => alive && setCategories(result.categories.filter((entry) => entry.slug !== "ticks" && entry.slug !== "streams")))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const bValue = b.trim() === "" ? DEFAULT_B[shape] : Number(b);
  const feeBps = Math.round(Number(feePct || 0) * 100);
  const hours = Number(disputeHours);
  const n = shape === "binary" ? 2 : outcomes.length;
  const worst = bValue > 0 ? bValue * Math.log(n) : NaN;

  // Normalised starting probabilities for multi (blank weight = an even share).
  const weights = outcomes.map((outcome) => {
    const w = Number(outcome.weight);
    return outcome.weight.trim() === "" || !Number.isFinite(w) || w <= 0 ? 100 / outcomes.length : w;
  });
  const weightSum = weights.reduce((sum, w) => sum + w, 0) || 1;
  const normalised = weights.map((w) => w / weightSum);

  const talentBy = useMemo(() => new Map(talents.map((talent) => [talent.symbol, talent])), [talents]);

  const previewOutcomes: PreviewOutcome[] =
    shape === "binary"
      ? [
          { key: "yes", label: yesLabel.trim() || "Yes", price: probability / 100, color: outcomeColor({ market_type: "binary" }, { outcome_code: "yes", asset: null, sort_order: 0 }), talent: null },
          { key: "no", label: noLabel.trim() || "No", price: 1 - probability / 100, color: outcomeColor({ market_type: "binary" }, { outcome_code: "no", asset: null, sort_order: 1 }), talent: null },
        ]
      : outcomes.map((outcome, index) => {
          const talent = outcome.symbol ? (talentBy.get(outcome.symbol) ?? null) : null;
          return {
            key: outcome.key,
            label: outcome.label.trim(),
            price: normalised[index],
            color: outcomeColor({ market_type: "multi" }, { outcome_code: `o${index + 1}`, asset: talent ? { symbol: talent.symbol, icon: talent.icon, color: talent.color } : null, sort_order: index }),
            talent,
          };
        });

  const first = previewOutcomes[0];
  const moveCash = 100 / (1 + feeBps / 10_000);
  const moveTo = bValue > 0 && first ? priceAfter(first.price, moveCash, bValue) : null;

  const clearError = (field: string) =>
    setErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });

  const setOutcome = (key: number, patch: Partial<OutcomeDraft>) => setOutcomes((current) => current.map((outcome) => (outcome.key === key ? { ...outcome, ...patch } : outcome)));

  const pickTalent = (key: number, index: number, talent: TalentOption | null) => {
    const outcome = outcomes.find((entry) => entry.key === key);
    const patch: Partial<OutcomeDraft> = { symbol: talent?.symbol ?? "" };
    if (talent && outcome && !outcome.label.trim()) patch.label = talent.display_name;
    setOutcome(key, patch);
    clearError(`outcomes.${index}.label`);
  };

  function validate() {
    const next: Record<string, string> = {};
    if (title.trim().length < 4 || title.trim().length > 200) next.title = FIELD_COPY.title;
    if (subtitle.trim().length > 240) next.subtitle = FIELD_COPY.subtitle;
    if (rules.trim().length < 10) next.rules_text = FIELD_COPY.rules_text;
    if (source.trim().length < 3) next.resolution_source_text = FIELD_COPY.resolution_source_text;
    const closes = new Date(closesAt);
    if (!closesAt || Number.isNaN(closes.getTime()) || closes.getTime() <= Date.now() + 60_000) next.closes_at = FIELD_COPY.closes_at;
    if (resolvesAfter) {
      const resolves = new Date(resolvesAfter);
      if (Number.isNaN(resolves.getTime()) || (!next.closes_at && resolves < closes)) next.resolves_after = FIELD_COPY.resolves_after;
    }
    if (!Number.isInteger(hours) || hours < 1 || hours > 72) next.dispute_hours = "Pick a window between 1 and 72 hours.";
    if (!Number.isFinite(bValue) || bValue < 10 || bValue > 100_000) next.liquidity_b = "Liquidity b must be between 10 and 100,000.";
    if (!Number.isFinite(feeBps) || feeBps < 0 || feeBps > 1000) next.fee_bps = "Fee must be between 0% and 10%.";
    if (shape === "binary") {
      if (yesLabel.trim().length > 40) next.yes_label = FIELD_COPY.yes_label;
      if (noLabel.trim().length > 40) next.no_label = FIELD_COPY.no_label;
      if (yesLabel.trim() && noLabel.trim() && yesLabel.trim().toLowerCase() === noLabel.trim().toLowerCase()) next.no_label = "The two sides need different names.";
    } else {
      const seen = new Map<string, number>();
      outcomes.forEach((outcome, index) => {
        const label = outcome.label.trim();
        if (!label) next[`outcomes.${index}.label`] = "Name this outcome.";
        else if (label.length > 80) next[`outcomes.${index}.label`] = "Keep it under 80 characters.";
        else if (seen.has(label.toLowerCase())) next[`outcomes.${index}.label`] = "Two outcomes have this name.";
        else seen.set(label.toLowerCase(), index);
      });
    }
    return next;
  }

  function focusField(field: string) {
    requestAnimationFrame(() => {
      const holder = document.querySelector<HTMLElement>(`[data-field="${CSS.escape(field)}"]`) ?? (field.startsWith("outcomes") ? document.querySelector<HTMLElement>('[data-field="outcomes"]') : null);
      if (!holder) return;
      holder.scrollIntoView({ block: "center", behavior: "smooth" });
      holder.querySelector<HTMLElement>("input, textarea, select")?.focus({ preventScroll: true });
    });
  }

  async function submit(mode: Mode) {
    setFormError(null);
    const found = validate();
    setErrors(found);
    const firstField = Object.keys(found)[0];
    if (firstField) {
      setFormError("A few fields need fixing.");
      focusField(firstField);
      return;
    }
    const input: CreateMarketInput = {
      title: title.trim(),
      subtitle: subtitle.trim() || undefined,
      description: description.trim() || undefined,
      rules_text: rules.trim(),
      resolution_source_text: source.trim(),
      category: category || undefined,
      market_type: shape,
      closes_at: new Date(closesAt).toISOString(),
      resolves_after: resolvesAfter ? new Date(resolvesAfter).toISOString() : undefined,
      dispute_hours: hours,
      liquidity_b: bValue,
      fee_bps: feeBps,
      publish: mode === "publish" || undefined,
      submit: mode === "submit" || undefined,
    };
    if (shape === "binary") {
      input.probability = probability / 100;
      if (yesLabel.trim()) input.yes_label = yesLabel.trim();
      if (noLabel.trim()) input.no_label = noLabel.trim();
    } else {
      input.outcomes = outcomes.map((outcome, index) => ({
        label: outcome.label.trim(),
        asset_symbol: outcome.symbol || undefined,
        probability: Math.round(normalised[index] * 10_000) / 10_000,
      }));
    }
    setBusy(mode);
    try {
      const result = await createMarket(input);
      router.push(`/predictions/${result.market.slug}`);
    } catch (caught) {
      const error = caught as PredictionApiError;
      const field = error.body?.field;
      if (error.message === "invalid_prediction_market" && field) {
        const message = FIELD_COPY[field] ?? (field.startsWith("outcomes.") ? "Check this outcome's name." : "Check this field.");
        setErrors({ [field]: message });
        setFormError(message);
        focusField(field);
      } else {
        setFormError(predictionErrorText(caught));
      }
      setBusy(null);
    }
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit(flags.isAdmin ? "publish" : "submit");
  };

  // ── Gates ────────────────────────────────────────────────────────────────
  if (!initialized) {
    return (
      <PredictionsFrame kicker="New market" title="Ask the floor">
        <p className={styles.gateText}>Loading…</p>
      </PredictionsFrame>
    );
  }
  if (!user || !flags.canCreate) {
    return (
      <PredictionsFrame kicker="New market" title="Ask the floor">
        <div className={styles.gate}>
          <b>{user ? "You can't make markets yet." : "Sign in to make a market."}</b>
          <p>{user ? "Creating markets is a permission the mods hand out. Ask in the forum if you've got a good one." : "Market makers need an account with the create permission."}</p>
          <Link href="/predictions">Back to the floor →</Link>
        </div>
      </PredictionsFrame>
    );
  }

  const binaryYes = yesLabel.trim() || "Yes";
  const binaryNo = noLabel.trim() || "No";
  const err = (field: string) => errors[field];

  return (
    <PredictionsFrame kicker="New market" title="Ask the floor" blurb={flags.isAdmin ? "You're a site admin: publish it live, or send it to the queue." : "It goes to the approval queue; a mod opens it."}>
      <form className={styles.layout} onSubmit={onSubmit} noValidate>
        <div className={styles.form}>
          {/* ── The question ── */}
          <fieldset className={styles.block}>
            <legend>The question</legend>
            <div className={styles.shape} role="radiogroup" aria-label="Market shape">
              {(["binary", "multi"] as const).map((value) => (
                <button key={value} type="button" role="radio" aria-checked={shape === value} onClick={() => setShape(value)}>
                  <b>{value === "binary" ? "Yes / No" : "Pick one"}</b>
                  <small>{value === "binary" ? "Two sides: Yes/No, Up/Down" : "3–12 outcomes, one wins"}</small>
                </button>
              ))}
            </div>
            <Field field="title" label="Question" error={err("title")} hint="Ends in a question mark. Short enough to read on a card.">
              <input
                className={styles.input}
                value={title}
                maxLength={200}
                onChange={(event) => {
                  setTitle(event.target.value);
                  clearError("title");
                }}
                placeholder={shape === "binary" ? "Will Pekora hit 3M subscribers before New Year?" : "Who tops the superchat chart this week?"}
                aria-invalid={err("title") ? true : undefined}
              />
            </Field>
            <Field field="subtitle" label="Subtitle" optional error={err("subtitle")}>
              <input className={styles.input} value={subtitle} maxLength={240} onChange={(event) => setSubtitle(event.target.value)} placeholder="One line of context" />
            </Field>
            <Field field="description" label="Description" optional error={err("description")}>
              <textarea className={styles.textarea} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Background, links, why it's interesting." />
            </Field>
            <Field field="category" label="Category" optional>
              <select className={styles.input} value={category} onChange={(event) => setCategory(event.target.value)}>
                <option value="">No category</option>
                {categories.map((entry) => (
                  <option key={entry.slug} value={entry.slug}>
                    {entry.display_name}
                  </option>
                ))}
              </select>
            </Field>
          </fieldset>

          {/* ── Outcomes ── */}
          <fieldset className={styles.block}>
            <legend>{shape === "binary" ? "Sides and starting price" : "Outcomes"}</legend>
            {shape === "binary" ? (
              <>
                <div className={styles.field} data-field="probability">
                  <label className={styles.fieldLabel} htmlFor={`${id}-prob`}>
                    Starting chance of {binaryYes}
                  </label>
                  <div className={styles.slider}>
                    <input
                      id={`${id}-prob`}
                      type="range"
                      min={5}
                      max={95}
                      step={1}
                      value={probability}
                      onChange={(event) => setProbability(Number(event.target.value))}
                      style={{ ["--fill" as string]: `${((probability - 5) / 90) * 100}%` }}
                    />
                    <output htmlFor={`${id}-prob`}>
                      <b>{probability}%</b> {binaryYes} · <b>{100 - probability}%</b> {binaryNo}
                    </output>
                  </div>
                  <span className={styles.hint}>Where the price opens. Traders move it from there.</span>
                </div>
                <div className={styles.pair}>
                  <Field field="yes_label" label="First side" optional error={err("yes_label")}>
                    <input className={styles.input} value={yesLabel} maxLength={40} placeholder="Yes" onChange={(event) => { setYesLabel(event.target.value); clearError("yes_label"); }} />
                  </Field>
                  <Field field="no_label" label="Second side" optional error={err("no_label")}>
                    <input className={styles.input} value={noLabel} maxLength={40} placeholder="No" onChange={(event) => { setNoLabel(event.target.value); clearError("no_label"); }} />
                  </Field>
                </div>
                <div className={styles.chips} aria-label="Label presets">
                  {LABEL_PRESETS.map(([a, z]) => (
                    <button
                      key={a}
                      type="button"
                      aria-pressed={binaryYes === a && binaryNo === z}
                      onClick={() => {
                        setYesLabel(a === "Yes" ? "" : a);
                        setNoLabel(z === "No" ? "" : z);
                      }}
                    >
                      {a} / {z}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className={styles.field} data-field="outcomes" data-invalid={err("outcomes") ? true : undefined}>
                <div className={styles.outcomeHead} aria-hidden="true">
                  <span>Outcome</span>
                  <span>Talent</span>
                  <span>Weight</span>
                  <span>Opens</span>
                  <span />
                </div>
                <ol className={styles.outcomes}>
                  {outcomes.map((outcome, index) => {
                    const talent = outcome.symbol ? talentBy.get(outcome.symbol) : null;
                    const color = previewOutcomes[index]?.color ?? "var(--mid)";
                    const fieldKey = `outcomes.${index}.label`;
                    return (
                      <li key={outcome.key} className={styles.outcome} data-field={fieldKey} data-invalid={err(fieldKey) ? true : undefined} style={{ ["--oc" as string]: color, ...(talent?.color ? { ["--tal" as string]: talentAccent(talent.color) } : {}) }}>
                        <span className={styles.outcomeDot} aria-hidden="true">
                          {index + 1}
                        </span>
                        <input
                          className={styles.input}
                          value={outcome.label}
                          maxLength={80}
                          placeholder={index === outcomes.length - 1 && index >= 3 ? "Someone else" : `Outcome ${index + 1}`}
                          aria-label={`Outcome ${index + 1} name`}
                          aria-invalid={err(fieldKey) ? true : undefined}
                          onChange={(event) => {
                            setOutcome(outcome.key, { label: event.target.value });
                            clearError(fieldKey);
                            clearError("outcomes");
                          }}
                        />
                        <TalentPicker value={outcome.symbol} label={`Outcome ${index + 1}`} onChange={(picked) => pickTalent(outcome.key, index, picked)} />
                        <input
                          className={`${styles.input} ${styles.weight}`}
                          type="number"
                          inputMode="decimal"
                          min={1}
                          max={100}
                          value={outcome.weight}
                          placeholder={String(Math.round(100 / outcomes.length))}
                          aria-label={`Outcome ${index + 1} starting weight`}
                          onChange={(event) => setOutcome(outcome.key, { weight: event.target.value })}
                        />
                        <span className={styles.norm} aria-label={`opens at ${percent(normalised[index])}`}>
                          {percent(normalised[index])}
                        </span>
                        <button
                          type="button"
                          className={styles.remove}
                          aria-label={`Remove outcome ${index + 1}`}
                          disabled={outcomes.length <= 3}
                          onClick={() => {
                            setOutcomes((current) => current.filter((entry) => entry.key !== outcome.key));
                            setErrors({});
                          }}
                        >
                          ×
                        </button>
                        {err(fieldKey) ? <em className={styles.outcomeError}>{err(fieldKey)}</em> : null}
                      </li>
                    );
                  })}
                </ol>
                <div className={styles.outcomeTools}>
                  <button type="button" className={styles.smallBtn} disabled={outcomes.length >= 12} onClick={() => setOutcomes((current) => [...current, blankOutcome()])}>
                    + Add outcome
                  </button>
                  <button type="button" className={styles.smallGhost} onClick={() => setOutcomes((current) => current.map((outcome) => ({ ...outcome, weight: "" })))}>
                    Even split
                  </button>
                  <span className={styles.hint}>{outcomes.length}/12 · weights are normalised to 100%. Add a “Someone else” catch-all.</span>
                </div>
                {err("outcomes") ? <em className={styles.fieldError}>{err("outcomes")}</em> : null}
              </div>
            )}
          </fieldset>

          {/* ── Resolution ── */}
          <fieldset className={styles.block}>
            <legend>How it resolves</legend>
            <Field
              field="rules_text"
              label="Rules"
              error={err("rules_text")}
              hint={
                <>
                  Write it so two people can&apos;t read it differently: the exact event, the deadline with a timezone, and the edge cases (collabs, reruns, delays,
                  announced-but-not-released). Vague rules get disputed.
                </>
              }
            >
              <textarea
                className={styles.textarea}
                rows={5}
                value={rules}
                onChange={(event) => {
                  setRules(event.target.value);
                  clearError("rules_text");
                }}
                placeholder={"Resolves YES if Pekora's main YouTube channel shows 3,000,000+ subscribers on or before Dec 31, 23:59 JST.\nCollab channels don't count. If YouTube hides the count, resolves on Social Blade."}
                aria-invalid={err("rules_text") ? true : undefined}
              />
            </Field>
            <Field field="resolution_source_text" label="Resolution source" error={err("resolution_source_text")} hint="Where the answer comes from. Resolvers link it when they make the call.">
              <input
                className={styles.input}
                value={source}
                onChange={(event) => {
                  setSource(event.target.value);
                  clearError("resolution_source_text");
                }}
                placeholder="Her YouTube channel page / the official hololive X account"
                aria-invalid={err("resolution_source_text") ? true : undefined}
              />
            </Field>
            <div className={styles.pair}>
              <Field field="closes_at" label="Trading closes" error={err("closes_at")} hint="Your local time. Defaults to a week out.">
                <input
                  className={styles.input}
                  type="datetime-local"
                  value={closesAt}
                  onChange={(event) => {
                    setClosesAt(event.target.value);
                    clearError("closes_at");
                  }}
                  aria-invalid={err("closes_at") ? true : undefined}
                />
              </Field>
              <Field field="resolves_after" label="Resolves after" optional error={err("resolves_after")} hint="If the answer lands later than the close.">
                <input
                  className={styles.input}
                  type="datetime-local"
                  value={resolvesAfter}
                  onChange={(event) => {
                    setResolvesAfter(event.target.value);
                    clearError("resolves_after");
                  }}
                  aria-invalid={err("resolves_after") ? true : undefined}
                />
              </Field>
            </div>
            <Field field="dispute_hours" label="Dispute window" error={err("dispute_hours")} hint="How long players get to dispute a call before it settles. 1–72 hours.">
              <div className={styles.inline}>
                <input
                  className={`${styles.input} ${styles.short}`}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={72}
                  value={disputeHours}
                  onChange={(event) => {
                    setDisputeHours(event.target.value);
                    clearError("dispute_hours");
                  }}
                  aria-invalid={err("dispute_hours") ? true : undefined}
                />
                <span>hours</span>
              </div>
            </Field>
          </fieldset>

          {/* ── Money ── */}
          <fieldset className={styles.block}>
            <legend>Liquidity and fee</legend>
            <Field
              field="liquidity_b"
              label="Liquidity b"
              error={err("liquidity_b")}
              hint={
                moveTo !== null && first ? (
                  <span className={styles.explain}>
                    A <b>$100</b> buy of {first.label || "the first outcome"} moves it <b>{percent(first.price)}</b> → <b>{percent(moveTo)}</b>. Bigger b = deeper market, smaller moves.
                  </span>
                ) : (
                  "Bigger b = deeper market, smaller moves."
                )
              }
            >
              <div className={styles.inline}>
                <input
                  className={`${styles.input} ${styles.short}`}
                  type="number"
                  inputMode="numeric"
                  min={10}
                  max={100000}
                  step={10}
                  value={b}
                  placeholder={String(DEFAULT_B[shape])}
                  onChange={(event) => {
                    setB(event.target.value);
                    clearError("liquidity_b");
                  }}
                  aria-invalid={err("liquidity_b") ? true : undefined}
                />
                <div className={styles.chips}>
                  {B_PRESETS.map((preset) => (
                    <button key={preset.b} type="button" aria-pressed={bValue === preset.b} onClick={() => setB(String(preset.b))}>
                      {preset.label} <small>{preset.b}</small>
                    </button>
                  ))}
                </div>
              </div>
            </Field>
            <div className={styles.worst}>
              <span>House worst case</span>
              <b>{Number.isFinite(worst) ? money(worst, 2) : "—"}</b>
              <small>
                b · ln(N) = {Math.round(bValue) || "—"} × ln {n}. The most the house can lose funding this market; fees and the curve&apos;s spread offset it.
              </small>
            </div>
            <Field field="fee_bps" label="Fee" error={err("fee_bps")} hint={`${feeBps} bps on the cash side of every trade. Default 1%.`}>
              <div className={styles.inline}>
                <input
                  className={`${styles.input} ${styles.short}`}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={10}
                  step={0.25}
                  value={feePct}
                  onChange={(event) => {
                    setFeePct(event.target.value);
                    clearError("fee_bps");
                  }}
                  aria-invalid={err("fee_bps") ? true : undefined}
                />
                <span>%</span>
              </div>
            </Field>
          </fieldset>
        </div>

        <aside className={styles.side}>
          <div className={styles.sideSticky}>
            <span className={styles.sideLabel}>Preview</span>
            <MarketPreview
              shape={shape}
              title={title}
              subtitle={subtitle}
              category={categories.find((entry) => entry.slug === category)?.display_name ?? null}
              closesAt={closesAt}
              outcomes={previewOutcomes}
              b={bValue}
              feeBps={feeBps}
              disputeHours={hours}
              worst={worst}
              now={now}
            />
          </div>
        </aside>

        <div className={styles.submit}>
          {formError ? (
            <p className={styles.formError} role="alert">
              {formError}
            </p>
          ) : null}
          <div className={styles.submitRow}>
            {flags.isAdmin ? (
              <>
                <button type="submit" className={styles.primary} disabled={Boolean(busy)}>
                  {busy === "publish" ? "Publishing…" : "Publish now"}
                </button>
                <button type="button" className={styles.secondary} disabled={Boolean(busy)} onClick={() => void submit("submit")}>
                  {busy === "submit" ? "Sending…" : "Submit for approval"}
                </button>
              </>
            ) : (
              <button type="submit" className={styles.primary} disabled={Boolean(busy)}>
                {busy === "submit" ? "Sending…" : "Submit for approval"}
              </button>
            )}
            <button type="button" className={styles.ghost} disabled={Boolean(busy)} onClick={() => void submit("draft")}>
              {busy === "draft" ? "Saving…" : "Save draft"}
            </button>
          </div>
          <p className={styles.hint}>
            {flags.isAdmin ? "Publish now opens trading right away, funded by the house." : "A mod who isn't you approves it, then it opens."} House risk on this one: {Number.isFinite(worst) ? money(worst, 0) : "—"}.
          </p>
        </div>
      </form>
    </PredictionsFrame>
  );
}
