"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/app/lib/api";

export type ThreadPost = { post_id: number; timestamp: number | null; text_content: string };

/** The latest posts from the mirrored /vt/ general, newest first (null while loading). */
export function useThreadPosts(count = 4) {
  const [posts, setPosts] = useState<ThreadPost[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    apiFetch<{ posts?: ThreadPost[] }>("/api/getNasfaqThread")
      .then((result) => {
        if (cancelled) return;
        const list = Array.isArray(result?.posts) ? result.posts : [];
        setPosts(list.filter((post) => post.text_content?.trim()).slice(-count).reverse());
      })
      .catch(() => !cancelled && setPosts([]));
    return () => {
      cancelled = true;
    };
  }, [count]);
  return posts;
}

/** Post body split into display lines: drops reply links, flags greentext. */
export function threadLines(text: string, max = 4) {
  return text
    .split("\n")
    .filter((line) => line.trim() && !/^>>\d+/.test(line.trim()))
    .slice(0, max)
    .map((line) => ({ text: line.length > 120 ? `${line.slice(0, 117)}…` : line, green: line.trim().startsWith(">") }));
}
