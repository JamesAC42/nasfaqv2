/* eslint-disable @next/next/no-img-element */
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { imageHost, safeImageUrl } from "@/app/lib/image-hosts";

// Pictures in an article body load only from known hosts (lib/image-hosts.ts). Any other shows as a
// link to it instead, so an article can't make every reader's browser fetch from wherever its
// author likes.
const components: Components = {
  img({ src, alt }) {
    const url = typeof src === "string" ? src : "";
    const safe = safeImageUrl(url);
    if (safe) return <img src={safe} alt={alt ?? ""} loading="lazy" />;
    if (!/^https?:\/\//i.test(url)) return null;
    const host = imageHost(url);
    return (
      <a href={url} target="_blank" rel="noopener noreferrer nofollow ugc">
        {alt || "Picture"}
        {host ? ` (${host})` : ""}
      </a>
    );
  },
};

/** An article's (or a draft's) Markdown body, as every article page shows it. */
export function ArticleMarkdown({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {children}
    </ReactMarkdown>
  );
}
