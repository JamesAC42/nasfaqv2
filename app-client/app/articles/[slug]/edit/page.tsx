import type { Metadata } from "next";
import { ArticleEditor } from "@/app/components/articles/article-editor";

export const metadata: Metadata = { title: "Edit article" };

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <ArticleEditor mode="edit" slug={decodeURIComponent(slug)} />;
}
