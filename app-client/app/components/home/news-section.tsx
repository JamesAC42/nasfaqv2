import Link from "next/link";
import Image from "next/image";
import { fmtInteger } from "@/app/lib/format";
import { ChannelTickerPill } from "@/app/components/common/channel-ticker-pill";
import { FaComment, FaHeart, FaNewspaper } from "react-icons/fa6";
import type { NewsCharacter, NewsItem } from "@/app/lib/types";
import styles from "@/app/components/home/news-section.module.scss";

function splitHeadline(headline: string) {
  const trimmed = headline.trim();
  if (!trimmed) return { title: "", subhead: null as string | null };

  const sentenceBreak = trimmed.match(/^(.{1,200}?[.!?])(?:\s+)(.+)$/);
  if (sentenceBreak) {
    return {
      title: sentenceBreak[1].trim(),
      subhead: sentenceBreak[2].trim() || null,
    };
  }

  if (trimmed.length <= 200) {
    return { title: trimmed, subhead: null as string | null };
  }

  const slice = trimmed.slice(0, 200);
  const naturalBreak = Math.max(
    slice.lastIndexOf(". "),
    slice.lastIndexOf("! "),
    slice.lastIndexOf("? "),
    slice.lastIndexOf(": "),
    slice.lastIndexOf("; "),
    slice.lastIndexOf(", "),
    slice.lastIndexOf(" - "),
    slice.lastIndexOf(" ")
  );
  const cutoff = naturalBreak > 80 ? naturalBreak + 1 : 200;

  return {
    title: trimmed.slice(0, cutoff).trim(),
    subhead: trimmed.slice(cutoff).trim() || null,
  };
}

function getCompactThumbnailUrl(url: string | null | undefined) {
  if (!url) return null;
  const lastSlashIndex = url.lastIndexOf("/");
  if (lastSlashIndex < 0 || lastSlashIndex === url.length - 1) return url;
  return `${url.slice(0, lastSlashIndex + 1)}thumbnail-${url.slice(lastSlashIndex + 1)}`;
}

function formatRelativeTime(value: string | null | undefined) {
  if (!value) {
    return {
      relative: "—",
      absolute: "—",
    };
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return {
      relative: value,
      absolute: value,
    };
  }

  const diffMs = Date.now() - date.getTime();
  if (diffMs <= 0) {
    return {
      relative: "just now",
      absolute: date.toLocaleString(),
    };
  }

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) {
    return {
      relative: `${seconds} second${seconds === 1 ? "" : "s"} ago`,
      absolute: date.toLocaleString(),
    };
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return {
      relative: `${minutes} minute${minutes === 1 ? "" : "s"} ago`,
      absolute: date.toLocaleString(),
    };
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return {
      relative: `${hours} hour${hours === 1 ? "" : "s"} ago`,
      absolute: date.toLocaleString(),
    };
  }

  const days = Math.floor(hours / 24);
  return {
    relative: `${days} day${days === 1 ? "" : "s"} ago`,
    absolute: date.toLocaleString(),
  };
}

function getItemChannels(item: NewsItem): NewsCharacter[] {
  if (item.characters?.length) return item.characters;
  return (item.related_names || []).map((name) => ({ name, icon: null }));
}

function hasDistinctSummary(item: NewsItem) {
  if (!item.summary?.trim()) return false;
  const relatedLabel = getItemChannels(item).map((channel) => channel.name).join(", ");
  return item.summary.trim() !== relatedLabel;
}

function RelatedTickerPills({ item }: { item: NewsItem }) {
  const channels = getItemChannels(item);
  if (!channels.length) return null;

  return (
    <div className={styles.pillRow}>
      {channels.map((channel) => <ChannelTickerPill key={`${item.id}-${channel.name}`} channel={channel} />)}
    </div>
  );
}

function getArticleHref(item: NewsItem) {
  return item.article_slug ? `/articles/${encodeURIComponent(item.article_slug)}` : "/news";
}

function EngagementStat({
  kind,
  value,
}: {
  kind: "likes" | "comments";
  value: number | null | undefined;
}) {
  const displayValue = value ?? 0;

  return (
    <span className={styles.engagementStat}>
      <span className={styles.engagementIcon} aria-hidden="true">
        {kind === "likes" ? <FaHeart /> : <FaComment />}
      </span>
      <span>{fmtInteger(displayValue)}</span>
    </span>
  );
}

function HeadlineBlock({ headline, isLead }: { headline: string; isLead: boolean }) {
  const { title, subhead } = splitHeadline(headline);
  const headlineClassName = isLead
    ? `${styles.leadHeadline} ${subhead ? styles.leadHeadlineWithSubhead : ""}`.trim()
    : styles.headline;

  return (
    <div className={styles.headlineBlock}>
      <strong className={headlineClassName}>{title}</strong>
      {subhead ? <div className={isLead ? styles.leadSubhead : styles.subhead}>{subhead}</div> : null}
    </div>
  );
}

function StoryHeadingLink({
  item,
  isLead,
}: {
  item: NewsItem;
  isLead: boolean;
}) {
  return (
    <Link href={getArticleHref(item)} className={styles.storyLink}>
      <HeadlineBlock headline={item.headline} isLead={isLead} />
    </Link>
  );
}

function ArticleMeta({ publishedAt, source }: { publishedAt: string | null; source: string }) {
  const timestamp = formatRelativeTime(publishedAt);

  return (
    <div className={styles.metaRow}>
      <div className={styles.meta} title={timestamp.absolute}>
        {timestamp.relative} · {source}
      </div>
    </div>
  );
}

export type HomepageNewsPartition = {
  leadStory: NewsItem | null;
  mainFeatureItems: NewsItem[];
  sideFeature: NewsItem | null;
  mainHeadlineItems: NewsItem[];
  sideHeadlineItems: NewsItem[];
  overflowItems: NewsItem[];
};

export function partitionHomepageNewsItems(items: NewsItem[]): HomepageNewsPartition {
  const featured = items.filter((item) => item.thumbnail_url);
  const headlines = items.filter((item) => !item.thumbnail_url);

  return {
    leadStory: featured[0] || null,
    mainFeatureItems: featured.slice(1, 2),
    sideFeature: featured[2] || null,
    mainHeadlineItems: headlines.slice(0, 4),
    sideHeadlineItems: headlines.slice(4, 9),
    overflowItems: [...featured.slice(3), ...headlines.slice(9)],
  };
}

export function NewsSection({ items, error }: { items: NewsItem[]; error: string | null }) {
  const {
    leadStory,
    mainFeatureItems,
    sideFeature,
    mainHeadlineItems,
    sideHeadlineItems,
  } = partitionHomepageNewsItems(items);

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <div>
          <h2 className={styles.title}>
            <FaNewspaper className={styles.titleIcon} aria-hidden="true" />
            <span>HoloNews</span>
          </h2>
        </div>
        <Link href="/news" className={styles.archiveLink}>Open news archive</Link>
      </div>
      {items.length ? (
        <>
          {leadStory ? (
            <div className={styles.topLayout}>
              <div className={styles.mainColumn}>
                <article className={`${styles.item} ${styles.itemLead}`}>
                  {leadStory.thumbnail_url ? (
                    <Link href={getArticleHref(leadStory)} className={styles.mediaLink}>
                      <img src={leadStory.thumbnail_url} alt="" className={styles.leadThumb} />
                    </Link>
                  ) : null}
                  <div className={styles.itemBody}>
                    <div className={styles.leadKicker}>Lead Story</div>
                    <StoryHeadingLink item={leadStory} isLead />
                    <ArticleMeta publishedAt={leadStory.published_at} source={leadStory.source} />
                    <div className={styles.engagementRow}>
                      <EngagementStat kind="likes" value={leadStory.like_count} />
                      <EngagementStat kind="comments" value={leadStory.comment_count} />
                    </div>
                    {hasDistinctSummary(leadStory) ? <div className={styles.summary}>{leadStory.summary}</div> : null}
                    <div className={styles.impactStrip}>
                      <span>Market impact</span>
                      <RelatedTickerPills item={leadStory} />
                    </div>
                  </div>
                </article>

                {mainFeatureItems.length ? (
                  <div className={styles.featuredList}>
                    {mainFeatureItems.map((item) => (
                      <article key={item.id} className={`${styles.item} ${styles.itemFeatured}`}>
                        {item.thumbnail_url ? (
                          <Link href={getArticleHref(item)} className={styles.mediaLink}>
                            <img src={getCompactThumbnailUrl(item.thumbnail_url) || item.thumbnail_url} alt="" className={styles.thumb} />
                          </Link>
                        ) : null}
                        <div className={styles.itemBody}>
                          <div className={styles.featuredKicker}>Featured</div>
                          <StoryHeadingLink item={item} isLead={false} />
                          <ArticleMeta publishedAt={item.published_at} source={item.source} />
                          <div className={styles.engagementRow}>
                            <EngagementStat kind="likes" value={item.like_count} />
                            <EngagementStat kind="comments" value={item.comment_count} />
                          </div>
                          {hasDistinctSummary(item) ? <div className={styles.summary}>{item.summary}</div> : null}
                          <RelatedTickerPills item={item} />
                        </div>
                      </article>
                    ))}
                  </div>
                ) : null}

                {mainHeadlineItems.length ? (
                  <div className={styles.list}>
                    {mainHeadlineItems.map((item) => (
                      <article key={item.id} className={styles.item}>
                        <div className={styles.itemBody}>
                          <StoryHeadingLink item={item} isLead={false} />
                          <ArticleMeta publishedAt={item.published_at} source={item.source} />
                          <div className={styles.engagementRow}>
                            <EngagementStat kind="likes" value={item.like_count} />
                            <EngagementStat kind="comments" value={item.comment_count} />
                          </div>
                          {hasDistinctSummary(item) ? <div className={styles.summary}>{item.summary}</div> : null}
                          <RelatedTickerPills item={item} />
                        </div>
                      </article>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className={styles.sideRail}>
                <div className={styles.sideRailHeader}>
                  More Headlines
                </div>
                <div className={styles.sideContent}>
                  {sideFeature ? (
                    <article className={`${styles.item} ${styles.itemFeaturedCompact}`}>
                      {sideFeature.thumbnail_url ? (
                        <Link href={getArticleHref(sideFeature)} className={styles.mediaLink}>
                          <img src={getCompactThumbnailUrl(sideFeature.thumbnail_url) || sideFeature.thumbnail_url} alt="" className={styles.thumb} />
                        </Link>
                      ) : null}
                      <div className={styles.itemBody}>
                        <div className={styles.featuredKicker}>Featured</div>
                        <StoryHeadingLink item={sideFeature} isLead={false} />
                        <ArticleMeta publishedAt={sideFeature.published_at} source={sideFeature.source} />
                        <div className={styles.engagementRow}>
                          <EngagementStat kind="likes" value={sideFeature.like_count} />
                          <EngagementStat kind="comments" value={sideFeature.comment_count} />
                        </div>
                        {hasDistinctSummary(sideFeature) ? <div className={styles.summary}>{sideFeature.summary}</div> : null}
                        <RelatedTickerPills item={sideFeature} />
                      </div>
                    </article>
                  ) : null}

                  {sideHeadlineItems.length ? (
                    <div className={styles.list}>
                      {sideHeadlineItems.map((item) => (
                        <article key={item.id} className={styles.item}>
                          <div className={styles.itemBody}>
                            <StoryHeadingLink item={item} isLead={false} />
                            <ArticleMeta publishedAt={item.published_at} source={item.source} />
                            <div className={styles.engagementRow}>
                              <EngagementStat kind="likes" value={item.like_count} />
                              <EngagementStat kind="comments" value={item.comment_count} />
                            </div>
                            {hasDistinctSummary(item) ? <div className={styles.summary}>{item.summary}</div> : null}
                            <RelatedTickerPills item={item} />
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : null}
                </div>

                <Image src="/ame-news.png" alt="" width={400} height={320} className={styles.sideFooterImage} />
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <div className={styles.empty}>{error ? `News feed unavailable: ${error}` : "News store scaffolded and ready for a real feed."}</div>
      )}
    </section>
  );
}

export function CompactNewsGrid({
  items,
  variant = "default",
}: {
  items: NewsItem[];
  variant?: "default" | "twoColumn";
}) {
  if (!items.length) return null;

  return (
    <div className={[styles.compactGrid, variant === "twoColumn" ? styles.compactGridTwoColumn : ""].filter(Boolean).join(" ")}>
      {items.map((item) => (
        <article key={item.id} className={`${styles.item} ${styles.compactItem}`}>
          <div className={styles.itemBody}>
            <StoryHeadingLink item={item} isLead={false} />
            <ArticleMeta publishedAt={item.published_at} source={item.source} />
            <div className={styles.engagementRow}>
              <EngagementStat kind="likes" value={item.like_count} />
              <EngagementStat kind="comments" value={item.comment_count} />
            </div>
            {hasDistinctSummary(item) ? <div className={styles.summary}>{item.summary}</div> : null}
            <RelatedTickerPills item={item} />
          </div>
        </article>
      ))}
    </div>
  );
}
