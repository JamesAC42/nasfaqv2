"use client";

import { useEffect, useState, type MouseEvent } from "react";
import styles from "@/app/components/legal/legal.module.scss";

type TocItem = { id: string; title: string; n: string };

/**
 * Table of contents for a legal page: a sticky list beside the text on desktop, a collapsible
 * "On this page" above it on tablets and phones. Highlights the section being read.
 */
export function LegalToc({ items }: { items: TocItem[] }) {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const sections = items.map((item) => document.getElementById(item.id)).filter((el): el is HTMLElement => Boolean(el));
    if (!sections.length || typeof IntersectionObserver === "undefined") return;
    const visible = new Map<string, boolean>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) visible.set(entry.target.id, entry.isIntersecting);
        const first = items.find((item) => visible.get(item.id));
        if (first) setActive(first.id);
      },
      // A band near the top of the viewport: the section crossing it is "the one being read".
      { rootMargin: "-18% 0px -72% 0px" }
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [items]);

  const list = (onPick?: (event: MouseEvent<HTMLAnchorElement>) => void) => (
    <ol>
      {items.map((item) => (
        <li key={item.id}>
          <a href={`#${item.id}`} aria-current={active === item.id ? "location" : undefined} onClick={onPick}>
            <span className={styles.tocNum}>{item.n}</span>
            <span>{item.title}</span>
          </a>
        </li>
      ))}
    </ol>
  );

  return (
    <>
      <nav className={styles.toc} aria-label="On this page">
        <p className={styles.tocHead}>On this page</p>
        {list()}
      </nav>

      <details className={styles.tocMobile}>
        <summary>
          <span>On this page</span>
          <span className={styles.tocCount}>{items.length} sections</span>
        </summary>
        <nav aria-label="On this page">
          {list((event) => {
            // Collapse after picking a section so the text isn't pushed down.
            const details = event.currentTarget.closest("details");
            if (details) details.open = false;
          })}
        </nav>
      </details>
    </>
  );
}
