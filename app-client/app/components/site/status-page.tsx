import Link from "next/link";
import type { ReactNode } from "react";
import { SceneArt } from "@/app/components/common/scene-art";
import styles from "@/app/components/site/status-page.module.scss";

/** The body of the 404 and crash pages: a picture, a headline, a line and a way back. */
export function StatusPage({ slot, kicker, title, line, actions }: { slot: string; kicker: string; title: string; line: ReactNode; actions?: ReactNode }) {
  return (
    <section className={styles.page}>
      <SceneArt slot={slot} className={styles.art} width={560} priority />
      <span className={styles.kicker}>{kicker}</span>
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.line}>{line}</p>
      <div className={styles.actions}>
        {actions ?? (
          <>
            <Link href="/" className={styles.primary}>
              Back to the floor
            </Link>
            <Link href="/stocks" className={styles.secondary}>
              Stocks
            </Link>
          </>
        )}
      </div>
    </section>
  );
}

export const statusStyles = styles;
