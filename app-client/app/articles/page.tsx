import type { Metadata } from "next";
import { ArticlesIndex, type FeedQuery } from "@/app/components/articles/articles-index";

export const metadata: Metadata = { title: "Articles" };

type Params = { type?: string; q?: string; stock?: string; unit?: string; sort?: string; page?: string };

export default async function Page({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const type = params.type === "news" || params.type === "community" ? params.type : "all";
  const initial: FeedQuery = {
    type,
    q: typeof params.q === "string" ? params.q : "",
    stock: typeof params.stock === "string" ? params.stock.toUpperCase() : "",
    unit: type === "news" && typeof params.unit === "string" ? params.unit : "",
    sort: type === "news" && params.sort === "oldest" ? "oldest" : "newest",
    page: Math.max(1, Number(params.page) || 1),
  };
  return <ArticlesIndex key={type} initial={initial} />;
}
