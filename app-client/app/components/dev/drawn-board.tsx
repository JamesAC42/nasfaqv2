"use client";

import { Medal } from "@/app/components/common/medal";
import { SiteShell } from "@/app/components/layout/site-shell";
import { Chip } from "@/app/components/games/blackjack/bj-parts";
import { CardBack, TalentCard } from "@/app/components/games/cards/talent-card";
import { CapsuleBack } from "@/app/components/games/gacha/prize-card";
import type { Rarity } from "@/app/lib/games/types";

const RARITIES: Rarity[] = ["C", "R", "SR", "SSR", "UR"];
const row = { display: "flex", flexWrap: "wrap", gap: "1.2rem", alignItems: "flex-end", margin: "1rem 0 2rem" } as const;

/** Dev board: card frames, backs, capsules, chips and medals as drawn. */
export function DrawnBoard() {
  return (
    <SiteShell>
      <div style={{ padding: "1rem" }}>
        <h1>Drawn pieces</h1>
        <div style={row}>
          {RARITIES.map((rarity) => (
            <TalentCard key={rarity} card={{ symbol: "PEK", name: "Usada Pekora", rarity, unit: "hololive 3rd Generation", stars: 3, power: 20 }} width={200} tilt={false} />
          ))}
        </div>
        <div style={row}>
          {RARITIES.map((rarity) => (
            <TalentCard key={rarity} card={{ symbol: "AQU", name: "Minato Aqua", rarity, stars: 1 }} width={84} compact tilt={false} />
          ))}
          <CardBack width={200} />
          <CardBack width={200} glow="SSR" />
          <CardBack width={84} />
        </div>
        <div style={row}>
          {(["common", "rare", "epic", "legendary"] as const).map((rarity) => (
            <CapsuleBack key={rarity} rarity={rarity} width={160} />
          ))}
        </div>
        <div style={{ ...row, background: "#0d2a4a", padding: "1rem" }}>
          {[5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000].map((value) => (
            <Chip key={value} value={value} size={56} />
          ))}
        </div>
        <div style={row}>
          <Medal tier="gold" mark={1} size={64} />
          <Medal tier="silver" mark={2} size={64} />
          <Medal tier="bronze" mark={3} size={64} />
          <Medal color="#ff7ad9" mark="F" size={48} />
          <Medal color="#7dd8a8" mark="W" size={48} />
          <Medal size={48} />
        </div>
      </div>
    </SiteShell>
  );
}
