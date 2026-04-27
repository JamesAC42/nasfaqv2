import { Suspense } from "react";
import { PredictionsPage } from "@/app/components/pages/predictions-page";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <PredictionsPage initialScope="review_queue" />
    </Suspense>
  );
}
