"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FaChevronDown, FaCircleCheck, FaFloppyDisk, FaNewspaper, FaPenNib } from "react-icons/fa6";
import { AssetPicker } from "@/app/components/common/asset-picker";
import { OptionPicker } from "@/app/components/common/option-picker";
import { VerificationRequiredNotice, userNeedsEmailVerification } from "@/app/components/common/verification-required-notice";
import { SiteShell } from "@/app/components/layout/site-shell";
import { apiFetch } from "@/app/lib/api";
import { fmtNumber } from "@/app/lib/format";
import { normalizeArticleDetail } from "@/app/lib/normalizers";
import type { ArticleDetail } from "@/app/lib/types";
import { useAuth } from "@/app/providers/auth-provider";
import { useMarketStore } from "@/app/stores/market-store";
import styles from "@/app/components/articles/article-pages.module.scss";

const ARTICLE_EDITOR_DRAFT_KEY = "nasfaq:article-editor:draft";

type ArticleEditorDraft = {
  title: string;
  subtitle: string;
  thumbnailUrl: string;
  tagText: string;
  content: string;
  status: string;
  selectedAssetIds: number[];
  savedAt: string;
};

function readArticleEditorDraft() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ARTICLE_EDITOR_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ArticleEditorDraft>;
    return {
      title: typeof parsed.title === "string" ? parsed.title : "",
      subtitle: typeof parsed.subtitle === "string" ? parsed.subtitle : "",
      thumbnailUrl: typeof parsed.thumbnailUrl === "string" ? parsed.thumbnailUrl : "",
      tagText: typeof parsed.tagText === "string" ? parsed.tagText : "",
      content: typeof parsed.content === "string" ? parsed.content : "",
      status: parsed.status === "draft" ? "draft" : "published",
      selectedAssetIds: Array.isArray(parsed.selectedAssetIds) ? parsed.selectedAssetIds.filter((value): value is number => Number.isFinite(value)) : [],
      savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : "",
    };
  } catch {
    return null;
  }
}

function clearArticleEditorDraft() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(ARTICLE_EDITOR_DRAFT_KEY);
}

export function ArticleEditorPage({
  slug = null,
  mode,
}: {
  slug?: string | null;
  mode: "create" | "edit";
}) {
  const router = useRouter();
  const { user, initialized, isLoading: isAuthLoading } = useAuth();
  const assets = useMarketStore((state) => state.assets);

  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [tagText, setTagText] = useState("");
  const [content, setContent] = useState("");
  const [status, setStatus] = useState("published");
  const [selectedAssetIds, setSelectedAssetIds] = useState<number[]>([]);
  const [assetPickerValue, setAssetPickerValue] = useState("");
  const [article, setArticle] = useState<ArticleDetail | null>(null);
  const [isLoading, setIsLoading] = useState(mode === "edit");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftLoaded, setDraftLoaded] = useState(mode !== "create");
  const [autosaveState, setAutosaveState] = useState<"idle" | "saved">("idle");
  const [bodyMode, setBodyMode] = useState<"write" | "preview">("write");

  const selectedAssets = useMemo(
    () => assets.filter((asset) => selectedAssetIds.includes(asset.id)),
    [assets, selectedAssetIds]
  );
  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;

  useEffect(() => {
    if (mode !== "edit" || !slug) return;
    const safeSlug = slug;
    let cancelled = false;
    async function loadArticle() {
      setIsLoading(true);
      setError(null);
      try {
        const result = await apiFetch<{ article: Record<string, unknown> }>(`/api/articles/${encodeURIComponent(safeSlug)}`);
        const normalized = normalizeArticleDetail(result.article);
        if (cancelled) return;
        setArticle(normalized);
        setTitle(normalized.title);
        setSubtitle(normalized.subtitle || "");
        setThumbnailUrl(normalized.thumbnail_url || "");
        setTagText(normalized.tags.join(", "));
        setContent(normalized.content);
        setStatus(normalized.status);
        setSelectedAssetIds(normalized.related_assets.map((asset) => asset.id));
      } catch (nextError) {
        if (!cancelled) setError(String((nextError as Error).message || nextError));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void loadArticle();
    return () => {
      cancelled = true;
    };
  }, [mode, slug]);

  useEffect(() => {
    if (mode !== "create") return;
    const timerId = window.setTimeout(() => {
      const draft = readArticleEditorDraft();
      if (draft) {
        setTitle(draft.title);
        setSubtitle(draft.subtitle);
        setThumbnailUrl(draft.thumbnailUrl);
        setTagText(draft.tagText);
        setContent(draft.content);
        setStatus(draft.status);
        setSelectedAssetIds(draft.selectedAssetIds);
        setAutosaveState("saved");
      }
      setDraftLoaded(true);
    }, 0);
    return () => window.clearTimeout(timerId);
  }, [mode]);

  useEffect(() => {
    if (mode !== "create" || !draftLoaded) return;
    setAutosaveState("idle");
    const timerId = window.setTimeout(() => {
      const hasDraftContent = Boolean(
        title.trim() ||
        subtitle.trim() ||
        thumbnailUrl.trim() ||
        tagText.trim() ||
        content.trim() ||
        selectedAssetIds.length
      );
      if (!hasDraftContent) {
        clearArticleEditorDraft();
        setAutosaveState("idle");
        return;
      }
      const draft: ArticleEditorDraft = {
        title,
        subtitle,
        thumbnailUrl,
        tagText,
        content,
        status,
        selectedAssetIds,
        savedAt: new Date().toISOString(),
      };
      window.localStorage.setItem(ARTICLE_EDITOR_DRAFT_KEY, JSON.stringify(draft));
      setAutosaveState("saved");
    }, 600);
    return () => window.clearTimeout(timerId);
  }, [content, draftLoaded, mode, selectedAssetIds, status, subtitle, tagText, thumbnailUrl, title]);

  function addAssetBySymbol(symbol: string) {
    const asset = assets.find((entry) => entry.symbol === symbol);
    if (!asset) return;
    setSelectedAssetIds((current) => current.includes(asset.id) ? current : [...current, asset.id]);
    setAssetPickerValue("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || !content.trim()) return;
    if (userNeedsEmailVerification(user)) {
      setError("Verify your email before you can write articles.");
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const payload = {
        title,
        subtitle: subtitle || null,
        thumbnail_url: thumbnailUrl || null,
        tags: tagText.split(",").map((tag) => tag.trim()).filter(Boolean),
        content,
        asset_ids: selectedAssetIds,
        status,
      };
      const result = mode === "edit" && slug
        ? await apiFetch<{ article: Record<string, unknown> }>(`/api/articles/${encodeURIComponent(slug)}`, {
            method: "PUT",
            body: JSON.stringify(payload),
          })
        : await apiFetch<{ article: Record<string, unknown> }>("/api/articles", {
            method: "POST",
            body: JSON.stringify(payload),
          });
      const normalized = normalizeArticleDetail(result.article);
      if (mode === "create") clearArticleEditorDraft();
      router.push(`/articles/${encodeURIComponent(normalized.slug)}`);
    } catch (nextError) {
      setError(String((nextError as Error).message || nextError));
    } finally {
      setIsSaving(false);
    }
  }

  if (!initialized || isAuthLoading) {
    return (
      <SiteShell>
        <div className={styles.stack}>
          <section className={styles.hero}>
            <div className={styles.heroCopy}>
              <div className={styles.heroEyebrow}>Publishing desk</div>
              <h1 className={styles.title}>Loading session</h1>
              <div className={styles.heroMeta}><span>Checking your account session before opening the editor.</span></div>
            </div>
          </section>
        </div>
      </SiteShell>
    );
  }

  if (!user) {
    return (
      <SiteShell>
        <div className={styles.stack}>
          <section className={styles.hero}>
            <div className={styles.heroCopy}>
              <div className={styles.heroEyebrow}>Publishing desk</div>
              <h1 className={styles.title}>Sign in required</h1>
              <div className={styles.heroMeta}><span>You need an account session to create or edit articles.</span></div>
            </div>
          </section>
        </div>
      </SiteShell>
    );
  }

  if (userNeedsEmailVerification(user)) {
    return (
      <SiteShell>
        <div className={styles.stack}>
          <section className={styles.hero}>
            <div className={styles.heroCopy}>
              <div className={styles.heroEyebrow}>Publishing desk</div>
              <h1 className={styles.title}>Email verification required</h1>
              <div className={styles.heroMeta}><span>Verify your email before creating or editing articles.</span></div>
            </div>
          </section>
          <VerificationRequiredNotice action="write articles" />
        </div>
      </SiteShell>
    );
  }

  return (
    <SiteShell>
      <div className={styles.stack}>
        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <div className={styles.heroEyebrow}>
              <FaNewspaper aria-hidden="true" />
              Publishing desk
            </div>
            <h1 className={styles.title}>{mode === "edit" ? "Edit Article" : "Write Article"}</h1>
            <div className={styles.heroMeta}>
              <span>{mode === "create" ? "Local autosave enabled" : "Editing published article"}</span>
              <span>{wordCount} words</span>
              <span>{selectedAssets.length} related asset{selectedAssets.length === 1 ? "" : "s"}</span>
            </div>
          </div>
          <div className={styles.editorHeroStatus}>
            <span className={autosaveState === "saved" ? styles.autosaveSaved : undefined}>
              {autosaveState === "saved" ? <FaCircleCheck aria-hidden="true" /> : <FaFloppyDisk aria-hidden="true" />}
              {mode === "create" ? (autosaveState === "saved" ? "Draft saved locally" : "Autosaving draft") : "Manual save"}
            </span>
          </div>
        </section>

        {error ? <div className="statusMessage statusMessageError">Article editor error: {error}</div> : null}
        {isLoading ? <div className={styles.panel}>Loading article editor...</div> : null}

        {!isLoading && (mode === "create" || article) ? (
          <form className={`${styles.editorCard} ${styles.editorWorkspace}`.trim()} onSubmit={handleSubmit}>
            <div className={styles.editorMain}>
              <div className={styles.editorSectionHeader}>
                <span><FaPenNib aria-hidden="true" /> Article copy</span>
                <div className={styles.editorHeaderControls}>
                  <em>{wordCount ? `${wordCount} words` : "Markdown supported"}</em>
                  <div className={styles.editorModeToggle} aria-label="Body editor mode">
                    <button
                      type="button"
                      className={bodyMode === "write" ? styles.editorModeActive : undefined}
                      onClick={() => setBodyMode("write")}
                    >
                      Write
                    </button>
                    <button
                      type="button"
                      className={bodyMode === "preview" ? styles.editorModeActive : undefined}
                      onClick={() => setBodyMode("preview")}
                    >
                      Preview
                    </button>
                  </div>
                </div>
              </div>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Title</span>
                <input className={`${styles.input} ${styles.editorTitleInput}`.trim()} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Article title" />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Subtitle</span>
                <input className={styles.input} value={subtitle} onChange={(event) => setSubtitle(event.target.value)} placeholder="Optional subtitle" />
              </label>
              <label className={`${styles.field} ${styles.bodyField}`.trim()}>
                <span className={styles.fieldLabel}>Body supports Markdown formatting</span>
                <details className={styles.markdownHelp}>
                  <summary>
                    <span>Markdown quick help</span>
                    <FaChevronDown aria-hidden="true" />
                  </summary>
                  <div className={styles.markdownHelpGrid}>
                    <code># Heading 1</code>
                    <span>Large section heading</span>
                    <code>## Heading 2</code>
                    <span>Subsection heading</span>
                    <code>**bold** and *italic*</code>
                    <span>Emphasis inside paragraphs</span>
                    <code>[link text](https://example.com)</code>
                    <span>Inline links</span>
                    <code>- list item</code>
                    <span>Bulleted lists</span>
                    <code>&gt; quoted text</code>
                    <span>Blockquotes</span>
                  </div>
                </details>
                {bodyMode === "write" ? (
                  <textarea
                    className={`${styles.textarea} ${styles.editorTextarea}`.trim()}
                    value={content}
                    onChange={(event) => setContent(event.target.value)}
                    placeholder={"Write the full article body.\n\nUse Markdown for headings, links, lists, tables, quotes, and code."}
                  />
                ) : (
                  <div className={styles.editorPreview}>
                    {content.trim() ? (
                      <div className={styles.markdownBody}>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {content}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      <div className={styles.editorPreviewEmpty}>Preview appears here after you write Markdown content.</div>
                    )}
                  </div>
                )}
              </label>
            </div>

            <aside className={styles.editorSidebar}>
              <div className={styles.editorSectionHeader}>
                <span>Publishing settings</span>
                <em>{status}</em>
              </div>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Status</span>
                <OptionPicker
                  value={status}
                  onChange={setStatus}
                  placeholder="Published"
                  options={[
                    { value: "published", label: "Published" },
                    { value: "draft", label: "Draft" },
                  ]}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Thumbnail URL</span>
                <input className={styles.input} value={thumbnailUrl} onChange={(event) => setThumbnailUrl(event.target.value)} placeholder="https://..." />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Tags</span>
                <input className={styles.input} value={tagText} onChange={(event) => setTagText(event.target.value)} placeholder="Comma-separated tags" />
              </label>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Related assets</span>
                <div className={styles.inlinePicker}>
                  <div className={styles.assetSelectRow}>
                    <AssetPicker
                      assets={assets}
                      value={assetPickerValue}
                      onChange={(value) => {
                        setAssetPickerValue(value);
                        if (value) addAssetBySymbol(value);
                      }}
                      placeholder="Pick an asset"
                      emptyLabel="Clear selection"
                    />
                  </div>
                  {selectedAssets.length ? (
                    <div className={styles.assetRow}>
                      {selectedAssets.map((asset) => (
                        <span key={asset.id} className={styles.assetPill}>
                          <strong>{asset.symbol}</strong>
                          <em>{fmtNumber(asset.current_mid_price, "$")}</em>
                          <button
                            type="button"
                            className={styles.assetRemoveButton}
                            onClick={() => setSelectedAssetIds((current) => current.filter((entry) => entry !== asset.id))}
                            aria-label={`Remove ${asset.symbol}`}
                          >
                            x
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className={styles.helperText}>Selected assets appear on stock pages as related reading.</div>
                  )}
                </div>
              </div>
              <div className={styles.editorActions}>
                <button type="submit" className={styles.primaryButton} disabled={isSaving || !title.trim() || !content.trim()}>
                  {isSaving ? "Saving..." : mode === "edit" ? "Update article" : "Publish article"}
                </button>
              </div>
            </aside>
          </form>
        ) : null}
      </div>
    </SiteShell>
  );
}
