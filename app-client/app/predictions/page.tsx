import { Suspense } from "react";
import { PredictionsFloor } from "@/app/components/predictions/floor/predictions-floor";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <PredictionsFloor />
    </Suspense>
  );
}
