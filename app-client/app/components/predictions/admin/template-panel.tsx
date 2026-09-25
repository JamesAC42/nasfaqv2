"use client";

import { useState, type FormEvent } from "react";
import { ErrorLine, useRun } from "@/app/components/predictions/admin/staff-parts";
import { updateTemplate } from "@/app/lib/predictions/api";
import { TEMPLATE_LABEL, money, timeAgo } from "@/app/lib/predictions/format";
import type { AutoTemplate } from "@/app/lib/predictions/types";
import styles from "@/app/components/predictions/admin/admin-console.module.scss";

// Auto templates (spec §6): on/off, and the params the API accepts (count, liquidity_b, fee_bps,
// min_past_streams). Each shows its last run and what it did.

const INFO: Record<string, { example: string; fields: string[]; outcomes: (params: Record<string, number>) => number }> = {
  "tick-direction": { example: "PEK up on the Late tick?", fields: ["count", "liquidity_b", "fee_bps"], outcomes: () => 2 },
  "tick-top-gainer": { example: "Top gainer on the Late tick?", fields: ["count", "liquidity_b", "fee_bps"], outcomes: (params) => (params.count ?? 6) + 1 },
  "stream-peak": { example: "Marine's stream peaks above 45k?", fields: ["min_past_streams", "liquidity_b", "fee_bps"], outcomes: () => 2 },
};

const FIELD: Record<string, { label: string; hint: string; min: number; max: number; step: number }> = {
  count: { label: "Talents", hint: "K most active", min: 1, max: 20, step: 1 },
  liquidity_b: { label: "Liquidity b", hint: "depth", min: 10, max: 100000, step: 10 },
  fee_bps: { label: "Fee bps", hint: "100 = 1%", min: 0, max: 1000, step: 5 },
  min_past_streams: { label: "Min streams", hint: "history needed", min: 1, max: 50, step: 1 },
};

function resultText(result: Record<string, unknown>) {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(result || {})) {
    if (key === "tick_at" && typeof value === "string") {
      parts.push(`next tick ${new Date(value).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}`);
    } else if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") {
      parts.push(`${key.replace(/_/g, " ")} ${value}`);
    }
  }
  return parts.join(" · ") || "no result recorded";
}

function TemplateRow({ template, liveCount, now, onChanged }: { template: AutoTemplate; liveCount: number; now: number; onChanged: () => void }) {
  const info = INFO[template.key] ?? { example: "", fields: Object.keys(template.params), outcomes: () => 2 };
  const fields = Array.from(new Set([...info.fields, ...Object.keys(template.params)])).filter((field) => FIELD[field]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const { busy, error, setError, run } = useRun(onChanged);
  const on = enabled ?? template.enabled;

  const value = (field: string) => draft[field] ?? (template.params[field] !== undefined ? String(template.params[field]) : "");
  const dirty = fields.some((field) => draft[field] !== undefined && draft[field] !== String(template.params[field] ?? ""));
  const params = Object.fromEntries(fields.map((field) => [field, Number(value(field))]).filter(([, v]) => Number.isFinite(v as number)));
  const b = Number(params.liquidity_b ?? template.params.liquidity_b ?? 0);
  const worst = b > 0 ? b * Math.log(info.outcomes(params as Record<string, number>)) : null;

  const toggle = async () => {
    const next = !on;
    setEnabled(next);
    const ok = await run("toggle", () => updateTemplate(template.key, { enabled: next }));
    if (!ok) setEnabled(null);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    for (const field of fields) {
      const n = Number(value(field));
      const spec = FIELD[field];
      if (!Number.isFinite(n) || n < spec.min || n > spec.max) {
        setError(`${spec.label} must be between ${spec.min} and ${spec.max}.`);
        return;
      }
    }
    const ok = await run("save", () => updateTemplate(template.key, { params: params as Record<string, number> }));
    if (ok) setDraft({});
  };

  return (
    <form className={styles.template} data-off={!on || undefined} onSubmit={save}>
      <div className={styles.templateHead}>
        <div className={styles.templateName}>
          <b>{TEMPLATE_LABEL[template.key] ?? template.key}</b>
          <code>{template.key}</code>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={`${TEMPLATE_LABEL[template.key] ?? template.key} ${on ? "on" : "off"}`}
          className={styles.switch}
          disabled={busy === "toggle"}
          onClick={() => void toggle()}
        >
          <i aria-hidden="true" />
          <span>{on ? "On" : "Off"}</span>
        </button>
      </div>
      {info.example ? <p className={styles.templateEx}>“{info.example}”</p> : null}
      <div className={styles.params}>
        {fields.map((field) => (
          <label key={field} className={styles.param}>
            <span>{FIELD[field].label}</span>
            <input
              type="number"
              inputMode="numeric"
              min={FIELD[field].min}
              max={FIELD[field].max}
              step={FIELD[field].step}
              value={value(field)}
              onChange={(event) => setDraft((current) => ({ ...current, [field]: event.target.value }))}
            />
            <small>{FIELD[field].hint}</small>
          </label>
        ))}
      </div>
      <dl className={styles.templateStats}>
        <div>
          <dt>Live now</dt>
          <dd>{liveCount}</dd>
        </div>
        <div>
          <dt>Worst / mkt</dt>
          <dd>{worst === null ? "—" : money(worst, 0)}</dd>
        </div>
        <div>
          <dt>Last run</dt>
          <dd>{template.last_run_at ? `${timeAgo(template.last_run_at, now)} ago` : "never"}</dd>
        </div>
      </dl>
      <p className={styles.templateResult}>{resultText(template.last_result)}</p>
      <ErrorLine error={error} />
      {dirty ? (
        <div className={styles.templateSave}>
          <button type="submit" className={styles.btnSmall} data-tone="primary" disabled={Boolean(busy)}>
            {busy === "save" ? "Saving…" : "Save params"}
          </button>
          <button type="button" className={styles.btnGhostSmall} disabled={Boolean(busy)} onClick={() => setDraft({})}>
            Reset
          </button>
          <span>Applies to the next markets it opens.</span>
        </div>
      ) : null}
    </form>
  );
}

export function TemplatePanel({ templates, liveByTemplate, now, onChanged }: { templates: AutoTemplate[]; liveByTemplate: Record<string, number>; now: number; onChanged: () => void }) {
  return (
    <div className={styles.templates}>
      {templates.map((template) => (
        <TemplateRow key={`${template.key}-${template.enabled}-${JSON.stringify(template.params)}`} template={template} liveCount={liveByTemplate[template.key] ?? 0} now={now} onChanged={onChanged} />
      ))}
      {!templates.length ? <p className={styles.empty}>No auto templates set up.</p> : null}
    </div>
  );
}
