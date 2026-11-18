import { AdminMahjongFeedbackPage } from "@/app/components/admin/admin-mahjong-feedback-page";
import { requireFeature } from "@/app/lib/features-server";

export async function generateMetadata() {
  await requireFeature("mahjong");
  return { title: "Mahjong feedback" };
}

export default async function Page() {
  await requireFeature("mahjong");
  return <AdminMahjongFeedbackPage />;
}
