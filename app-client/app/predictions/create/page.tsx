import { redirect } from "next/navigation";
import { CreateMarketForm } from "@/app/components/predictions/admin/create-market-form";
import { serverFeatures } from "@/app/lib/features-server";

export const metadata = { title: "New prediction market" };

// With pools on, new bets are pools and the API refuses a new market-maker market. The form stays
// until that code goes (docs/design/predictions-pools.md §4).
export default async function Page() {
  if ((await serverFeatures())["prediction-pools"]) redirect("/predictions/bookie");
  return <CreateMarketForm />;
}
