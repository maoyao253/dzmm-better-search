#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Extract character card data (persona + character book / world book) from an
Agent Foundry Vault (or any folder of SillyTavern-compatible cards).

Supported sources:
  - JSON cards (V1 / V2 / V3, top-level `data` or legacy flat fields)
  - Standalone world books (JSON with `entries` and no card `data`)
  - PNG cards (tEXt chunks `chara` / `ccv3`, base64 JSON)
  - WebP cards (EXIF chunk containing `chara` / `ccv3` base64 JSON)

Read-only: it never modifies the vault.

Usage:
  python extract_afv_cards.py [vault_root] [out_dir]

Outputs:
  cards-summary.csv      one row per card
  cards-full.json        complete extracted payloads (all text, untruncated)
  cards-readable.md      per-card readable report (persona + world book)
"""

from __future__ import annotations

import base64
import csv
import json
import struct
import sys
from pathlib import Path


def png_chunks(data: bytes):
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        return []
    pos = 8
    out = []
    while pos < len(data):
        length = struct.unpack(">I", data[pos : pos + 4])[0]
        ctype = data[pos + 4 : pos + 8].decode("latin1")
        body = data[pos + 8 : pos + 8 + length]
        out.append((ctype, body))
        pos += 12 + length
        if ctype == "IEND":
            break
    return out


def webp_chunks(data: bytes):
    if data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        return []
    pos = 12
    out = []
    while pos + 8 <= len(data):
        ctype = data[pos : pos + 4].decode("latin1")
        length = struct.unpack("<I", data[pos + 4 : pos + 8])[0]
        body = data[pos + 8 : pos + 8 + length]
        out.append((ctype, body))
        pos += 8 + length + (length & 1)
    return out


def decode_text_payload(body: bytes) -> dict | None:
    """Decode a tEXt/EXIF body that contains key\0base64json."""
    if b"\x00" not in body:
        return None
    key, b64 = body.split(b"\x00", 1)
    if key not in (b"chara", b"ccv3"):
        return None
    try:
        return json.loads(base64.b64decode(b64).decode("utf-8"))
    except Exception:
        return None


def card_from_png(path: Path) -> dict | None:
    data = path.read_bytes()
    found = {}
    for ctype, body in png_chunks(data):
        if ctype in ("tEXt", "iTXt"):
            payload = decode_text_payload(body)
            if payload:
                found[body.split(b"\x00", 1)[0].decode("latin1")] = payload
    # Per SillyTavern spec: ccv3 takes priority, then chara.
    if "ccv3" in found:
        return found["ccv3"]
    if "chara" in found:
        return found["chara"]
    return None


def card_from_webp(path: Path) -> dict | None:
    data = path.read_bytes()
    for ctype, body in webp_chunks(data):
        if ctype == "EXIF":
            payload = decode_text_payload(body)
            if payload:
                return payload
    return None


def card_from_json(path: Path) -> dict | None:
    try:
        obj = json.loads(path.read_text(encoding="utf-8-sig"))
    except Exception:
        return None
    if isinstance(obj, dict):
        return obj
    return None


def classify(card: dict) -> str:
    if not isinstance(card, dict):
        return "unknown"
    if "data" in card and isinstance(card["data"], dict):
        return "card"
    if "entries" in card and isinstance(card.get("entries"), (list, dict)):
        return "worldbook"
    if any(k in card for k in ("name", "description", "personality", "first_mes")):
        return "card"
    return "unknown"


def card_name(card: dict) -> str:
    data = card.get("data") if isinstance(card.get("data"), dict) else card
    return str(data.get("name") or card.get("name") or "").strip()


def truncate(text, limit):
    if text is None:
        return ""
    text = str(text)
    return text if len(text) <= limit else text[:limit] + f"...[+{len(text)-limit} chars]"


def extract_card(path: Path, card: dict, rel: Path) -> dict:
    kind = classify(card)
    spec = card.get("spec")
    spec_version = card.get("spec_version")
    data = card.get("data") if isinstance(card.get("data"), dict) else card
    book = data.get("character_book") if isinstance(data, dict) else None

    result = {
        "source": str(rel).replace("\\", "/"),
        "kind": kind,
        "format": "json" if path.suffix.lower() == ".json" else path.suffix.lower().lstrip("."),
        "spec": spec,
        "spec_version": spec_version,
        "name": card_name(card),
        "tags": data.get("tags") if isinstance(data, dict) else card.get("tags"),
        "creator": data.get("creator") if isinstance(data, dict) else card.get("creator"),
        "character_version": data.get("character_version") if isinstance(data, dict) else card.get("character_version"),
    }
    if kind != "card":
        if kind == "worldbook":
            result["world_book"] = extract_book(card, path)
        return result

    fields = {
        "description": "人设描述",
        "personality": "性格",
        "scenario": "场景",
        "first_mes": "开场白",
        "mes_example": "对话示例",
        "creator_notes": "作者备注",
        "system_prompt": "系统提示词",
        "post_history_instructions": "历史后置指令",
    }
    for key in fields:
        result[key] = data.get(key, "")
    result["alternate_greetings"] = data.get("alternate_greetings", [])
    result["world_book"] = extract_book(book, path) if book else None

    ext = data.get("extensions") if isinstance(data, dict) else {}
    if isinstance(ext, dict):
        result["extensions_keys"] = sorted(ext.keys())
        if "depth_prompt" in ext:
            result["depth_prompt"] = ext["depth_prompt"]
        if "regex_scripts" in ext:
            result["regex_scripts"] = ext["regex_scripts"]
        if "talkativeness" in ext:
            result["talkativeness"] = ext["talkativeness"]
    return result


def extract_book(book, path: Path) -> dict | None:
    if not isinstance(book, dict):
        return None
    raw_entries = book.get("entries") or []
    if isinstance(raw_entries, dict):
        raw_entries = [
            raw_entries[k]
            for k in sorted(
                raw_entries,
                key=lambda k: int(k) if str(k).isdigit() else str(k),
            )
        ]
    out_entries = []
    for e in raw_entries:
        if not isinstance(e, dict):
            continue
        out_entries.append(
            {
                "id": e.get("id"),
                "comment": e.get("comment", ""),
                "keys": e.get("keys", []),
                "secondary_keys": e.get("secondary_keys", []),
                "content": e.get("content", ""),
                "position": e.get("position"),
                "insertion_order": e.get("insertion_order"),
                "constant": e.get("constant"),
                "selective": e.get("selective"),
                "enabled": e.get("enabled"),
                "use_regex": e.get("use_regex"),
                "extensions": e.get("extensions", {}),
            }
        )
    return {
        "name": book.get("name", ""),
        "description": book.get("description", ""),
        "entries_count": len(out_entries),
        "entries": out_entries,
    }


def main() -> int:
    vault = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(r"D:\agent-foundry-vault")
    out_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).resolve().parent
    out_dir.mkdir(parents=True, exist_ok=True)

    cards = []
    files = sorted(
        p
        for p in vault.rglob("*")
        if p.is_file() and p.suffix.lower() in {".json", ".png", ".webp"}
    )
    for p in files:
        try:
            if p.suffix.lower() == ".json":
                card = card_from_json(p)
            elif p.suffix.lower() == ".png":
                card = card_from_png(p)
            else:
                card = card_from_webp(p)
            if card:
                cards.append(extract_card(p, card, p.relative_to(vault)))
        except Exception as exc:
            print(f"[warn] {p}: {exc}")

    cards.sort(key=lambda c: c["source"])

    # Full JSON dump
    with open(out_dir / "cards-full.json", "w", encoding="utf-8") as f:
        json.dump(cards, f, ensure_ascii=False, indent=2)

    # Summary CSV
    with open(out_dir / "cards-summary.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(
            [
                "source",
                "kind",
                "format",
                "spec",
                "name",
                "tags",
                "creator",
                "version",
                "desc_len",
                "personality_len",
                "scenario_len",
                "first_mes_len",
                "system_prompt_len",
                "phi_len",
                "world_book",
                "book_entries",
            ]
        )
        for c in cards:
            book = c.get("world_book") or {}
            w.writerow(
                [
                    c["source"],
                    c["kind"],
                    c["format"],
                    c["spec"],
                    c["name"],
                    ";".join(c["tags"] or []) if isinstance(c.get("tags"), list) else c.get("tags", ""),
                    c.get("creator", ""),
                    c.get("character_version", ""),
                    len(c.get("description") or ""),
                    len(c.get("personality") or ""),
                    len(c.get("scenario") or ""),
                    len(c.get("first_mes") or ""),
                    len(c.get("system_prompt") or ""),
                    len(c.get("post_history_instructions") or ""),
                    book.get("name", ""),
                    book.get("entries_count", 0),
                ]
            )

    # Readable Markdown report
    with open(out_dir / "cards-readable.md", "w", encoding="utf-8") as f:
        f.write("# Agent Foundry Vault — 角色卡内容提取报告\n\n")
        f.write(f"- 扫描目录：`{vault}`\n")
        f.write(f"- 提取到卡片/世界书：{len(cards)} 个\n\n")
        for c in cards:
            f.write(f"## {c['name'] or c['source']}\n\n")
            f.write(f"- 文件：`{c['source']}`（{c['kind']} / {c['format']}）\n")
            f.write(f"- spec：`{c['spec'] or '-'}` {c['spec_version'] or ''}\n")
            f.write(f"- 标签：{', '.join(c['tags']) if isinstance(c.get('tags'), list) else (c.get('tags') or '-')}\n")
            f.write(f"- 作者：{c.get('creator') or '-'} ｜ 版本：{c.get('character_version') or '-'}\n\n")
            if c["kind"] == "worldbook":
                book = c.get("world_book") or {}
                f.write(f"### 世界书：{book.get('name') or '-'}（{book.get('entries_count', 0)} 条）\n\n")
                write_book(f, book)
                continue
            for key, label in [
                ("description", "人设描述"),
                ("personality", "性格"),
                ("scenario", "场景设定"),
                ("first_mes", "开场白"),
                ("mes_example", "对话示例"),
                ("creator_notes", "作者备注"),
                ("system_prompt", "系统提示词"),
                ("post_history_instructions", "历史后置指令"),
            ]:
                val = c.get(key)
                if val:
                    f.write(f"### {label}\n\n```text\n{truncate(val, 4000)}\n```\n\n")
            alts = c.get("alternate_greetings") or []
            if alts:
                f.write(f"### 备用开场白（{len(alts)} 条）\n\n")
                for i, a in enumerate(alts, 1):
                    f.write(f"{i}. {truncate(a, 800)}\n\n")
            book = c.get("world_book")
            if book:
                f.write(f"### 世界书：{book.get('name') or '-'}（{book.get('entries_count', 0)} 条）\n\n")
                write_book(f, book)
            ext_keys = c.get("extensions_keys") or []
            if ext_keys:
                f.write(f"### 扩展字段\n\n`{', '.join(ext_keys)}`\n\n")
            depth = c.get("depth_prompt")
            if depth:
                f.write("### Depth Prompt\n\n```text\n")
                f.write(json.dumps(depth, ensure_ascii=False, indent=2))
                f.write("\n```\n\n")
            regexes = c.get("regex_scripts")
            if regexes:
                f.write(f"### 正则脚本（{len(regexes)} 个）\n\n")
                for rx in regexes:
                    if isinstance(rx, dict):
                        f.write(f"- `{rx.get('scriptName') or rx.get('findRegex') or ''}`\n")

    print(f"scanned: {len(files)} files, extracted: {len(cards)} cards/books")
    print(f"output: {out_dir}")
    return 0


def write_book(f, book: dict):
    if book.get("description"):
        f.write(f"> {book['description']}\n\n")
    for i, e in enumerate(book.get("entries", []), 1):
        keys = ", ".join(e.get("keys") or [])
        sec = ", ".join(e.get("secondary_keys") or [])
        pos = e.get("position") or (e.get("extensions") or {}).get("position")
        f.write(f"#### 条目 {i}：{e.get('comment') or keys or '(无标题)'}\n\n")
        f.write(f"- 触发词：`{keys}`\n" if keys else "")
        f.write(f"- 次级词：`{sec}`\n" if sec else "")
        f.write(f"- 位置：{pos} ｜ 顺序：{e.get('insertion_order')} ｜ 常驻：{e.get('constant')} ｜ 启用：{e.get('enabled')}\n\n")
        if e.get("content"):
            f.write(f"```text\n{truncate(e['content'], 5000)}\n```\n\n")


if __name__ == "__main__":
    raise SystemExit(main())
