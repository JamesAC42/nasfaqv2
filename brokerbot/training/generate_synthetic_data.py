import os
import json
import time
import random
import argparse
from typing import Any, Dict, Iterable, List, Optional

try:
    from openai import OpenAI
    from openai import RateLimitError, APIError, APITimeoutError, APIConnectionError, BadRequestError
except ModuleNotFoundError as e:
    raise ModuleNotFoundError(
        "Missing dependency 'openai'. Install with:\n"
        "  python -m pip install -r brokerbot/training/requirements.txt"
    ) from e


TRADE_ROASTER_SYSTEM = "You are an anonymous poster on /vt/. Your goal is to insult a user's stock trade."

ROAST_STYLE = """\
CRITICAL STYLE RULES:
1. **NO "Oof", "Yikes", "Oh look", "Translation:", or "Cute".** BANNED.
2. **NO capital letters at the start of sentences.** (Optional but adds flavor).
3. **MAXIMUM 20 words.** If it's longer, delete it.
4. **Use Greentext format (`>`)** for at least 50% of the lines.
5. Do not explain the insult. Just say it.

BAD Output:
"Oof. Closed a losing swing to free capital? Translation: you paper-handed." (Too Reddit)

GOOD Output:
">selling the bottom to 'free capital'"
"bagholder coping mechanism. ngmi."
">he fell for the reversal meme again"
"just post the loss porn and leave"
"paper hands. you don't deserve those shares."
"""

NEWS_TICKER_SYSTEM = "You are a NASFAQ news bot. Summarize the thread into a cynical headline."

NEWS_STYLE = (
    "Style: cynical, meme-y, /biz/ + /vt/ energy. Use slang like ngmi, bagholder, paper hands, diamond hands, "
    "gem, coal, exit liquidity, cope, seethe. Keep it short.\n"
)

def log(msg: str) -> None:
    ts = time.strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def _load_env_file(path: str) -> Dict[str, str]:
    """
    Minimal .env loader (no external dependency).
    Supports:
      OPENAI_API_KEY=sk-...
      export OPENAI_API_KEY=sk-...
    Ignores blank lines and comments (# ...).
    """
    if not os.path.exists(path):
        return {}
    out: Dict[str, str] = {}
    with open(path, "r", encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            if line.lower().startswith("export "):
                line = line[7:].strip()
            if "=" not in line:
                continue
            k, v = line.split("=", 1)
            k = k.strip()
            v = v.strip().strip('"').strip("'")
            if k:
                out[k] = v
    return out


def get_openai_api_key(explicit: Optional[str] = None) -> str:
    """
    Resolve API key from, in order:
      - explicit arg
      - OPENAI_API_KEY env var
      - .env in current working directory
      - .env next to this script
    """
    if explicit:
        return explicit.strip()

    api_key = os.getenv("OPENAI_API_KEY")
    if api_key:
        return api_key.strip()

    cwd_env = _load_env_file(os.path.join(os.getcwd(), ".env"))
    if cwd_env.get("OPENAI_API_KEY"):
        return cwd_env["OPENAI_API_KEY"].strip()

    script_dir = os.path.dirname(os.path.abspath(__file__))
    script_env = _load_env_file(os.path.join(script_dir, ".env"))
    if script_env.get("OPENAI_API_KEY"):
        return script_env["OPENAI_API_KEY"].strip()

    raise RuntimeError(
        "OPENAI_API_KEY is not set.\n"
        "Windows PowerShell (current session):\n"
        "  $env:OPENAI_API_KEY = \"sk-...\"\n"
        "Or after setx, open a NEW terminal (setx doesn't affect the current one).\n"
        "Or put OPENAI_API_KEY=sk-... in a .env in the working directory or next to this script."
    )


def iter_jsonl(path: str) -> Iterable[Dict[str, Any]]:
    with open(path, "r", encoding="utf-8") as f:
        for line_no, line in enumerate(f, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError as e:
                raise ValueError(f"Invalid JSON on line {line_no} in {path}: {e}") from e
            if not isinstance(obj, dict):
                raise ValueError(f"Expected JSON object on line {line_no} in {path}, got {type(obj)}")
            yield obj


def extract_user_texts_from_jsonl(path: str) -> List[str]:
    """
    Extract candidate "context" strings from either:
      - Llama-3-ish: {"messages":[{"role":"user","content":"..."}...]}
      - ShareGPT-ish: {"conversations":[{"from":"human","value":"..."}...]}
    """
    texts: List[str] = []
    for obj in iter_jsonl(path):
        if "messages" in obj and isinstance(obj["messages"], list):
            for m in obj["messages"]:
                if isinstance(m, dict) and m.get("role") == "user" and isinstance(m.get("content"), str):
                    t = m["content"].strip()
                    if t:
                        texts.append(t)
        elif "conversations" in obj and isinstance(obj["conversations"], list):
            for m in obj["conversations"]:
                if isinstance(m, dict) and m.get("from") == "human" and isinstance(m.get("value"), str):
                    t = m["value"].strip()
                    if t:
                        texts.append(t)
    if not texts:
        raise ValueError(f"No user texts found in {path}. Expected 'messages' or 'conversations' format.")
    return texts


def _sleep_backoff(attempt: int) -> None:
    # Exponential-ish backoff with jitter; attempt starts at 0.
    base = min(60.0, (2.0 ** attempt))
    time.sleep(base + random.random())

def _messages_to_input_text(messages: List[Dict[str, str]]) -> str:
    """
    Convert chat-style messages into a single Responses API text input.
    This avoids model-specific chat schema differences while preserving roles.
    """
    parts: List[str] = []
    for m in messages:
        role = (m.get("role") or "").strip().lower()
        content = (m.get("content") or "").strip()
        if not role or not content:
            continue
        parts.append(f"{role.upper()}:\n{content}\n")
    parts.append("ASSISTANT:\n")
    return "\n".join(parts)

def _messages_to_responses_input(messages: List[Dict[str, str]]) -> List[Dict[str, Any]]:
    """
    Build a Responses API input array using input_text blocks.
    This is the most reliable format across newer models.
    """
    items: List[Dict[str, Any]] = []
    for m in messages:
        role = (m.get("role") or "").strip().lower()
        content = (m.get("content") or "").strip()
        if role not in ("system", "user", "assistant") or not content:
            continue
        items.append(
            {
                "role": role,
                "content": [{"type": "input_text", "text": content}],
            }
        )
    return items


def _extract_response_text(resp: Any) -> str:
    # Fast path (SDK convenience)
    t = getattr(resp, "output_text", None)
    if isinstance(t, str) and t.strip():
        return t.strip()

    # Fallback: traverse resp.output[*].content[*]
    output = getattr(resp, "output", None)
    if isinstance(output, list):
        chunks: List[str] = []
        for item in output:
            # SDK may return typed objects; support both dict + objects.
            item_type = item.get("type") if isinstance(item, dict) else getattr(item, "type", None)
            if item_type != "message":
                continue
            content = item.get("content") if isinstance(item, dict) else getattr(item, "content", None)
            if not isinstance(content, list):
                continue
            for c in content:
                c_type = c.get("type") if isinstance(c, dict) else getattr(c, "type", None)
                c_text = c.get("text") if isinstance(c, dict) else getattr(c, "text", None)
                if c_type in ("output_text", "text") and isinstance(c_text, str):
                    chunks.append(c_text)
        joined = "".join(chunks).strip()
        if joined:
            return joined

    return ""

def _response_is_reasoning_only(resp: Any) -> bool:
    output = getattr(resp, "output", None)
    if not isinstance(output, list) or not output:
        return False
    for item in output:
        item_type = item.get("type") if isinstance(item, dict) else getattr(item, "type", None)
        if item_type != "reasoning":
            return False
    return True

def _messages_to_plain_prompt(messages: List[Dict[str, str]]) -> str:
    """
    Ultra-compatible prompt string for Responses API.
    Some GPT-5 deployments occasionally return reasoning items without a message when using
    instructions/input splitting; this fallback tends to force a normal assistant message.
    """
    sys_parts: List[str] = []
    other_parts: List[str] = []
    for m in messages:
        role = (m.get("role") or "").strip().lower()
        content = (m.get("content") or "").strip()
        if not content:
            continue
        if role == "system":
            sys_parts.append(content)
        elif role == "user":
            other_parts.append(f"User: {content}")
        elif role == "assistant":
            other_parts.append(f"Assistant: {content}")
    prompt = ""
    if sys_parts:
        prompt += "System: " + " ".join(sys_parts) + "\n"
    prompt += "\n".join(other_parts).strip()
    if prompt:
        prompt += "\n"
    prompt += "Assistant:"
    return prompt

def _messages_to_instructions_and_input(messages: List[Dict[str, str]]) -> Dict[str, str]:
    """
    Responses API supports a dedicated `instructions` system message plus a free-form `input`.
    This keeps us aligned with the docs and avoids role-schema edge cases.
    """
    instructions_parts: List[str] = []
    input_parts: List[str] = []
    for m in messages:
        role = (m.get("role") or "").strip().lower()
        content = (m.get("content") or "").strip()
        if not content:
            continue
        if role == "system":
            instructions_parts.append(content)
        elif role in ("user", "assistant"):
            # Preserve a tiny bit of structure if multi-turn ever appears.
            input_parts.append(f"{role.upper()}:\n{content}")
    return {
        "instructions": "\n\n".join(instructions_parts).strip(),
        "input": "\n\n".join(input_parts).strip(),
    }


def chat_with_retries(
    client: OpenAI,
    *,
    model: str,
    messages: List[Dict[str, str]],
    temperature: float,
    max_tokens: int,
    retries: int = 8,
    verbose: bool = False,
) -> str:
    last_err: Optional[Exception] = None
    # Newer models (e.g. GPT-5) may require max_completion_tokens instead of max_tokens,
    # and may reject temperature. We adapt on-the-fly if the API complains.
    token_param = "max_output_tokens"
    use_temperature = True
    use_reasoning_cfg = True

    for attempt in range(retries):
        try:
            if verbose and attempt == 0:
                log(
                    f"OpenAI request -> model={model} ({token_param}={max_tokens}"
                    + (f", temp={temperature})" if use_temperature else ")")
                )

            io = _messages_to_instructions_and_input(messages)
            kwargs: Dict[str, Any] = {
                "model": model,
                "input": io["input"],
                token_param: max_tokens,
                # Ensure we actually get a text message back (docs-style).
                "text": {"format": {"type": "text"}},
            }
            if io["instructions"]:
                kwargs["instructions"] = io["instructions"]
            if use_temperature:
                kwargs["temperature"] = temperature
            # GPT-5 / reasoning models: minimize reasoning so we actually get output text.
            if use_reasoning_cfg:
                kwargs["reasoning"] = {"effort": "minimal"}

            resp = client.responses.create(**kwargs)
            content = _extract_response_text(resp)
            if not content:
                # If the model returned only reasoning items (no assistant message),
                # retry once with the simplest docs-style `input` string prompt.
                if _response_is_reasoning_only(resp):
                    if verbose:
                        status = getattr(resp, "status", None)
                        err = getattr(resp, "error", None)
                        usage = getattr(resp, "usage", None)
                        log(f"Model returned reasoning-only output (status={status}, error={err}, usage={usage}); retrying with plain input prompt...")
                    fallback_kwargs: Dict[str, Any] = {
                        "model": model,
                        "input": _messages_to_plain_prompt(messages),
                        token_param: max_tokens,
                        "text": {"format": {"type": "text"}},
                    }
                    if use_temperature:
                        fallback_kwargs["temperature"] = temperature
                    if use_reasoning_cfg:
                        fallback_kwargs["reasoning"] = {"effort": "minimal"}
                    resp2 = client.responses.create(**fallback_kwargs)
                    content2 = _extract_response_text(resp2)
                    if content2:
                        return content2.strip()
                    if verbose:
                        status2 = getattr(resp2, "status", None)
                        err2 = getattr(resp2, "error", None)
                        usage2 = getattr(resp2, "usage", None)
                        out2 = getattr(resp2, "output", None)
                        log(f"Fallback also produced no text (status={status2}, error={err2}, usage={usage2}); output preview: {str(out2)[:800]}")
                if verbose:
                    out_preview = getattr(resp, "output", None)
                    log(f"Empty completion; response.output preview: {str(out_preview)[:800]}")
                raise ValueError("Empty completion")
            return content.strip()
        except BadRequestError as e:
            # Unsupported param adaptation (no backoff needed; just retry immediately).
            msg = str(e)
            if "Unsupported parameter" in msg and "'max_tokens'" in msg and "max_completion_tokens" in msg:
                token_param = "max_completion_tokens"
                last_err = e
                continue
            if "Unsupported parameter" in msg and "'max_completion_tokens'" in msg and "max_tokens" in msg:
                token_param = "max_tokens"
                last_err = e
                continue
            if "Unsupported parameter" in msg and "'max_output_tokens'" in msg and "max_completion_tokens" in msg:
                token_param = "max_completion_tokens"
                last_err = e
                continue
            if "Unsupported parameter" in msg and "'temperature'" in msg:
                use_temperature = False
                last_err = e
                continue
            if "Unsupported parameter" in msg and "'reasoning'" in msg:
                use_reasoning_cfg = False
                last_err = e
                continue
            last_err = e
            if verbose:
                log(f"OpenAI error ({attempt + 1}/{retries}): {type(e).__name__}: {e}")
            _sleep_backoff(attempt)
        except (RateLimitError, APITimeoutError, APIConnectionError, APIError, ValueError) as e:
            last_err = e
            if verbose:
                log(f"OpenAI error ({attempt + 1}/{retries}): {type(e).__name__}: {e} (backing off)")
            _sleep_backoff(attempt)
    raise RuntimeError(f"OpenAI request failed after {retries} retries: {last_err}") from last_err


def parse_json_from_text(text: str) -> Any:
    """
    Best-effort: accept pure JSON or JSON wrapped in code fences.
    """
    t = text.strip()
    if t.startswith("```"):
        # Strip ```json ... ```
        t = t.strip("`")
        # After stripping backticks, it may still have "json\n{...}"
        if "\n" in t:
            t = t.split("\n", 1)[1]
    t = t.strip()
    return json.loads(t)


def generate_trade_scenarios(
    client: OpenAI,
    *,
    model: str,
    scenario_count: int,
    temperature: float,
    verbose: bool = False,
) -> List[str]:
    prompt = (
        "Generate a diverse list of stock/crypto-style trade scenarios for a meme stock bot.\n"
        f"Return STRICT JSON ONLY: {{\"scenarios\": [ ... ]}}.\n"
        f"Target: {scenario_count} items.\n"
        "Each scenario should read like a user's one-liner describing what they did (past tense).\n"
        "No numbering, no commentary, no extra keys.\n"
        "Examples (do not copy verbatim): \"Bought at ATH\", \"Panic sold the bottom\", \"Leveraged long into earnings\"."
    )

    if verbose:
        log(f"Generating trade scenarios (target={scenario_count})...")
    raw = chat_with_retries(
        client,
        model=model,
        messages=[{"role": "system", "content": "You are a dataset generator."}, {"role": "user", "content": prompt}],
        temperature=temperature,
        max_tokens=900,
        verbose=verbose,
    )
    obj = parse_json_from_text(raw)
    if not isinstance(obj, dict) or "scenarios" not in obj or not isinstance(obj["scenarios"], list):
        raise ValueError("Scenario generation did not return expected JSON object with 'scenarios' list.")

    # Normalize + de-dupe while preserving order
    seen = set()
    scenarios: List[str] = []
    for s in obj["scenarios"]:
        t = str(s).strip()
        if not t:
            continue
        if t in seen:
            continue
        seen.add(t)
        scenarios.append(t)

    if verbose:
        log(f"Scenario batch produced {len(scenarios)} unique items.")
        if len(scenarios) < scenario_count:
            log(
                f"Warning: requested {scenario_count} scenarios but got {len(scenarios)}; proceeding to avoid extra API calls."
            )

    # If we got more than needed, just truncate.
    return scenarios[:scenario_count]


def build_llama3_record(system: str, user: str, assistant: str) -> Dict[str, Any]:
    return {
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
            {"role": "assistant", "content": assistant},
        ]
    }


def write_jsonl(path: str, rows: Iterable[Dict[str, Any]], *, mode: str = "w") -> int:
    n = 0
    with open(path, mode, encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
            n += 1
    return n


def generate_roasts(
    client: OpenAI,
    *,
    model: str,
    out_path: str,
    total: int,
    scenario_count: int,
    temperature: float,
    max_tokens: int,
    seed: Optional[int],
    log_every: int = 10,
    verbose: bool = False,
) -> int:
    rng = random.Random(seed)
    scenarios = generate_trade_scenarios(
        client,
        model=model,
        scenario_count=scenario_count,
        temperature=temperature,
        verbose=verbose,
    )

    reps, rem = divmod(total, len(scenarios))
    if reps == 0:
        reps = 1
        rem = 0

    # Python doesn't allow modifying outer-scope 'rem' inside generator; use a mutable box.
    nonlocal_rem = [rem]
    # Use a wrapper generator that refers to nonlocal_rem[0].
    def gen_rows_fixed() -> Iterable[Dict[str, Any]]:
        order = scenarios[:]
        rng.shuffle(order)
        remaining = total
        done = 0
        t0 = time.time()
        log(f"Roasts: starting ({total} examples) model={model}")
        for s in order:
            k = reps + (1 if nonlocal_rem[0] > 0 else 0)
            if nonlocal_rem[0] > 0:
                nonlocal_rem[0] -= 1
            for _ in range(k):
                if remaining <= 0:
                    dt = time.time() - t0
                    log(f"Roasts: finished ({done}/{total}) in {dt:.1f}s")
                    return
                user_text = f"Trade: {s}"
                sys_text = f"{TRADE_ROASTER_SYSTEM}\n\n{ROAST_STYLE}"
                assistant = chat_with_retries(
                    client,
                    model=model,
                    messages=[
                        {"role": "system", "content": sys_text},
                        {"role": "user", "content": user_text},
                    ],
                    temperature=temperature,
                    max_tokens=max_tokens,
                    verbose=verbose,
                )
                yield build_llama3_record(TRADE_ROASTER_SYSTEM, user_text, assistant)
                remaining -= 1
                done += 1
                if log_every > 0 and (done % log_every == 0 or done == total):
                    dt = time.time() - t0
                    rps = done / dt if dt > 0 else 0.0
                    log(f"Roasts: {done}/{total} done ({rps:.2f} req/s)")

    return write_jsonl(out_path, gen_rows_fixed(), mode="w")


def generate_news(
    client: OpenAI,
    *,
    model: str,
    raw_input_path: str,
    out_path: str,
    total: int,
    temperature: float,
    max_tokens: int,
    seed: Optional[int],
    log_every: int = 10,
    verbose: bool = False,
) -> int:
    rng = random.Random(seed)
    contexts = extract_user_texts_from_jsonl(raw_input_path)
    log(f"News: loaded {len(contexts)} context snippets from {raw_input_path}")

    def gen_rows() -> Iterable[Dict[str, Any]]:
        done = 0
        t0 = time.time()
        log(f"News: starting ({total} examples) model={model}")
        for _ in range(total):
            context = rng.choice(contexts)
            # keep prompts short + stable
            sys_text = f"{NEWS_TICKER_SYSTEM}\n{NEWS_STYLE}\nOutput: a single headline line."
            user_text = f"Thread/context:\n{context}"
            headline = chat_with_retries(
                client,
                model=model,
                messages=[
                    {"role": "system", "content": sys_text},
                    {"role": "user", "content": user_text},
                ],
                temperature=temperature,
                max_tokens=max_tokens,
                verbose=verbose,
            )
            # Make it single-line for ticker feel
            headline = " ".join(headline.splitlines()).strip()
            yield build_llama3_record(NEWS_TICKER_SYSTEM, user_text, headline)
            done += 1
            if log_every > 0 and (done % log_every == 0 or done == total):
                dt = time.time() - t0
                rps = done / dt if dt > 0 else 0.0
                log(f"News: {done}/{total} done ({rps:.2f} req/s)")
        dt = time.time() - t0
        log(f"News: finished ({done}/{total}) in {dt:.1f}s")

    return write_jsonl(out_path, gen_rows(), mode="w")


def main() -> None:
    ap = argparse.ArgumentParser(description="Generate synthetic NASFAQ fine-tune data with OpenAI.")
    ap.add_argument("--mode", choices=["roast", "news", "all"], default="all")
    ap.add_argument("--model", default="gpt-5-mini-2025-08-07")
    ap.add_argument("--seed", type=int, default=1337)
    ap.add_argument("--api-key", default=None, help="Optional: override API key (else uses OPENAI_API_KEY or .env).")
    ap.add_argument("--log-every", type=int, default=10, help="Print progress every N examples (0 disables).")
    ap.add_argument("--verbose", action="store_true", help="More logging (retries/backoff).")

    ap.add_argument("--roast-count", type=int, default=200)
    ap.add_argument("--scenario-count", type=int, default=50)
    ap.add_argument("--out-roasts", default="synthetic_roasts.jsonl")

    ap.add_argument("--news-count", type=int, default=200)
    ap.add_argument("--raw-input", default="raw_chat_data.jsonl")
    ap.add_argument("--out-news", default="synthetic_news.jsonl")

    ap.add_argument("--temperature", type=float, default=0.9)
    ap.add_argument("--max-tokens", type=int, default=140)

    args = ap.parse_args()

    api_key = get_openai_api_key(args.api_key)

    client = OpenAI(api_key=api_key)
    log(f"Using model={args.model}")

    if args.mode in ("roast", "all"):
        n = generate_roasts(
            client,
            model=args.model,
            out_path=args.out_roasts,
            total=args.roast_count,
            scenario_count=args.scenario_count,
            temperature=args.temperature,
            max_tokens=args.max_tokens,
            seed=args.seed,
            log_every=args.log_every,
            verbose=args.verbose,
        )
        print(f"Wrote {n} roast examples -> {args.out_roasts}")

    if args.mode in ("news", "all"):
        n = generate_news(
            client,
            model=args.model,
            raw_input_path=args.raw_input,
            out_path=args.out_news,
            total=args.news_count,
            temperature=args.temperature,
            max_tokens=args.max_tokens,
            seed=args.seed,
            log_every=args.log_every,
            verbose=args.verbose,
        )
        print(f"Wrote {n} news examples -> {args.out_news}")


if __name__ == "__main__":
    main()


