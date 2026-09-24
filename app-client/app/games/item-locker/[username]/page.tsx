import type { Metadata } from "next";
import { PublicLockerPage } from "@/app/components/games/locker/public-locker-page";

type Params = { params: Promise<{ username: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { username } = await params;
  return { title: `${decodeURIComponent(username)}'s locker` };
}

export default async function Page({ params }: Params) {
  const { username } = await params;
  return <PublicLockerPage username={decodeURIComponent(username)} />;
}
