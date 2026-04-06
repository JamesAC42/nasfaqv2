import { ProfilePage } from "@/app/components/profile/profile-page";

export default async function Page({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  return <ProfilePage username={decodeURIComponent(username)} />;
}
