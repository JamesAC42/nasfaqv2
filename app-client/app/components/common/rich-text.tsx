"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { Oshimark } from "@/app/components/common/oshimark";
import type { MarketAsset } from "@/app/lib/types";
import styles from "@/app/components/common/rich-text.module.scss";

export type Emoji = { id: number; name: string; filename: string; url: string };

export type RichOptions = {
  /** Tickers to turn into stock links, keyed by upper-case symbol. */
  assets?: Map<string, MarketAsset>;
  /** Custom emoji keyed by lower-case name, for :name: tokens. */
  emoji?: Map<string, Emoji>;
  /** Highlight @mentions of this username. */
  me?: string | null;
  /** Render >>123 post links (imageboard threads). */
  quote?: (postId: number) => ReactNode;
};

// One pass over a line: URLs, >>post quotes, @mentions, :emoji:, and $TICKER / TICKER.
const TOKEN = /(https?:\/\/[^\s<]+)|(>>\d+)|(@[A-Za-z0-9_]{2,32})|(:[A-Za-z0-9_-]+:)|(\$?\b[A-Z]{3,4}\b)/g;

function renderLine(line: string, options: RichOptions, key: string) {
  const out: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  TOKEN.lastIndex = 0;
  while ((match = TOKEN.exec(line))) {
    const [token, url, quote, mention, emoji, ticker] = match;
    let node: ReactNode = null;
    if (url) {
      node = (
        <a href={url} target="_blank" rel="noreferrer noopener" className={styles.url}>
          {url.length > 60 ? `${url.slice(0, 57)}…` : url}
        </a>
      );
    } else if (quote && options.quote) {
      node = options.quote(Number(quote.slice(2)));
    } else if (mention) {
      const isMe = Boolean(options.me && mention.slice(1).toLowerCase() === options.me.toLowerCase());
      node = <span className={isMe ? styles.mentionMe : styles.mention}>{mention}</span>;
    } else if (emoji && options.emoji) {
      const found = options.emoji.get(emoji.slice(1, -1).toLowerCase());
      if (found) node = <img src={found.url || `https://images.nasfaq.biz/emojis/${found.filename}`} alt={emoji} title={emoji} className={styles.emoji} loading="lazy" />;
    } else if (ticker && options.assets) {
      const symbol = ticker.replace("$", "");
      const asset = options.assets.get(symbol);
      if (asset) {
        node = (
          <Link href={`/stocks/${encodeURIComponent(symbol)}`} className={styles.ticker} data-peek-stock={symbol} prefetch={false}>
            <Oshimark icon={asset.icon} symbol={symbol} size={13} />
            {symbol}
          </Link>
        );
      }
    }
    if (node === null) continue;
    if (match.index > last) out.push(line.slice(last, match.index));
    out.push(<Fragment key={`${key}:${match.index}`}>{node}</Fragment>);
    last = match.index + token.length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

/** Chat and thread text: greentext lines, links, mentions, emoji and live ticker links. */
export function RichText({ text, options, className }: { text: string; options: RichOptions; className?: string }) {
  const lines = text.split("\n");
  return (
    <div className={className}>
      {lines.map((line, index) => {
        const trimmed = line.trimStart();
        const green = trimmed.startsWith(">") && !trimmed.startsWith(">>");
        return (
          <div key={index} className={green ? styles.green : styles.line}>
            {line ? renderLine(line, options, String(index)) : " "}
          </div>
        );
      })}
    </div>
  );
}
