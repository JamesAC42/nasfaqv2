import { Suspense } from "react";
import { PoolHistory } from "@/app/components/predictions/pool/pool-history";

export const metadata = { title: "Pool history" };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <PoolHistory />
    </Suspense>
  );
}
