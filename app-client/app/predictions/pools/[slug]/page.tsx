import { Suspense } from "react";
import { PoolPage } from "@/app/components/predictions/pool/pool-page";
import { requireFeature } from "@/app/lib/features-server";

// Behind the prediction-pools flag (api/src/features): a 404 for anyone it isn't on for.

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  await requireFeature("prediction-pools");
  const { slug } = await params;
  return (
    <Suspense fallback={null}>
      <PoolPage slug={decodeURIComponent(slug)} />
    </Suspense>
  );
}
