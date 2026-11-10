import type { Metadata } from "next";
import { Suspense } from "react";
import { ChatApp } from "@/app/components/chat/chat-app";

export const metadata: Metadata = { title: "Chat" };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ChatApp />
    </Suspense>
  );
}
