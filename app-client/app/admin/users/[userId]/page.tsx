import { AdminUserDetailPage } from "@/app/components/admin/admin-user-detail";

export const metadata = { title: "User" };

export default async function Page({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  return <AdminUserDetailPage userId={Number(userId)} />;
}
