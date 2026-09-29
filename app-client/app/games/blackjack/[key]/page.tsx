import { BlackjackTablePage } from "@/app/components/games/blackjack/blackjack-table";

export default async function Page({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return <BlackjackTablePage key={key} tableKey={decodeURIComponent(key)} />;
}
