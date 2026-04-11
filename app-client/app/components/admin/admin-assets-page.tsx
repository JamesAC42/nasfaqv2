"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { SiteShell } from "@/app/components/layout/site-shell";
import { apiFetch } from "@/app/lib/api";
import { useAuth } from "@/app/providers/auth-provider";
import styles from "@/app/components/admin/admin-assets-page.module.scss";

type AdminEmojiAsset = {
  id: number;
  name: string;
  filename: string;
  url: string;
  is_deleted: boolean;
};

type AdminProfilePictureAsset = {
  id: number;
  name: string;
  filename_large: string;
  filename_small: string;
  url_large: string;
  url_small: string;
  is_deleted: boolean;
};

type AdminAssetsResponse = {
  emojis: AdminEmojiAsset[];
  profile_pictures: AdminProfilePictureAsset[];
};

function StatusMessage({ error, success }: { error: string | null; success: string | null }) {
  return (
    <>
      {error ? <div className="statusMessage statusMessageError">{error}</div> : null}
      {success ? <div className="statusMessage statusMessageSuccess">{success}</div> : null}
    </>
  );
}

function AssetSection({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        <div className={styles.sectionNote}>{note}</div>
      </div>
      {children}
    </section>
  );
}

async function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("file_read_failed"));
    reader.readAsDataURL(file);
  });
}

function EmojiRow({
  item,
  onUpdated,
}: {
  item: AdminEmojiAsset;
  onUpdated: (next: AdminEmojiAsset) => void;
}) {
  const [name, setName] = useState(item.name);
  const [isDeleted, setIsDeleted] = useState(item.is_deleted);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(item.name);
    setIsDeleted(item.is_deleted);
  }, [item.id, item.is_deleted, item.name]);

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ emoji: AdminEmojiAsset }>(`/api/admin/assets/emojis/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name, is_deleted: isDeleted }),
      });
      onUpdated(result.emoji);
    } catch (nextError) {
      setError(String((nextError as Error).message || nextError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr>
      <td>
        <div className={styles.previewCell}>
          <img src={item.url} alt={item.name} className={styles.previewImage} />
          <span className={styles.filename}>{item.filename}</span>
        </div>
      </td>
      <td>
        <input className={styles.input} value={name} onChange={(event) => setName(event.target.value)} />
      </td>
      <td>
        <label className={styles.checkbox}>
          <input type="checkbox" checked={isDeleted} onChange={(event) => setIsDeleted(event.target.checked)} />
          {isDeleted ? "Deleted" : "Active"}
        </label>
      </td>
      <td className={item.is_deleted ? styles.statusDeleted : styles.statusActive}>{item.is_deleted ? "Deleted" : "Active"}</td>
      <td>
        <div className={styles.actions}>
          <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => void handleSave()}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
        {error ? <div className="statusMessage statusMessageError">{error}</div> : null}
      </td>
    </tr>
  );
}

function ProfilePictureRow({
  item,
  onUpdated,
}: {
  item: AdminProfilePictureAsset;
  onUpdated: (next: AdminProfilePictureAsset) => void;
}) {
  const [name, setName] = useState(item.name);
  const [isDeleted, setIsDeleted] = useState(item.is_deleted);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(item.name);
    setIsDeleted(item.is_deleted);
  }, [item.id, item.is_deleted, item.name]);

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ profile_picture: AdminProfilePictureAsset }>(`/api/admin/assets/profile-pictures/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name, is_deleted: isDeleted }),
      });
      onUpdated(result.profile_picture);
    } catch (nextError) {
      setError(String((nextError as Error).message || nextError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr>
      <td>
        <div className={styles.previewCell}>
          <img src={item.url_large} alt={`${item.name} large`} className={styles.previewImage} />
          <span className={styles.filename}>{item.filename_large}</span>
        </div>
      </td>
      <td>
        <div className={styles.previewCell}>
          <img src={item.url_small} alt={`${item.name} small`} className={styles.previewImage} />
          <span className={styles.filename}>{item.filename_small}</span>
        </div>
      </td>
      <td>
        <input className={styles.input} value={name} onChange={(event) => setName(event.target.value)} />
      </td>
      <td>
        <label className={styles.checkbox}>
          <input type="checkbox" checked={isDeleted} onChange={(event) => setIsDeleted(event.target.checked)} />
          {isDeleted ? "Deleted" : "Active"}
        </label>
      </td>
      <td className={item.is_deleted ? styles.statusDeleted : styles.statusActive}>{item.is_deleted ? "Deleted" : "Active"}</td>
      <td>
        <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => void handleSave()}>
          {busy ? "Saving…" : "Save"}
        </button>
        {error ? <div className="statusMessage statusMessageError">{error}</div> : null}
      </td>
    </tr>
  );
}

export function AdminAssetsPage() {
  const { initialized, isLoading: isAuthLoading, user } = useAuth();
  const [bundle, setBundle] = useState<AdminAssetsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [emojiName, setEmojiName] = useState("");
  const [emojiFile, setEmojiFile] = useState<File | null>(null);
  const [emojiBusy, setEmojiBusy] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileLargeFile, setProfileLargeFile] = useState<File | null>(null);
  const [profileSmallFile, setProfileSmallFile] = useState<File | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);

  useEffect(() => {
    if (!initialized || !user?.is_admin) {
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const result = await apiFetch<AdminAssetsResponse>("/api/admin/assets", { signal: controller.signal });
        if (!controller.signal.aborted) setBundle(result);
      } catch (nextError) {
        if ((nextError as Error).name === "AbortError") return;
        setError(String((nextError as Error).message || nextError));
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }

    void load();
    return () => controller.abort();
  }, [initialized, user?.is_admin]);

  async function handleCreateEmoji(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!emojiFile) {
      setError("Choose an emoji image first.");
      return;
    }

    setEmojiBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const imageDataUrl = await fileToDataUrl(emojiFile);
      const result = await apiFetch<{ emoji: AdminEmojiAsset }>("/api/admin/assets/emojis", {
        method: "POST",
        body: JSON.stringify({
          name: emojiName,
          image_data_url: imageDataUrl,
        }),
      });
      setBundle((current) => current ? { ...current, emojis: [result.emoji, ...current.emojis.filter((item) => item.id !== result.emoji.id)] } : current);
      setEmojiName("");
      setEmojiFile(null);
      setSuccess("Emoji uploaded.");
    } catch (nextError) {
      setError(String((nextError as Error).message || nextError));
    } finally {
      setEmojiBusy(false);
    }
  }

  async function handleCreateProfilePicture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profileLargeFile || !profileSmallFile) {
      setError("Choose both the large and small profile picture files.");
      return;
    }

    setProfileBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const [largeDataUrl, smallDataUrl] = await Promise.all([
        fileToDataUrl(profileLargeFile),
        fileToDataUrl(profileSmallFile),
      ]);
      const result = await apiFetch<{ profile_picture: AdminProfilePictureAsset }>("/api/admin/assets/profile-pictures", {
        method: "POST",
        body: JSON.stringify({
          name: profileName,
          image_large_data_url: largeDataUrl,
          image_small_data_url: smallDataUrl,
        }),
      });
      setBundle((current) =>
        current
          ? {
              ...current,
              profile_pictures: [result.profile_picture, ...current.profile_pictures.filter((item) => item.id !== result.profile_picture.id)],
            }
          : current
      );
      setProfileName("");
      setProfileLargeFile(null);
      setProfileSmallFile(null);
      setSuccess("Profile picture uploaded.");
    } catch (nextError) {
      setError(String((nextError as Error).message || nextError));
    } finally {
      setProfileBusy(false);
    }
  }

  if (!initialized || isAuthLoading) {
    return (
      <SiteShell>
        <div className={styles.empty}>Loading admin session…</div>
      </SiteShell>
    );
  }

  if (!user?.is_admin) {
    return (
      <SiteShell>
        <div className={styles.empty}>This page is limited to admin users.</div>
      </SiteShell>
    );
  }

  return (
    <SiteShell>
      <div className={styles.page}>
        <section className={styles.hero}>
          <div className={styles.eyebrow}>Admin Portal</div>
          <h1 className={styles.title}>Asset Management</h1>
          <p className={styles.copy}>
            Manage emoji assets and profile picture inventories synced from S3. New uploads are written to the bucket and tracked in the database catalog.
          </p>
        </section>

        <StatusMessage error={error} success={success} />
        {isLoading && !bundle ? <div className={styles.empty}>Loading asset catalog…</div> : null}

        {bundle ? (
          <>
            <AssetSection title="Emojis" note="Files sync from `emojis/` and use the `64_*.jpg` naming pattern.">
              <form onSubmit={(event) => void handleCreateEmoji(event)}>
                <div className={styles.createRow}>
                  <div className={styles.formGrid}>
                    <div className={styles.field}>
                      <label htmlFor="emoji-name">Name</label>
                      <input id="emoji-name" className={styles.input} value={emojiName} onChange={(event) => setEmojiName(event.target.value)} />
                    </div>
                    <div className={styles.field}>
                      <label htmlFor="emoji-file">Image</label>
                      <input id="emoji-file" className={styles.fileInput} type="file" accept="image/*" onChange={(event) => setEmojiFile(event.target.files?.[0] || null)} />
                    </div>
                  </div>
                  <div className={styles.createAction}>
                    <button type="submit" className={styles.primaryButton} disabled={emojiBusy}>
                      {emojiBusy ? "Uploading…" : "Create Emoji"}
                    </button>
                  </div>
                </div>
              </form>

              {bundle.emojis.length ? (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Preview</th>
                        <th>Name</th>
                        <th>Deleted</th>
                        <th>Status</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bundle.emojis.map((item) => (
                        <EmojiRow
                          key={item.id}
                          item={item}
                          onUpdated={(next) =>
                            setBundle((current) =>
                              current
                                ? {
                                    ...current,
                                    emojis: current.emojis.map((entry) => (entry.id === next.id ? next : entry)),
                                  }
                                : current
                            )
                          }
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className={styles.empty}>No emojis are cataloged yet.</div>
              )}
            </AssetSection>

            <AssetSection title="Profile Pictures" note="Files sync from `profile-pictures/large` and `profile-pictures/small`.">
              <form onSubmit={(event) => void handleCreateProfilePicture(event)}>
                <div className={styles.createRow}>
                  <div className={styles.formGrid}>
                    <div className={styles.field}>
                      <label htmlFor="profile-name">Name</label>
                      <input id="profile-name" className={styles.input} value={profileName} onChange={(event) => setProfileName(event.target.value)} />
                    </div>
                    <div className={styles.field}>
                      <label htmlFor="profile-large">Large image</label>
                      <input id="profile-large" className={styles.fileInput} type="file" accept="image/*" onChange={(event) => setProfileLargeFile(event.target.files?.[0] || null)} />
                    </div>
                    <div className={styles.field}>
                      <label htmlFor="profile-small">Small image</label>
                      <input id="profile-small" className={styles.fileInput} type="file" accept="image/*" onChange={(event) => setProfileSmallFile(event.target.files?.[0] || null)} />
                    </div>
                  </div>
                  <div className={styles.createAction}>
                    <button type="submit" className={styles.primaryButton} disabled={profileBusy}>
                      {profileBusy ? "Uploading…" : "Create Profile Picture"}
                    </button>
                  </div>
                </div>
              </form>

              {bundle.profile_pictures.length ? (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Large</th>
                        <th>Small</th>
                        <th>Name</th>
                        <th>Deleted</th>
                        <th>Status</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bundle.profile_pictures.map((item) => (
                        <ProfilePictureRow
                          key={item.id}
                          item={item}
                          onUpdated={(next) =>
                            setBundle((current) =>
                              current
                                ? {
                                    ...current,
                                    profile_pictures: current.profile_pictures.map((entry) => (entry.id === next.id ? next : entry)),
                                  }
                                : current
                            )
                          }
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className={styles.empty}>No profile pictures are cataloged yet.</div>
              )}
            </AssetSection>
          </>
        ) : null}
      </div>
    </SiteShell>
  );
}
