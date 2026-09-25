import { Suspense } from "react";
import { MarketPage } from "@/app/components/predictions/market/market-page";

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <Suspense fallback={null}>
      <MarketPage slug={decodeURIComponent(slug)} />
    </Suspense>
  );
}
