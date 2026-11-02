import type { Metadata } from "next";
import { V1LinkPage } from "@/app/components/profile/v1-link-page";

export const metadata: Metadata = {
  title: "Link your v1 account | NASFAQ",
  description: "Played the original NASFAQ? Link your old account for a veteran badge, a trophy on your profile and the v1 Classic theme.",
};

export default function Page() {
  return <V1LinkPage />;
}
