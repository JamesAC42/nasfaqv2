import { StockDetailPage } from "@/app/components/pages/stock-detail-page";

export default async function Page({
  params,
}: {
  params: Promise<{ stockName: string }>;
}) {
  const { stockName } = await params;

  return <StockDetailPage symbol={decodeURIComponent(stockName)} />;
}
