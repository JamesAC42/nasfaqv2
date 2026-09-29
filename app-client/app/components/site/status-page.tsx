import Link from "next/link";
import type { ReactNode } from "react";
import { SceneArt } from "@/app/components/common/scene-art";
import { TalentReaction } from "@/app/components/common/talent-reaction";
import type { ChibiPose } from "@/app/lib/art-manifest";
import styles from "@/app/components/site/status-page.module.scss";

/**
 * The body of the 404 and crash pages: a talent reacting (a `_shared` illustration for the slot
 * replaces them if one ships), a headline, a line and a way back.
 */
export function StatusPage({
  slot,
  pose,
  caption,
  kicker,
  title,
  line,
  actions,
}: {
  slot: string;
  pose: ChibiPose;
  caption?: string;
  kicker: string;
  title: string;
  line: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className={styles.page}>
      <SceneArt slot={slot} className={styles.art} width={560} priority fallback={<TalentReaction pose={pose} size={200} caption={caption} fresh />} />
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
