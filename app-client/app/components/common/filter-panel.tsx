"use client";

import { type ReactNode, useId, useState } from "react";
import { FaChevronDown, FaFilter } from "react-icons/fa6";
import styles from "@/app/components/common/filter-panel.module.scss";

type FilterPanelProps = {
  summary?: string;
  description?: string;
  defaultExpanded?: boolean;
  children: ReactNode;
};

export function FilterPanel({
  summary,
  description = "Refine the current view",
  defaultExpanded = true,
  children,
}: FilterPanelProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const contentId = useId();

  return (
    <section className={styles.panel} data-expanded={isExpanded ? "true" : "false"}>
      <button
        type="button"
        className={styles.header}
        aria-expanded={isExpanded}
        aria-controls={contentId}
        onClick={() => setIsExpanded((current) => !current)}
      >
        <span className={styles.headerMain}>
          <span className={styles.iconWrap} aria-hidden="true">
            <FaFilter />
          </span>
          <span className={styles.headerText}>
            <span className={styles.title}>Filters</span>
            <span className={styles.status}>{description}</span>
          </span>
        </span>
        <span className={styles.headerMeta}>
          {summary ? <span className={styles.summary}>{summary}</span> : null}
          <span className={styles.chevron} aria-hidden="true">
            <FaChevronDown />
          </span>
        </span>
      </button>

      <div id={contentId} className={styles.bodyShell} aria-hidden={!isExpanded} inert={!isExpanded}>
        <div className={styles.bodyViewport}>
          <div className={styles.body}>{children}</div>
        </div>
      </div>
    </section>
  );
}
