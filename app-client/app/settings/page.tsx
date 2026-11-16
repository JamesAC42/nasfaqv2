import type { Metadata } from "next";
import { SettingsPage } from "@/app/components/settings/settings-page";
import { requireAnyFeature } from "@/app/lib/features-server";

// Each section has its own flag (api/src/features): Notifications is checkin-reminders, Display is
// timezone-setting. The page is a 404 for anyone neither is on for; once timezone-setting is on,
// everyone gets it. When both flags are retired, drop these checks.
const SECTION_FLAGS = ["checkin-reminders", "timezone-setting"];

export async function generateMetadata(): Promise<Metadata> {
  await requireAnyFeature(...SECTION_FLAGS);
  return { title: "Settings" };
}

export default async function Page() {
  await requireAnyFeature(...SECTION_FLAGS);
  return <SettingsPage />;
}
