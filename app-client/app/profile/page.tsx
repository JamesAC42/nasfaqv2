import type { Metadata } from "next";
import { ProfileView } from "@/app/components/profile/profile-view";

export const metadata: Metadata = { title: "Your profile" };

export default function Page() {
  return <ProfileView />;
}
