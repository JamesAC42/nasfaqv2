import time
import json
import re
import sys
import argparse
import random
import hashlib

try:
    from bs4 import BeautifulSoup  # type: ignore
except ModuleNotFoundError as e:
    raise ModuleNotFoundError(
        "Missing dependency 'beautifulsoup4'. Install with:\n"
        "  python -m pip install -r brokerbot/training/requirements.txt"
    ) from e

# Prefer curl_cffi (better CF resistance), but fall back to plain requests if not installed.
try:
    from curl_cffi import requests as http_requests  # type: ignore
    _HAS_IMPERSONATE = True
except Exception:
    import requests as http_requests  # type: ignore
    _HAS_IMPERSONATE = False

# --- CONFIGURATION ---
TEST_MODE = False  # <--- Set to FALSE when you are ready to let it run all night
DEFAULT_TEST_THREAD_ID = "108315156"

OUTPUT_FILE = "vt_training_data_new.jsonl"
BROWSER_VERSION = "chrome110"
BASE_URL = "https://warosu.org"
START_URL = "https://warosu.org/vt/?task=search2&ghost=false&search_op=op&search_del=dontcare&search_int=dontcare&search_ord=new&search_capcode=all&search_res=post"

# --- DATA QUALITY TUNING ---
# Build training examples from leaf-node reply chains:
#   We walk from a "leaf" post (no replies) backwards via quote-links to form a history.
#   This greatly reduces redundant "sliding window" subsets.
MAX_CONTEXT_DEPTH = 6               # How many ancestors to include (walking up quotes)
MIN_CONTEXT_CHARS = 40              # Skip examples with tiny context
MIN_RESPONSE_CHARS = 20             # Skip examples with tiny replies
MAX_CONTEXT_CHARS = 2400            # Hard cap context size to keep samples reasonable
MAX_RESPONSE_CHARS = 1200           # Hard cap response size (very long copypastas can dominate)
END_WITH_GPT = True                 # Back-compat: used by older conversation formatter (not the leaf-chain builder)

# System prompt included at the start of every conversation (chat format).
SYSTEM_PROMPT = "You are a toxic /vt/ user."

# Diversity filtering: within a single thread, cap how many conversations can start
# with the same first user message content.
MAX_CHAINS_PER_FIRST_USER = 2

# --- UTILS ---
def get_html(url):
    try:
        # Only print in production mode to avoid cluttering test output
        if not TEST_MODE: print(f"   --> Fetching: {url}...")

        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36",
        }
        if _HAS_IMPERSONATE:
            response = http_requests.get(
                url,
                impersonate=BROWSER_VERSION,
                headers=headers,
                timeout=15,
            )
        else:
            response = http_requests.get(
                url,
                headers=headers,
                timeout=15,
            )
        if response.status_code == 200:
            return response.content
        elif response.status_code == 403:
            print("Blocked (403). Waiting 60s...")
            time.sleep(60)
        else:
            print(f"HTTP Error {response.status_code}")
    except Exception as e:
        print(f"Exception: {e}")
    return None

def get_soup(url):
    html = get_html(url)
    if not html:
        return None
    return BeautifulSoup(html, "html.parser")

_QUOTE_ID_RE = re.compile(r"(\d{5,})")
_POST_NODE_ID_RE = re.compile(r"^p(\d{5,})$")

def _extract_quote_ids(html_element):
    """
    Extract in-thread quote target post IDs referenced by '>>123' links.
    Returns list[str] in the order they appear.
    """
    if not html_element:
        return []
    ids = []
    for a in html_element.find_all("a"):
        href = (a.get("href") or "").strip()
        txt = ((a.get_text() or "")).strip()

        # Common on warosu thread pages: <a class=backlink href=#p123>>>123</a>
        if href.startswith("#p"):
            m = _QUOTE_ID_RE.search(href)
            if m:
                ids.append(m.group(1))
                continue

        # Other formats: visible text contains >>123 or >>>123
        if txt.startswith(">>"):
            m = _QUOTE_ID_RE.search(txt)
            if m:
                ids.append(m.group(1))
    return ids

def _normalize_text_keep_lines(text: str) -> str:
    # Preserve line breaks (greentext, formatting), but normalize whitespace.
    # 1) Normalize line endings + collapse excessive blank lines
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = [ln.strip() for ln in text.split("\n")]
    lines = [ln for ln in lines if ln]  # drop empty lines
    text = "\n".join(lines)
    # 2) Remove raw quote markers that might remain
    text = re.sub(r">>\d+", "", text)
    # 3) Remove URLs (optional; helps generalization, avoids leakage)
    text = re.sub(r"http\S+", "", text)
    # 4) Cleanup stray spaces created by removals
    text = re.sub(r"[ \t]+", " ", text).strip()
    return text

def clean_post_text(blockquote_element):
    """
    Extract readable text from a post message, removing quote links but keeping the post body.
    """
    if not blockquote_element:
        return ""
    # Remove quoted links from the rendered text (we keep quote IDs separately)
    for a in blockquote_element.find_all("a"):
        href = (a.get("href") or "").strip()
        cls = a.get("class") or []
        if "quotelink" in cls or "backlink" in cls or href.startswith("#p"):
            a.decompose()
    text = blockquote_element.get_text(separator="\n")
    return _normalize_text_keep_lines(text)

def _parse_post_id(post_table):
    """
    Warosu typically renders posts as <table class="post" id="p108...">.
    Returns numeric string post id or None.
    """
    if not post_table:
        return None
    raw = post_table.get("id") or ""
    # Common: id="p108258576"
    m = _QUOTE_ID_RE.search(raw)
    if m:
        return m.group(1)
    # Fallback: look for anchors like <a name="108...">
    a = post_table.find("a", attrs={"name": True})
    if a:
        m2 = _QUOTE_ID_RE.search(a.get("name", ""))
        if m2:
            return m2.group(1)
    return None

def extract_thread_posts(soup):
    """
    Returns dict[post_id] = {"id": str, "text": str, "quote_ids": list[str]}
    """
    posts = {}
    if not soup:
        return posts

    # Primary: warosu thread pages typically use elements like <div class=comment id=p123> or
    # <td class="comment reply" id=p123>.
    for node in soup.find_all(attrs={"id": _POST_NODE_ID_RE}):
        raw_id = node.get("id") or ""
        m = _POST_NODE_ID_RE.match(raw_id)
        if not m:
            continue
        pid = m.group(1)
        block = node.find("blockquote")
        if not block:
            continue
        quote_ids = _extract_quote_ids(block)
        text = clean_post_text(block)
        if text:
            posts[pid] = {"id": pid, "text": text, "quote_ids": quote_ids}

    # Secondary: older/alternate markup that uses <table class="post" id="p123">
    if not posts:
        for tbl in soup.find_all("table", class_="post"):
            pid = _parse_post_id(tbl)
            if not pid:
                continue
            block = tbl.find("blockquote")
            quote_ids = _extract_quote_ids(block)
            text = clean_post_text(block)
            if text:
                posts[pid] = {"id": pid, "text": text, "quote_ids": quote_ids}
    return posts

def extract_thread_posts_fallback(soup):
    """
    Fallback parsing when the markup isn't using `table.post`.
    We locate `blockquote` nodes and try to infer post id from nearby/parent anchors.
    """
    posts = {}
    if not soup:
        return posts

    for block in soup.find_all("blockquote"):
        # Find some identifier in the ancestors (id="p123") or nearby anchor name="123"
        pid = None
        node = block
        for _ in range(8):
            node = node.parent
            if not node:
                break
            raw_id = node.get("id") if hasattr(node, "get") else None
            if raw_id:
                m = _QUOTE_ID_RE.search(raw_id)
                if m:
                    pid = m.group(1)
                    break
            a = node.find("a", attrs={"name": True}) if hasattr(node, "find") else None
            if a and a.get("name"):
                m2 = _QUOTE_ID_RE.search(a.get("name", ""))
                if m2:
                    pid = m2.group(1)
                    break

        if not pid:
            continue
        quote_ids = _extract_quote_ids(block)
        text = clean_post_text(block)
        if text:
            posts[pid] = {"id": pid, "text": text, "quote_ids": quote_ids}

    return posts

def _build_ancestor_chain(parent_id, posts_by_id, max_depth):
    """
    Walk "up" a quote chain by repeatedly following the FIRST quoted id of each ancestor.
    Returns list[str] of post IDs from oldest -> ... -> parent_id (inclusive).
    """
    chain = []
    cur = parent_id
    seen = set()
    while cur and cur in posts_by_id and cur not in seen and len(chain) < max_depth:
        seen.add(cur)
        chain.append(cur)
        q = posts_by_id[cur].get("quote_ids") or []
        # Follow first in-thread quote (best-effort for conversational lineage)
        nxt = None
        for qid in q:
            if qid in posts_by_id:
                nxt = qid
                break
        cur = nxt
    chain.reverse()
    return chain

def _choose_parent_id(post, posts_by_id):
    """
    Best-effort: pick a single "parent" for history traversal.
    Uses the first in-thread quote id that exists in this thread.
    """
    if not post:
        return None
    for qid in (post.get("quote_ids") or []):
        if qid in posts_by_id:
            return qid
    return None

def _compute_replies_index(posts_by_id):
    """
    Returns dict[parent_id] = set(child_id) where child quoted parent anywhere in its quote_ids.
    """
    replies = {}
    for child_id, post in posts_by_id.items():
        for qid in (post.get("quote_ids") or []):
            if qid in posts_by_id:
                replies.setdefault(qid, set()).add(child_id)
    return replies

def _build_history_chain_from_leaf(leaf_id, posts_by_id, max_depth):
    """
    Build history by walking parent links (via first in-thread quote) until no parent.
    Returns list[str] of post IDs from oldest -> ... -> leaf_id (inclusive).
    """
    chain = []
    cur = leaf_id
    seen = set()
    while cur and cur in posts_by_id and cur not in seen and len(chain) < max_depth:
        seen.add(cur)
        chain.append(cur)
        parent = _choose_parent_id(posts_by_id[cur], posts_by_id)
        cur = parent
    chain.reverse()
    return chain

def _trim_chain_ids_to_char_budget(chain_ids, posts_by_id, max_total_chars):
    """
    Trim from the OLDEST end until total chars <= budget.
    This preserves the "user/assistant" alternation starting at index 0 after formatting.
    """
    if not chain_ids:
        return chain_ids
    total = sum(len((posts_by_id[pid].get("text") or "")) for pid in chain_ids if pid in posts_by_id)
    if total <= max_total_chars:
        return chain_ids
    trimmed = list(chain_ids)
    while len(trimmed) > 2 and total > max_total_chars:
        removed_id = trimmed.pop(0)
        total -= len((posts_by_id.get(removed_id, {}).get("text") or ""))
    return trimmed

def _stable_thread_rng_seed(thread_url: str) -> int:
    """
    Create a stable RNG seed from the thread URL, so "random" selection is
    reproducible across runs.
    """
    h = hashlib.sha256((thread_url or "").encode("utf-8")).hexdigest()
    # Use lower 64 bits to fit comfortably in Python int RNG seeding.
    return int(h[-16:], 16)

def dedupe_samples_by_messages(samples):
    """
    Drop exact-duplicate samples where the full `messages` payload is identical.
    This can happen when distinct post IDs produce identical text-only chains.
    """
    if not samples:
        return samples
    seen = set()
    out = []
    for s in samples:
        msgs = s.get("messages") or []
        # Canonicalize with sorted keys to make stable fingerprints.
        fp = json.dumps(msgs, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        if fp in seen:
            continue
        seen.add(fp)
        out.append(s)
    return out

def diversity_filter_by_first_user_message(samples, thread_url, max_per_first_user=MAX_CHAINS_PER_FIRST_USER):
    """
    Group samples by the exact first user message content, then keep at most
    `max_per_first_user` samples per group (randomly selected).
    """
    if not samples or max_per_first_user is None or max_per_first_user <= 0:
        return []

    rng = random.Random(_stable_thread_rng_seed(thread_url))

    buckets = {}
    for s in samples:
        msgs = s.get("messages") or []
        # Expect: [system, user, assistant, ...]
        if len(msgs) < 2 or msgs[1].get("role") != "user":
            continue
        key = msgs[1].get("content") or ""
        buckets.setdefault(key, []).append(s)

    filtered = []
    for _, group in buckets.items():
        if len(group) <= max_per_first_user:
            filtered.extend(group)
        else:
            filtered.extend(rng.sample(group, max_per_first_user))
    return filtered

def build_leaf_chain_samples(thread_url, posts_by_id):
    """
    Build training samples from LEAF nodes only:
      - Leaf = post that no other post in-thread quotes (anywhere in quote_ids).
      - History = walk backwards via first in-thread quote to build a single lineage.

    Output format:
      {"messages": [{"role":"system","content":...}, {"role":"user"/"assistant","content":...}, ...]}

    Ensures last role is always "assistant" (drops trailing "user" if needed).
    """
    samples = []
    if not posts_by_id:
        return samples

    replies_index = _compute_replies_index(posts_by_id)
    leaf_ids = [pid for pid in posts_by_id.keys() if pid not in replies_index]

    for leaf_id in leaf_ids:
        leaf_text = (posts_by_id[leaf_id].get("text") or "").strip()
        if len(leaf_text) < MIN_RESPONSE_CHARS:
            continue

        chain_ids = _build_history_chain_from_leaf(leaf_id, posts_by_id, MAX_CONTEXT_DEPTH + 1)
        if not chain_ids or len(chain_ids) < 2:
            # Need at least a back-and-forth after system prompt.
            continue

        # Keep within a rough total budget.
        chain_ids = _trim_chain_ids_to_char_budget(chain_ids, posts_by_id, MAX_CONTEXT_CHARS + MAX_RESPONSE_CHARS)
        if len(chain_ids) < 2:
            continue

        messages = [{"role": "system", "content": SYSTEM_PROMPT}]
        for i, pid in enumerate(chain_ids):
            role = "user" if i % 2 == 0 else "assistant"
            content = (posts_by_id[pid].get("text") or "").strip()
            messages.append({"role": role, "content": content})

        # Ensure the last message is always assistant (per pseudocode).
        if messages and messages[-1]["role"] == "user":
            messages.pop()

        # Ensure at least one exchange: system + user + assistant
        if len(messages) < 3:
            continue

        # Apply response cap to the final assistant message (best-effort).
        if len(messages[-1]["content"]) > MAX_RESPONSE_CHARS:
            messages[-1]["content"] = messages[-1]["content"][:MAX_RESPONSE_CHARS].rstrip()

        # Enforce minimum context chars across non-system messages excluding the last assistant.
        context_chars = sum(len(m.get("content", "")) for m in messages[1:-1])
        if context_chars < MIN_CONTEXT_CHARS:
            continue

        samples.append({"messages": messages})

    # Exact dedupe first (prevents wasting diversity budget on identical samples).
    samples = dedupe_samples_by_messages(samples)

    # Diversity filtering: prevent any single first-user prompt from dominating a thread.
    samples = diversity_filter_by_first_user_message(samples, thread_url, MAX_CHAINS_PER_FIRST_USER)

    # Safety: dedupe again in case random selection still results in duplicates.
    return dedupe_samples_by_messages(samples)

def parse_thread(thread_url):
    html = get_html(thread_url)
    if not html:
        return None

    soup = BeautifulSoup(html, "html.parser")
    if not soup:
        return None

    posts_by_id = extract_thread_posts(soup)
    if not posts_by_id:
        posts_by_id = extract_thread_posts_fallback(soup)
    if not posts_by_id:
        # In test mode, dump raw HTML to inspect Cloudflare or markup changes.
        if TEST_MODE:
            m = re.search(r"/thread/(\d+)", thread_url)
            tid = m.group(1) if m else "unknown"
            dump_path = f"debug_dump_thread_{tid}.html"
            try:
                with open(dump_path, "wb") as f:
                    f.write(html)
                title = soup.title.string.strip() if soup.title and soup.title.string else "(no title)"
                print(f"Wrote debug HTML to: {dump_path} (title: {title})")
            except Exception as e:
                print(f"Failed to write debug HTML: {e}")
        return None
    return build_leaf_chain_samples(thread_url, posts_by_id)

def _parse_args():
    p = argparse.ArgumentParser(description="Scrape warosu /vt threads into JSONL training data.")
    p.add_argument("--test", action="store_true", help="Run in test mode (single thread, write output for inspection).")
    p.add_argument("--thread", type=str, default=None, help="Thread ID (numeric) to scrape in test mode.")
    p.add_argument("--out", type=str, default=None, help="Override output file path.")
    p.add_argument("--max-depth", type=int, default=MAX_CONTEXT_DEPTH, help="Max ancestor depth to include in context.")
    p.add_argument("--min-context-chars", type=int, default=MIN_CONTEXT_CHARS, help="Minimum context length (chars).")
    p.add_argument("--min-response-chars", type=int, default=MIN_RESPONSE_CHARS, help="Minimum response length (chars).")
    p.add_argument("--end-with-gpt", action="store_true", default=END_WITH_GPT, help="Choose starting role so the final message is 'gpt'.")
    p.add_argument("--no-end-with-gpt", action="store_false", dest="end_with_gpt", help="Don't force the final message to be 'gpt'.")
    return p.parse_args()

# --- MAIN ---
def main():
    args = _parse_args()

    # Allow CLI overrides for tuning without editing the file.
    global MAX_CONTEXT_DEPTH, MIN_CONTEXT_CHARS, MIN_RESPONSE_CHARS, END_WITH_GPT
    MAX_CONTEXT_DEPTH = args.max_depth
    MIN_CONTEXT_CHARS = args.min_context_chars
    MIN_RESPONSE_CHARS = args.min_response_chars
    END_WITH_GPT = args.end_with_gpt

    # CLI can force test-mode even if TEST_MODE constant is False.
    effective_test_mode = TEST_MODE or args.test

    if effective_test_mode:
        thread_id = args.thread or (sys.argv[1] if len(sys.argv) > 1 and sys.argv[1].isdigit() else DEFAULT_TEST_THREAD_ID)
        thread_url = f"{BASE_URL}/vt/thread/{thread_id}"
        out_path = args.out or f"vt_training_data_test_{thread_id}.jsonl"

        print("\n--- RUNNING IN TEST MODE ---")
        print(f"Targeting thread: {thread_id}")
        print(f"URL: {thread_url}")
        print(f"Writing output to: {out_path}\n")

        # Always capture raw HTML for debugging in test mode.
        html = get_html(thread_url)
        if html:
            try:
                with open(f"debug_dump_thread_{thread_id}.html", "wb") as f:
                    f.write(html)
            except Exception as e:
                print(f"Failed to write debug HTML: {e}")

        soup = BeautifulSoup(html, "html.parser") if html else None
        title = soup.title.string.strip() if soup and soup.title and soup.title.string else "(no title)"

        posts_by_id = extract_thread_posts(soup) if soup else {}
        if not posts_by_id and soup:
            posts_by_id = extract_thread_posts_fallback(soup)

        if not posts_by_id:
            print(f"No posts parsed. Page title: {title}")
            print(f"Wrote raw HTML to: debug_dump_thread_{thread_id}.html")
            return

        data = build_leaf_chain_samples(thread_url, posts_by_id)
        print(f"Parsed {len(posts_by_id)} posts. Built {len(data)} examples.")
        if not data:
            print("Zero examples after filtering. Try lowering thresholds, e.g.:")
            print(f"  python brokerbot/training/scraper.py --test --thread {thread_id} --min-context-chars 20 --min-response-chars 10")
            print(f"Wrote raw HTML to: debug_dump_thread_{thread_id}.html")
            return

        with open(out_path, "w", encoding="utf-8") as f:
            for entry in data:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")

        print(f"SUCCESS: Wrote {len(data)} leaf-chain examples.")
        print("First 3 examples preview:\n")
        for i, entry in enumerate(data[:3]):
            msgs = entry["messages"]
            print(f"--- Example {i+1} ---")
            print(f"SYSTEM:\n{msgs[0]['content']}\n")
            # Best-effort preview: show first user + first assistant if present.
            first_user = next((m for m in msgs[1:] if m["role"] == "user"), None)
            first_asst = next((m for m in msgs[1:] if m["role"] == "assistant"), None)
            if first_user:
                print(f"USER:\n{first_user['content'][:400]}{'...' if len(first_user['content']) > 400 else ''}\n")
            if first_asst:
                print(f"ASSISTANT:\n{first_asst['content'][:400]}{'...' if len(first_asst['content']) > 400 else ''}\n")

        print("Open the JSONL output and sanity-check the contexts/responses before running production.")
        return

    # --- PRODUCTION RUN ---
    with open(OUTPUT_FILE, "a", encoding="utf-8") as f:
        offset = 0
        while True:
            print(f"Index Page Offset: {offset}")
            search_url = f"{START_URL}&offset={offset}"
            soup = get_soup(search_url)
            
            if not soup: break
            
            thread_links = set()
            # Find links that contain '/thread/'
            for a in soup.find_all('a', href=True):
                href = a['href']
                if "/vt/thread/" in href:
                    # Handle relative URLs if necessary
                    full_link = BASE_URL + href if href.startswith("/") else href
                    thread_links.add(full_link)
            
            if not thread_links:
                print("No more threads found on index.")
                break
                
            print(f"Found {len(thread_links)} threads. Scraping...")
            
            for t_url in thread_links:
                data = parse_thread(t_url)
                if data:
                    for entry in data:
                        f.write(json.dumps(entry, ensure_ascii=False) + "\n")
                    f.flush()
                time.sleep(1.5) 
            
            offset += 24
            time.sleep(3) 

if __name__ == "__main__":
    main()