import { UserItemLockerPage } from "@/app/components/games/user-item-locker-page";

export default async function Page({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  return <UserItemLockerPage username={decodeURIComponent(username)} />;
}
