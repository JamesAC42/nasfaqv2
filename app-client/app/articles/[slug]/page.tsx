import { ArticleDetailPage } from "@/app/components/pages/article-detail-page";

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <ArticleDetailPage slug={decodeURIComponent(slug)} />;
}
