"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { SceneArt } from "@/app/components/common/scene-art";
import { FAQ, GLOSSARY } from "@/app/components/how-to-play/content";
import { Section } from "@/app/components/how-to-play/sections";
import styles from "@/app/components/how-to-play/how-to-play.module.scss";

export function GlossarySection() {
  const [query, setQuery] = useState("");
  const terms = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return GLOSSARY;
    return GLOSSARY.filter((entry) => entry.term.toLowerCase().includes(needle) || entry.def.toLowerCase().includes(needle));
  }, [query]);

  return (
    <Section id="glossary" title="Floor talk, decoded" lede={<p>The words you&apos;ll see in chat, on tickets and in the rules.</p>}>
      <label className={styles.glossSearch}>
        <span className={styles.sr}>Filter the glossary</span>
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter terms…" />
      </label>
      {terms.length ? (
        <dl className={styles.glossary}>
          {terms.map((entry) => (
            <div key={entry.term}>
              <dt>{entry.term}</dt>
              <dd>
                {entry.def}
                {entry.href ? (
                  <>
                    {" "}
                    <Link href={entry.href}>Go →</Link>
                  </>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className={styles.empty}>Nothing matches &ldquo;{query}&rdquo;. Ask in chat; someone will explain it badly.</p>
      )}
    </Section>
  );
}

export function FaqSection() {
  return (
    <Section id="faq" title="FAQ" lede={<p>The questions new players ask in chat every single day.</p>} links={[{ href: "/chat", label: "Still stuck? Ask the floor" }]}>
      <div className={styles.faqWrap}>
        <div className={styles.faq}>
          {FAQ.map((item) => (
            <details key={item.q} className={styles.faqItem}>
              <summary>
                <span>{item.q}</span>
                <i aria-hidden="true" />
              </summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
        <SceneArt slot="howto-help" className={styles.faqArt} width={240} />
      </div>
    </Section>
  );
}

export function FinePrint() {
  return (
    <footer className={styles.fine}>
      <p>
        <b>Play money only.</b>{" "}NASFAQ is a fan-made game. Cash, stocks, cards and prediction shares have no real-world value and can&apos;t be bought, sold or
        withdrawn. Not affiliated with or endorsed by COVER Corporation or hololive production. Prices follow public YouTube data and player trades; nothing here is a
        statement about any real person.
      </p>
      <p className={styles.fineLinks}>
        <Link href="/terms">Terms</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/register">Make an account</Link>
      </p>
    </footer>
  );
}
