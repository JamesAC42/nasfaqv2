import { redirect } from "next/navigation";

// The HoloNews archive is now the HoloNews tab of Articles.
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const next = new URLSearchParams({ type: "news" });
  for (const key of ["q", "stock", "unit", "sort", "page"]) {
    const value = params[key];
    if (typeof value === "string" && value) next.set(key, value);
  }
  redirect(`/articles?${next}`);
}
