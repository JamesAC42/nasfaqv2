"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AssetPicker } from "@/app/components/common/asset-picker";
import { OptionPicker } from "@/app/components/common/option-picker";
import { VerificationRequiredNotice, userNeedsEmailVerification } from "@/app/components/common/verification-required-notice";
import { SiteShell } from "@/app/components/layout/site-shell";
import { apiFetch } from "@/app/lib/api";
import { normalizeArticleDetail } from "@/app/lib/normalizers";
import type { ArticleDetail } from "@/app/lib/types";
import { useAuth } from "@/app/providers/auth-provider";
import { useMarketStore } from "@/app/stores/market-store";
import styles from "@/app/components/articles/article-pages.module.scss";

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

  const selectedAssets = useMemo(
    () => assets.filter((asset) => selectedAssetIds.includes(asset.id)),
    [assets, selectedAssetIds]
  );

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

  function addSelectedAsset() {
    const asset = assets.find((entry) => entry.symbol === assetPickerValue);
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
            <div className={styles.eyebrow}>Publishing Desk</div>
            <h1 className={styles.title}>Loading session</h1>
            <p className={styles.copy}>Checking your account session before opening the editor.</p>
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
            <div className={styles.eyebrow}>Publishing Desk</div>
            <h1 className={styles.title}>Sign in required</h1>
            <p className={styles.copy}>You need an account session to create or edit articles.</p>
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
            <div className={styles.eyebrow}>Publishing Desk</div>
            <h1 className={styles.title}>Email verification required</h1>
            <p className={styles.copy}>Verify your email before creating or editing articles.</p>
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
          <div className={styles.eyebrow}>Publishing Desk</div>
          <h1 className={styles.title}>{mode === "edit" ? "Edit Article" : "Write Article"}</h1>
          <p className={styles.copy}>
            Build a publishable article with tags, asset associations, and a proper article body instead of the current placeholder cards.
          </p>
        </section>

        {error ? <div className="statusMessage statusMessageError">Article editor error: {error}</div> : null}
        {isLoading ? <div className={styles.panel}>Loading article editor…</div> : null}

        {!isLoading && (mode === "create" || article) ? (
          <form className={styles.editorCard} onSubmit={handleSubmit}>
            <div className={styles.fieldGrid}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Title</span>
                <input className={styles.input} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Article title" />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Subtitle</span>
                <input className={styles.input} value={subtitle} onChange={(event) => setSubtitle(event.target.value)} placeholder="Optional subtitle" />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Thumbnail URL</span>
                <input className={styles.input} value={thumbnailUrl} onChange={(event) => setThumbnailUrl(event.target.value)} placeholder="https://…" />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Tags</span>
                <input className={styles.input} value={tagText} onChange={(event) => setTagText(event.target.value)} placeholder="Comma-separated tags" />
              </label>
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
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Related assets</span>
                <div className={styles.inlinePicker}>
                  <div className={styles.assetSelectRow}>
                    <AssetPicker
                      assets={assets}
                      value={assetPickerValue}
                      onChange={setAssetPickerValue}
                      placeholder="Pick an asset"
                      emptyLabel="Clear selection"
                    />
                    <button type="button" className={styles.secondaryButton} onClick={addSelectedAsset} disabled={!assetPickerValue}>
                      Add asset
                    </button>
                  </div>
                  {selectedAssets.length ? (
                    <div className={styles.assetRow}>
                      {selectedAssets.map((asset) => (
                        <span key={asset.id} className={styles.assetPill}>
                          {asset.symbol}
                          <button
                            type="button"
                            className={styles.assetRemoveButton}
                            onClick={() => setSelectedAssetIds((current) => current.filter((entry) => entry !== asset.id))}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className={styles.helperText}>Selected assets will be used on stock pages to show related articles.</div>
                  )}
                </div>
              </div>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Body</span>
                <textarea className={styles.textarea} value={content} onChange={(event) => setContent(event.target.value)} placeholder="Write the full article body." />
              </label>
            </div>
            <div className={styles.actionRow}>
              <button type="submit" className={styles.primaryButton} disabled={isSaving || !title.trim() || !content.trim()}>
                {isSaving ? "Saving…" : mode === "edit" ? "Update article" : "Publish article"}
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </SiteShell>
  );
}
