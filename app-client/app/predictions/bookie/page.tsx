import type { Metadata } from "next";
import { BookieDesk } from "@/app/components/predictions/pool/bookie-desk";
import { requireFeature } from "@/app/lib/features-server";

// Behind the prediction-pools flag (api/src/features): a 404 for anyone it isn't on for.

export async function generateMetadata(): Promise<Metadata> {
  await requireFeature("prediction-pools");
  return { title: "Bookie desk" };
}

export default async function Page() {
  await requireFeature("prediction-pools");
  return <BookieDesk />;
}
