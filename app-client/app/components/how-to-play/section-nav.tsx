"use client";

import { useEffect, useRef, useState } from "react";
import { SECTIONS, type SectionId } from "@/app/components/how-to-play/content";
import styles from "@/app/components/how-to-play/how-to-play.module.scss";

/**
 * Jump links for the guide. A sticky column on desktop, a sticky chip scroller under the header on
 * tablets and phones. Highlights the section you're reading.
 */
export function SectionNav() {
  const [active, setActive] = useState<SectionId>("market");
  const scroller = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const nodes = SECTIONS.map((section) => document.getElementById(section.id)).filter((node): node is HTMLElement => Boolean(node));
    if (!nodes.length || typeof IntersectionObserver === "undefined") return;
    const visible = new Map<string, boolean>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) visible.set(entry.target.id, entry.isIntersecting);
        const first = SECTIONS.find((section) => visible.get(section.id));
        if (first) setActive(first.id);
      },
      // A thin band a third of the way down the viewport: whichever section crosses it is "current".
      { rootMargin: "-32% 0px -60% 0px" },
    );
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);

  // Keep the active chip in view on the phone scroller without moving the page.
  useEffect(() => {
    const box = scroller.current;
    const chip = box?.querySelector<HTMLElement>(`[data-id="${active}"]`);
    if (!box || !chip || box.scrollWidth <= box.clientWidth) return;
    const left = chip.offsetLeft - box.clientWidth / 2 + chip.offsetWidth / 2;
    box.scrollTo({ left, behavior: "smooth" });
  }, [active]);

  return (
    <nav className={styles.sectionNav} aria-label="Guide sections">
      <span className={styles.navLabel}>On this page</span>
      <div className={styles.navList} ref={scroller}>
        {SECTIONS.map((section, index) => (
          <a
            key={section.id}
            href={`#${section.id}`}
            data-id={section.id}
            className={styles.navLink}
            aria-current={active === section.id ? "location" : undefined}
            onClick={() => setActive(section.id)}
          >
            <span className={styles.navNum}>{String(index + 1).padStart(2, "0")}</span>
            {section.label}
          </a>
        ))}
      </div>
    </nav>
  );
}
