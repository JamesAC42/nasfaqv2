import { redirect } from "next/navigation";

// The oshiboards now live on the leaderboard's "By talent" tab.
export default async function Page({ searchParams }: { searchParams: Promise<{ coin?: string }> }) {
  const { coin } = await searchParams;
  redirect(`/leaderboard?tab=talent${typeof coin === "string" && coin ? `&coin=${encodeURIComponent(coin)}` : ""}`);
}
