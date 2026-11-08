import { redirect } from "next/navigation";
import { requireFeature } from "@/app/lib/features-server";

// The calendar is a mode of the Livestreams page now. Old links land on it; anyone without the
// stream-calendar flag (api/src/features) still gets a 404 here.

export default async function Page() {
  await requireFeature("stream-calendar");
  redirect("/livestreams?view=calendar");
}
