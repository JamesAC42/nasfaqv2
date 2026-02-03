import json
import random
import argparse
from typing import Any, Dict, Iterable, List, Tuple


REQUIRED_SYSTEM_PROMPT = "You are a toxic /vt/ user."


def iter_jsonl_lines(path: str) -> Iterable[Tuple[int, str]]:
    with open(path, "r", encoding="utf-8") as f:
        for i, line in enumerate(f, start=1):
            line = line.strip()
            if not line:
                continue
            yield i, line


def load_jsonl_objects(path: str) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for line_no, line in iter_jsonl_lines(path):
        try:
            obj = json.loads(line)
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON on line {line_no} in {path}: {e}") from e
        if not isinstance(obj, dict):
            raise ValueError(f"Expected JSON object on line {line_no} in {path}, got {type(obj)}")
        rows.append(obj)
    return rows


def conversations_to_messages(obj: Dict[str, Any]) -> Dict[str, Any]:
    """
    Convert ShareGPT-style:
      {"conversations":[{"from":"human","value":"..."},{"from":"gpt","value":"..."}]}
    to Llama-3-style:
      {"messages":[{"role":"system","content":"..."},{"role":"user","content":"..."},{"role":"assistant","content":"..."}]}
    """
    conv = obj.get("conversations")
    if not isinstance(conv, list):
        raise ValueError("Missing/invalid 'conversations' list")

    messages: List[Dict[str, str]] = []
    for m in conv:
        if not isinstance(m, dict):
            continue
        frm = m.get("from")
        val = m.get("value")
        if not isinstance(val, str):
            continue
        if frm == "human":
            messages.append({"role": "user", "content": val})
        elif frm == "gpt":
            messages.append({"role": "assistant", "content": val})

    # We wrap with system prompt later (or ensure it exists).
    return {"messages": messages}


def validate_and_normalize_messages(obj: Dict[str, Any]) -> Dict[str, Any]:
    msgs = obj.get("messages")
    if not isinstance(msgs, list):
        raise ValueError("Missing/invalid 'messages' list")
    norm: List[Dict[str, str]] = []
    for m in msgs:
        if not isinstance(m, dict):
            continue
        role = m.get("role")
        content = m.get("content")
        if role not in ("system", "user", "assistant"):
            continue
        if not isinstance(content, str):
            continue
        content = content.strip()
        if not content:
            continue
        norm.append({"role": role, "content": content})
    if not norm:
        raise ValueError("No valid messages after normalization")
    return {"messages": norm}


def ensure_system_prompt(obj: Dict[str, Any], system_prompt: str, *, replace_if_different: bool = True) -> Dict[str, Any]:
    msgs = obj["messages"]
    if msgs and msgs[0].get("role") == "system":
        if replace_if_different and msgs[0].get("content") != system_prompt:
            msgs[0]["content"] = system_prompt
        return obj
    obj["messages"] = [{"role": "system", "content": system_prompt}] + msgs
    return obj


def load_dataset_any_schema(path: str) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for obj in load_jsonl_objects(path):
        if "messages" in obj:
            out.append(validate_and_normalize_messages(obj))
        elif "conversations" in obj:
            out.append(validate_and_normalize_messages(conversations_to_messages(obj)))
        else:
            raise ValueError(f"Line missing 'messages' or 'conversations' schema in {path}")
    return out


def write_jsonl(path: str, rows: List[Dict[str, Any]]) -> None:
    with open(path, "w", encoding="utf-8") as f:
        for row in rows:
            # Validation requirement: ensure it has "messages"
            if "messages" not in row:
                raise ValueError("Attempted to write row missing 'messages'")
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def main() -> None:
    ap = argparse.ArgumentParser(description="Merge + shuffle NASFAQ fine-tune datasets (messages format).")
    ap.add_argument("--real", default="real_chat_data.jsonl", help="Existing scraper output (messages or conversations).")
    ap.add_argument("--roasts", default="synthetic_roasts.jsonl")
    ap.add_argument("--news", default="synthetic_news.jsonl")
    ap.add_argument("--out", default="final_finetune_dataset.jsonl")
    ap.add_argument("--seed", type=int, default=1337)
    ap.add_argument(
        "--no-replace-system",
        action="store_true",
        help="If set, do not replace an existing leading system prompt in real data (only insert if missing).",
    )
    args = ap.parse_args()

    real = load_dataset_any_schema(args.real)
    roasts = load_dataset_any_schema(args.roasts)
    news = load_dataset_any_schema(args.news)

    # Ensure system prompt exists for real chat data.
    replace = not args.no_replace_system
    real = [ensure_system_prompt(r, REQUIRED_SYSTEM_PROMPT, replace_if_different=replace) for r in real]

    combined = real + roasts + news
    rng = random.Random(args.seed)
    rng.shuffle(combined)

    write_jsonl(args.out, combined)

    print(
        f"Total Lines: {len(combined)} | Chat: {len(real)} | Roasts: {len(roasts)} | News: {len(news)}"
    )
    print(f"Wrote -> {args.out}")


if __name__ == "__main__":
    main()


