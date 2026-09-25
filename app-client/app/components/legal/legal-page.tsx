import Link from "next/link";
import type { ReactNode } from "react";
import { SiteShell } from "@/app/components/layout/site-shell";
import { SceneArt } from "@/app/components/common/scene-art";
import { LegalToc } from "@/app/components/legal/legal-toc";
import styles from "@/app/components/legal/legal.module.scss";

export type LegalDoc = "privacy" | "terms";

export type LegalSection = {
  /** Anchor id, used in the URL (#id). Keep stable once published. */
  id: string;
  title: string;
  body: ReactNode;
};

const DOCS: Record<LegalDoc, { href: string; label: string; blurb: string }> = {
  privacy: {
    href: "/privacy",
    label: "Privacy Policy",
    blurb: "What we collect, what's public, and how to get it deleted.",
  },
  terms: {
    href: "/terms",
    label: "Usage policy",
    blurb: "The house rules: play money, fair play, conduct and moderation.",
  },
};

export const CONTACT_EMAIL = "nasfaqsite@gmail.com";

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Shared reading layout for the Privacy Policy and the Usage policy: header with the short
 * version, a sticky table of contents (collapsible on phones) and numbered, linkable sections.
 */
export function LegalPage({
  doc,
  title,
  updated,
  intro,
  summary,
  sections,
  art,
}: {
  doc: LegalDoc;
  title: string;
  /** ISO date and its display form, e.g. { iso: "2026-09-25", label: "September 25, 2026" }. */
  updated: { iso: string; label: string };
  intro: ReactNode;
  /** "The short version": 4–6 plain-language bullets. */
  summary: ReactNode[];
  sections: LegalSection[];
  /** Optional SceneArt slot for the header spot illustration. */
  art?: string;
}) {
  const other: LegalDoc = doc === "privacy" ? "terms" : "privacy";
  const toc = sections.map((section, index) => ({ id: section.id, title: section.title, n: pad(index + 1) }));

  return (
    <SiteShell>
      <article className={styles.page} id="top">
        <header className={styles.head}>
          <div className={styles.headText}>
            <nav className={styles.switch} aria-label="Site policies">
              {(Object.keys(DOCS) as LegalDoc[]).map((key) => (
                <Link key={key} href={DOCS[key].href} aria-current={key === doc ? "page" : undefined}>
                  {DOCS[key].label}
                </Link>
              ))}
            </nav>
            <h1>{title}</h1>
            <p className={styles.meta}>
              <span>Last updated</span> <time dateTime={updated.iso}>{updated.label}</time>
            </p>
            <div className={styles.intro}>{intro}</div>
          </div>
          {art ? (
            <div className={styles.spot} aria-hidden="true">
              <SceneArt slot={art} width={176} priority />
            </div>
          ) : null}
        </header>

        <section className={styles.short} aria-labelledby="short-version">
          <h2 id="short-version">The short version</h2>
          <ul>
            {summary.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
          <p className={styles.shortNote}>The full text below is what counts. The short version is just the gist.</p>
        </section>

        <div className={styles.layout}>
          <LegalToc items={toc} />

          <div className={styles.body}>
            {sections.map((section, index) => (
              <section key={section.id} id={section.id} className={styles.section} aria-labelledby={`${section.id}-h`}>
                <h2 id={`${section.id}-h`} className={styles.sectionHead}>
                  <span className={styles.num} aria-hidden="true">
                    {pad(index + 1)}
                  </span>
                  <span className={styles.sectionTitle}>{section.title}</span>
                  <a href={`#${section.id}`} className={styles.anchor} aria-label={`Link to section ${index + 1}: ${section.title}`}>
                    #
                  </a>
                </h2>
                <div className={styles.prose}>{section.body}</div>
              </section>
            ))}

            <footer className={styles.end}>
              <Link href={DOCS[other].href} className={styles.endCard}>
                <span className={styles.endLabel}>Also read</span>
                <strong>{DOCS[other].label}</strong>
                <span className={styles.endBlurb}>{DOCS[other].blurb}</span>
                <span className={styles.endArrow} aria-hidden="true">
                  →
                </span>
              </Link>
              <div className={styles.endMeta}>
                <p>
                  Questions? Email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
                </p>
                <a href="#top" className={styles.backTop}>
                  Back to top ↑
                </a>
              </div>
            </footer>
          </div>
        </div>
      </article>
    </SiteShell>
  );
}

/** A two-column list of labelled facts ("Your account" → what and why). Stacks on phones. */
export function Facts({ children, mono = false }: { children: ReactNode; mono?: boolean }) {
  return <dl className={[styles.facts, mono ? styles.factsMono : ""].filter(Boolean).join(" ")}>{children}</dl>;
}

export function Fact({ term, children }: { term: ReactNode; children: ReactNode }) {
  return (
    <div className={styles.fact}>
      <dt>{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** A highlighted paragraph for the one thing in a section people must not miss. */
export function Callout({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className={styles.callout}>
      {title ? <p className={styles.calloutTitle}>{title}</p> : null}
      {children}
    </div>
  );
}

/** Link to another site, opened in a new tab. */
export function Ext({ href, children }: { href: string; children?: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children ?? href}
    </a>
  );
}

export function Mail() {
  return <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>;
}
