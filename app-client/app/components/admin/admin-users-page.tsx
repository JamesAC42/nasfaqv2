"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  fetchUserDirectory,
  findUsersByEmail,
  type DirectoryFilter,
  type DirectoryQuery,
  type DirectorySort,
  type DirectoryUser,
  type SortDir,
  type UserDirectory,
} from "@/app/components/admin/admin-api";
import { AdminFrame, AdminGate, AdminLoading, useAdminAccess, useNow } from "@/app/components/admin/admin-frame";
import { Notice, adminErrorText, adminUi as ui, ago, fmtCash, fmtCount } from "@/app/components/admin/admin-ui";
import { joined } from "@/app/components/admin/admin-user-actions";
import { PlayerAvatar } from "@/app/components/common/player-avatar";
import styles from "@/app/components/admin/admin-users-page.module.scss";

// /admin/users: every account, searchable and sortable, a page at a time. Everything you can do to
// one is on its page, /admin/users/[userId]. The search, filter and sort live in the URL, so the
// back button and a shared link land in the same place, except an address typed into the search:
// that goes to the API in a POST body and stays out of the URL and out of the analytics.

const SEARCH_DEBOUNCE_MS = 250;

const FILTERS: { key: DirectoryFilter; label: string }[] = [
  { key: "all", label: "Everyone" },
  { key: "unverified", label: "Unverified" },
  { key: "suspended", label: "Suspended" },
  { key: "frozen", label: "Exchange frozen" },
  { key: "staff", label: "Staff" },
  { key: "new", label: "New this week" },
];

const COLUMNS: { key: DirectorySort; label: string; dir: SortDir }[] = [
  { key: "username", label: "Player", dir: "asc" },
  { key: "joined", label: "Joined", dir: "desc" },
  { key: "last_seen", label: "Last seen", dir: "desc" },
  { key: "cash", label: "Cash", dir: "desc" },
  { key: "net_worth", label: "Net worth", dir: "desc" },
];

const DEFAULT_QUERY: DirectoryQuery = { q: "", filter: "all", sort: "joined", dir: "desc", page: 1 };

const isAddress = (q: string) => q.includes("@");

function queryFromUrl(): DirectoryQuery {
  if (typeof window === "undefined") return DEFAULT_QUERY;
  const params = new URLSearchParams(window.location.search);
  const filter = FILTERS.find((entry) => entry.key === params.get("filter"))?.key ?? DEFAULT_QUERY.filter;
  const column = COLUMNS.find((entry) => entry.key === params.get("sort"));
  const dir = params.get("dir");
  return {
    q: params.get("q") ?? "",
    filter,
    sort: column?.key ?? DEFAULT_QUERY.sort,
    dir: dir === "asc" || dir === "desc" ? dir : (column?.dir ?? DEFAULT_QUERY.dir),
    page: Math.max(1, Number.parseInt(params.get("page") ?? "", 10) || 1),
  };
}

function queryToUrl(query: DirectoryQuery) {
  const params = new URLSearchParams();
  if (query.q.trim() && !isAddress(query.q)) params.set("q", query.q.trim());
  if (query.filter !== DEFAULT_QUERY.filter) params.set("filter", query.filter);
  if (query.sort !== DEFAULT_QUERY.sort || query.dir !== DEFAULT_QUERY.dir) {
    params.set("sort", query.sort);
    params.set("dir", query.dir);
  }
  if (query.page > 1) params.set("page", String(query.page));
  const search = params.toString();
  return search ? `?${search}` : window.location.pathname;
}

function StatusPills({ user, selfId }: { user: DirectoryUser; selfId: string | null }) {
  const staff = user.can_manage_assets || user.can_create_prediction_markets || user.can_approve_prediction_markets || user.can_resolve_prediction_markets || user.can_void_prediction_markets;
  return (
    <>
      {selfId === String(user.id) ? <span className={ui.pill} data-tone="blue">You</span> : null}
      {user.is_admin ? <span className={ui.pill} data-tone="warn">Admin</span> : staff ? <span className={ui.pill}>Staff</span> : null}
      {user.suspension ? <span className={ui.pill} data-tone="warn" title={user.suspension.reason ?? undefined}>Suspended</span> : null}
      {user.exchange_frozen_at ? <span className={ui.pill} data-tone="warn" title={user.exchange_frozen_note ?? undefined}>Exchange frozen</span> : null}
      {user.shared_ip_accounts?.length ? <span className={ui.pill} data-tone="warn" title={user.shared_ip_accounts.map((account) => account.username).join(", ")}>Shares an IP</span> : null}
    </>
  );
}

function SortHeader({ column, query, onSort }: { column: (typeof COLUMNS)[number]; query: DirectoryQuery; onSort: (sort: DirectorySort, dir: SortDir) => void }) {
  const active = query.sort === column.key;
  return (
    <th scope="col" data-col={column.key} aria-sort={active ? (query.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => onSort(column.key, active ? (query.dir === "asc" ? "desc" : "asc") : column.dir)}>
        {column.label}
        <span aria-hidden="true">{active ? (query.dir === "asc" ? " ↑" : " ↓") : ""}</span>
      </button>
    </th>
  );
}

function UserRow({ user, now, selfId }: { user: DirectoryUser; now: number; selfId: string | null }) {
  return (
    <tr>
      <td data-col="username">
        <div className={styles.who}>
          <PlayerAvatar username={user.username} pictureUrl={user.profile_picture_url} color={user.profile_color} size={32} />
          <div className={styles.whoText}>
            <p className={styles.name}>
              <Link href={`/admin/users/${user.id}`}>{user.username}</Link>
              <StatusPills user={user} selfId={selfId} />
            </p>
            <p className={styles.email}>
              <span className={styles.id}>#{user.id}</span>
              {user.has_email ? <span>{user.email_masked}</span> : <span className={styles.dim}>no email on file</span>}
              {user.email_verified ? (
                <span className={ui.pill} data-tone="blue">
                  <i aria-hidden="true" />
                  Verified
                </span>
              ) : (
                <span className={ui.pill} data-tone="dim">
                  Unverified
                </span>
              )}
            </p>
          </div>
        </div>
      </td>
      <td data-col="joined">{joined(user.created_at)}</td>
      <td data-col="last_seen">{user.last_seen_at ? `${ago(user.last_seen_at, now)} ago` : "never"}</td>
      <td data-col="cash" className={styles.num}>{fmtCash(user.cash, 2)}</td>
      <td data-col="net_worth" className={styles.num}>{fmtCash(user.net_worth, 2)}</td>
    </tr>
  );
}

export function AdminUsersPage() {
  const access = useAdminAccess();
  const now = useNow(30_000);
  const [query, setQuery] = useState<DirectoryQuery>(queryFromUrl);
  const [data, setData] = useState<UserDirectory | null>(null);
  const [found, setFound] = useState<DirectoryUser[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    if (!access.initialized || !access.isAdmin) return;
    const id = ++requestRef.current;
    const address = isAddress(query.q);
    // An address only goes out once it could be a whole one.
    const complete = address && /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(query.q.trim());
    const timer = setTimeout(
      async () => {
        if (address && !complete) {
          setFound([]);
          return;
        }
        setLoading(true);
        try {
          if (address) {
            const result = await findUsersByEmail(query.q.trim());
            if (id === requestRef.current) setFound(result.users);
          } else {
            const result = await fetchUserDirectory(query);
            if (id !== requestRef.current) return;
            setFound(null);
            setData(result);
            // Someone narrowed the list while on a page past its end.
            if (!result.users.length && result.total && query.page > 1) setQuery((current) => ({ ...current, page: 1 }));
          }
          if (id === requestRef.current) setError(null);
        } catch (caught) {
          if (id === requestRef.current) setError(adminErrorText(caught));
        } finally {
          if (id === requestRef.current) setLoading(false);
        }
      },
      query.q ? SEARCH_DEBOUNCE_MS : 0,
    );
    try {
      window.history.replaceState(null, "", queryToUrl(query));
    } catch {
      /* history blocked */
    }
    return () => clearTimeout(timer);
  }, [access.initialized, access.isAdmin, query]);

  if (!access.initialized) return <AdminLoading title="Users" />;
  if (!access.isAdmin) return <AdminGate title="Users" signedIn={access.signedIn} need="admins" headline="Admins only." />;

  const searching = query.q.trim().length > 0;
  const lookingUpAddress = isAddress(query.q);
  const users = lookingUpAddress ? found : (data?.users ?? null);
  const counts = data?.counts;
  const total = lookingUpAddress ? (found?.length ?? 0) : (data?.total ?? 0);
  const limit = data?.limit ?? 50;
  const firstRow = (query.page - 1) * limit + 1;
  const lastPage = Math.max(1, Math.ceil(total / limit));
  const onSort = (sort: DirectorySort, dir: SortDir) => setQuery((current) => ({ ...current, sort, dir, page: 1 }));

  return (
    <AdminFrame
      title="Users"
      blurb={
        counts ? (
          <>
            <b>{fmtCount(counts.all)}</b> account{counts.all === 1 ? "" : "s"}, <b>{fmtCount(counts.unverified)}</b> unverified. Open one to verify, rename or moderate it.
          </>
        ) : (
          "Every account. Open one to verify, rename or moderate it."
        )
      }
      aside={<Link href="/admin/people" className={ui.btn}>People &amp; roles</Link>}
    >
      <div className={styles.controls}>
        <label className={styles.search}>
          <span className={ui.srOnly}>Find a player</span>
          <input
            type="search"
            className={ui.input}
            placeholder="Username, #id or a whole email address"
            value={query.q}
            onChange={(event) => {
              const q = event.target.value;
              setQuery((current) => ({ ...current, q, page: 1 }));
            }}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <div className={styles.filters} role="radiogroup" aria-label="Filter">
          {FILTERS.map((filter) => (
            <button key={filter.key} type="button" role="radio" aria-checked={query.filter === filter.key} onClick={() => setQuery((current) => ({ ...current, filter: filter.key, page: 1 }))}>
              {filter.label}
              {counts ? <small>{fmtCount(counts[filter.key])}</small> : null}
            </button>
          ))}
        </div>
        {/* Phones don't have room for every column, so the sort gets its own control there. */}
        <label className={styles.sortPicker}>
          <span>Sort</span>
          <select
            className={ui.select}
            value={`${query.sort}:${query.dir}`}
            onChange={(event) => {
              const [sort, dir] = event.target.value.split(":");
              onSort(sort as DirectorySort, dir as SortDir);
            }}
          >
            {COLUMNS.flatMap((column) => [
              <option key={`${column.key}:desc`} value={`${column.key}:desc`}>{`${column.label}, ${column.key === "username" ? "Z to A" : column.key === "joined" || column.key === "last_seen" ? "newest" : "highest"}`}</option>,
              <option key={`${column.key}:asc`} value={`${column.key}:asc`}>{`${column.label}, ${column.key === "username" ? "A to Z" : column.key === "joined" || column.key === "last_seen" ? "oldest" : "lowest"}`}</option>,
            ])}
          </select>
        </label>
      </div>

      {error ? <Notice>{error}</Notice> : null}
      {lookingUpAddress ? <Notice tone="info">Looking up an address takes the whole address. It finds the one account on that inbox, and stays masked here.</Notice> : null}

      <div className={styles.tableWrap} aria-busy={loading || undefined}>
        <table className={styles.table}>
          <caption className={ui.srOnly}>Accounts</caption>
          <thead>
            <tr>
              {COLUMNS.map((column) => (
                <SortHeader key={column.key} column={column} query={query} onSort={onSort} />
              ))}
            </tr>
          </thead>
          <tbody>
            {(users ?? []).map((user) => (
              <UserRow key={user.id} user={user} now={now} selfId={access.userId} />
            ))}
          </tbody>
        </table>
        {users === null ? <p className={ui.empty}>Loading…</p> : null}
        {users?.length === 0 ? <p className={ui.empty}>{searching ? `Nobody matches “${query.q.trim()}”.` : "Nobody in this filter."}</p> : null}
      </div>

      {!lookingUpAddress && data && data.users.length ? (
        <nav className={styles.pager} aria-label="Pages">
          <span>
            {fmtCount(firstRow)}–{fmtCount(firstRow + data.users.length - 1)} of {fmtCount(total)}
          </span>
          <div>
            <button type="button" className={ui.btn} disabled={query.page <= 1} onClick={() => setQuery((current) => ({ ...current, page: current.page - 1 }))}>
              Previous
            </button>
            <button type="button" className={ui.btn} disabled={query.page >= lastPage} onClick={() => setQuery((current) => ({ ...current, page: current.page + 1 }))}>
              Next
            </button>
          </div>
        </nav>
      ) : null}
    </AdminFrame>
  );
}
