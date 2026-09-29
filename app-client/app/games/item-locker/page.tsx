import type { Metadata } from "next";
import { LockerPage } from "@/app/components/games/locker/locker-page";

export const metadata: Metadata = { title: "My locker" };

export default function Page() {
  return <LockerPage />;
}
