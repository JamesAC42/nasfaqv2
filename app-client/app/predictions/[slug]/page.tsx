import { Suspense } from "react";
import { PredictionsPage } from "@/app/components/pages/predictions-page";

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <Suspense fallback={null}>
      <PredictionsPage initialMarketSlug={slug} />
    </Suspense>
  );
}
