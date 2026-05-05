"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { emojiAwareComponents } from "@/app/components/common/emoji-icons";
import { SiteShell } from "@/app/components/layout/site-shell";
import styles from "@/app/components/pages/how-to-play-page.module.scss";

export function HowToPlayPage() {
  const [guideContent, setGuideContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch("/guides/how-to-play.md")
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load guide (${res.status})`);
        return res.text();
      })
      .then((text) => {
        if (!cancelled) setGuideContent(text);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Unknown error");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <SiteShell>
      <div className={styles.guidePage}>
        <div className={styles.guideCard}>
          {error ? (
            <div className={styles.guideBody}>
              <p>Could not load the guide. {error}</p>
            </div>
          ) : guideContent === null ? (
            <div className={styles.guideBody}>
              <p>Loading guide…</p>
            </div>
          ) : (
            <div className={styles.guideBody}>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={emojiAwareComponents}
              >
                {guideContent}
              </ReactMarkdown>
            </div>
          )}
        </div>
      </div>
      <img
        src="/tako.png"
        alt=""
        className={styles.takoSticky}
        aria-hidden="true"
      />
    </SiteShell>
  );
}
