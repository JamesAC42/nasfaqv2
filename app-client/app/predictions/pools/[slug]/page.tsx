import { Suspense } from "react";
import { PoolPage } from "@/app/components/predictions/pool/pool-page";

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <Suspense fallback={null}>
      <PoolPage slug={decodeURIComponent(slug)} />
    </Suspense>
  );
}
