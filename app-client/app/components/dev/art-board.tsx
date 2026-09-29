"use client";

import { useEffect, useMemo, useState } from "react";
import { SceneArt } from "@/app/components/common/scene-art";
import { SiteShell } from "@/app/components/layout/site-shell";
import { SCENE_AREAS, type SceneSlot } from "@/app/lib/art/scene-slots";
import { lookupArt, sharedArtId } from "@/app/lib/art-manifest";
import { useArtStore } from "@/app/stores/art-store";
import styles from "@/app/components/dev/art-board.module.scss";

const PRIORITY = { high: 0, medium: 1, low: 2 } as const;

export function ArtBoard() {
  const manifest = useArtStore((state) => state.manifest);
  const ensureLoaded = useArtStore((state) => state.ensureLoaded);
  const [filter, setFilter] = useState<"all" | "missing" | "high">("all");
  useEffect(() => {
    ensureLoaded();
  }, [ensureLoaded]);

  const all = useMemo(() => SCENE_AREAS.flatMap((area) => area.slots), []);
  const done = all.filter((slot) => lookupArt(manifest, sharedArtId(slot.id))).length;
  const keep = (slot: SceneSlot) => (filter === "missing" ? !lookupArt(manifest, sharedArtId(slot.id)) : filter === "high" ? slot.priority === "high" : true);

  return (
    <SiteShell>
      <main className={styles.page}>
        <header className={styles.head}>
          <p className={styles.kicker}>Dev · art pass</p>
          <h1>Art slots</h1>
          <p>
            <b>{all.length}</b> scene images registered, <b>{done}</b> delivered. Talent key art and chibis are tracked by the talent
            pipeline (see <code>docs/art/ART_ASSETS.md</code>). Registry: <code>app/lib/art/slots/*.json</code>.
          </p>
          <div className={styles.filters}>
            {(["all", "missing", "high"] as const).map((key) => (
              <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>
                {key === "all" ? "All" : key === "missing" ? "Still needed" : "High priority"}
              </button>
            ))}
          </div>
        </header>
        {SCENE_AREAS.map((area) => {
          const slots = area.slots.filter(keep).sort((a, b) => PRIORITY[a.priority] - PRIORITY[b.priority]);
          if (!slots.length) return null;
          return (
            <section key={area.area} className={styles.area}>
              <h2>
                {area.area} <small>{slots.length}</small>
              </h2>
              <div className={styles.grid}>
                {slots.map((slot) => (
                  <article key={slot.id} className={styles.card}>
                    <div className={styles.preview}>
                      <SceneArt slot={slot.id} />
                    </div>
                    <div className={styles.meta}>
                      <p className={styles.id}>
                        {slot.id}
                        <span data-priority={slot.priority}>{slot.priority}</span>
                        {lookupArt(manifest, sharedArtId(slot.id)) ? <span data-done>delivered</span> : null}
                      </p>
                      <h3>{slot.title}</h3>
                      <p className={styles.spec}>
                        {slot.w}×{slot.h} · {slot.kind}
                        {slot.transparent ? " · transparent PNG/WebP" : ""}
                      </p>
                      <p className={styles.brief}>{slot.brief}</p>
                      {slot.notes ? <p className={styles.notes}>{slot.notes}</p> : null}
                      <p className={styles.where}>{slot.where.join(" · ")}</p>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </main>
    </SiteShell>
  );
}
