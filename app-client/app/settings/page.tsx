import type { Metadata } from "next";
import { SettingsPage } from "@/app/components/settings/settings-page";
import { requireFeature } from "@/app/lib/features-server";

// Behind the checkin-reminders flag (api/src/features) while Notifications is the only section: a 404
// for anyone it isn't on for. When a section that isn't gated lands (Display, say), drop these checks
// and gate only the Notifications section.

export async function generateMetadata(): Promise<Metadata> {
  await requireFeature("checkin-reminders");
  return { title: "Settings" };
}

export default async function Page() {
  await requireFeature("checkin-reminders");
  return <SettingsPage />;
}
