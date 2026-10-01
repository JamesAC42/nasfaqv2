import type { Metadata } from "next";
import { ArticleView } from "@/app/components/articles/article-view";
import { cardText, fetchApi } from "@/app/lib/og";

/** The headline and a line of the story, for link previews (the share card is opengraph-image.tsx). */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const body = await fetchApi<{ article: { title: string; subtitle?: string | null; preview?: string | null } }>(`/api/articles/${encodeURIComponent(decodeURIComponent(slug))}`, 3600);
  const article = body?.article;
  if (!article) return { title: "Article" };
  const description = cardText(article.subtitle || article.preview || "", 200);
  return { title: article.title, ...(description ? { description } : {}) };
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <ArticleView slug={decodeURIComponent(slug)} />;
}
