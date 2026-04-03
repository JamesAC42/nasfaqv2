import { ArticleEditorPage } from "@/app/components/pages/article-editor-page";

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <ArticleEditorPage mode="edit" slug={decodeURIComponent(slug)} />;
}
