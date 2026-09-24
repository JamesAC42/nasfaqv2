import { ArticleView } from "@/app/components/articles/article-view";

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <ArticleView slug={decodeURIComponent(slug)} />;
}
