import type { ArticleSummary, NewsItem } from "@/app/lib/types";

/** One row in the articles feed, whether it came from the HoloNews importer or a player. */
export type Story = {
  key: string;
  href: string;
  kind: "news" | "community";
  title: string;
  dek: string | null;
  thumb: string | null;
  at: string | null;
  author: string | null;
  source: string | null;
  symbols: string[];
  units: string[];
  views: number;
  likes: number;
  comments: number;
  draft: boolean;
};

const clean = (value: string | null | undefined) => value?.trim().replace(/\s+/g, " ") || null;

export function fromNews(item: NewsItem): Story {
  return {
    key: `n${item.id}`,
    href: item.article_slug ? `/articles/${encodeURIComponent(item.article_slug)}` : `/articles/news-${encodeURIComponent(item.id)}`,
    kind: "news",
    title: item.headline,
    dek: clean(item.summary),
    thumb: item.thumbnail_url ?? null,
    at: item.published_at,
    author: null,
    source: item.source || null,
    symbols: (item.stock_symbols ?? []).map((symbol) => symbol.toUpperCase()),
    units: item.units ?? [],
    views: item.view_count ?? 0,
    likes: item.like_count ?? 0,
    comments: item.comment_count ?? 0,
    draft: false,
  };
}

export function fromArticle(article: ArticleSummary): Story {
  const subtitle = clean(article.subtitle);
  const preview = clean(article.preview);
  return {
    key: `a${article.id}`,
    href: `/articles/${encodeURIComponent(article.slug)}`,
    kind: article.is_news ? "news" : "community",
    title: article.news_item?.headline || article.title,
    dek: subtitle || preview,
    thumb: article.thumbnail_url,
    at: article.published_at ?? article.news_item?.published_at ?? article.created_at,
    author: article.is_news ? null : article.author?.username ?? null,
    source: null,
    symbols: article.related_assets.map((asset) => asset.symbol.toUpperCase()),
    units: [],
    views: article.views,
    likes: article.likes,
    comments: article.comment_count,
    draft: article.status === "draft",
  };
}

/**
 * Imported headlines are often a headline and a sentence run together. Split
 * them so the first sentence reads as the headline and the rest as the dek.
 */
export function splitHeadline(headline: string) {
  const trimmed = headline.trim();
  const sentence = trimmed.match(/^(.{20,200}?[.!?])\s+(.+)$/);
  if (sentence) return { title: sentence[1].trim(), dek: sentence[2].trim() || null };
  if (trimmed.length <= 200) return { title: trimmed, dek: null as string | null };
  const slice = trimmed.slice(0, 200);
  const cut = Math.max(slice.lastIndexOf(": "), slice.lastIndexOf("; "), slice.lastIndexOf(", "), slice.lastIndexOf(" "));
  return { title: trimmed.slice(0, cut > 80 ? cut + 1 : 200).trim(), dek: trimmed.slice(cut > 80 ? cut + 1 : 200).trim() || null };
}

/** Rough reading time at 220 words a minute, ignoring markdown syntax. */
export function readMinutes(content: string | null | undefined) {
  const words = String(content || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!?\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/[#>*_~`[\]()-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
  return words ? Math.max(1, Math.ceil(words / 220)) : null;
}
