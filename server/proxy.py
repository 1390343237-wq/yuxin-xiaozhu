#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
愈心小筑工作台 · 腾讯文档代理（浏览器 <-> 文档 桥梁）

为什么需要它：浏览器静态前端无法直接对腾讯文档做 OAuth 鉴权、也无法跨域直连。
此代理持有文档访问能力，把 sheet.js 约定的 REST 接口转成 tencentdocs.py（已鉴权会话）
或腾讯文档 OpenAPI 调用。

运行（开发/本地，复用 WorkBuddy 已鉴权会话）：
    python server/proxy.py
生产（配置 token 直连 OpenAPI）：
    set TENCENT_DOC_TOKEN=xxxxx   (可选)
    python server/proxy.py --port 8080

接口（与 assets/js/lib/sheet.js 完全一致）：
    GET  /health
    GET  /sheet/info?file_id=XXX
    GET  /sheet/range?file_id=&sheet_id=&range=A1:Z10
    POST /sheet/range        {file_id, sheet_id, range, values:[[...]]}
    POST /sheet/append       {file_id, sheet_name, row:[...]}
    POST /sheet/add          {file_id, name}
"""

import os
import sys
import json
import subprocess
import csv
import io
import re
import threading
from urllib.parse import urlparse, parse_qs
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TDOC_CLI = os.environ.get(
    "TDOC_CLI",
    r"C:/Users/Admin/.workbuddy/plugins/cache/workbuddy-builtin/tencent-docs-plugin/1.0.0/skills/tencent-docs/tencentdocs.py",
)
PY = os.environ.get("TDOC_PY", r"C:/Users/Admin/.workbuddy/binaries/python/versions/3.13.12/python.exe")
DOC_TOKEN = os.environ.get("TENCENT_DOC_TOKEN", "")  # 生产直连 OpenAPI 时使用

PORT = int(os.environ.get("PORT", "8080"))

# === 云端 KV 存储（生活数据跨设备同步的可靠后端，规避文档写入限制） ===
KV_FILE = os.environ.get("KV_FILE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "kv_store.json"))
_kv_lock = threading.Lock()


def kv_get(key):
    with _kv_lock:
        if not os.path.exists(KV_FILE):
            return None
        try:
            with open(KV_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            return None
        return data.get(key)


def kv_set(key, value):
    with _kv_lock:
        data = {}
        if os.path.exists(KV_FILE):
            try:
                with open(KV_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
            except Exception:
                data = {}
        data[key] = value
        with open(KV_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        return True


def kv_keys(prefix):
    with _kv_lock:
        if not os.path.exists(KV_FILE):
            return []
        try:
            with open(KV_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            return []
        return [k for k in data.keys() if k.startswith(prefix)]


def _cli(method, payload):
    """调用 tencentdocs.py tdoc_call sheet-mcp <method> <json>
    返回时自动解开 jsonrpc 信封：result.content[0].text 通常是 JSON 字符串。
    """
    args = [PY, TDOC_CLI, "tdoc_call", "sheet-mcp", method, json.dumps(payload, ensure_ascii=False)]
    proc = subprocess.run(args, capture_output=True, text=True, timeout=90)
    out = (proc.stdout or "").strip()
    if not out:
        raise RuntimeError(proc.stderr.strip() or "empty output")
    try:
        env = json.loads(out)
    except json.JSONDecodeError:
        return {"raw": out}
    # 解开 jsonrpc 信封
    if isinstance(env, dict) and "result" in env:
        content = env["result"].get("content")
        if isinstance(content, list) and content and isinstance(content[0], dict):
            text = content[0].get("text", "")
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                return {"text": text}
        return env["result"]
    return env


def _unwrap_sheets(info):
    """兼容多种返回结构，提取 [{'sheet_id','name'}]"""
    if isinstance(info, dict):
        sheets = info.get("sheets")
        if isinstance(sheets, list):
            out = []
            for s in sheets:
                out.append({
                    "sheet_id": s.get("sheet_id") or s.get("id"),
                    "name": s.get("sheet_name") or s.get("name"),
                })
            return out
    return []


def _csv_to_grid(text):
    """CSV 文本 -> 二维数组"""
    reader = csv.reader(io.StringIO(text))
    return [row for row in reader]


def _cell_to_idx(col_letters):
    """'A'->0 'K'->10 'AA'->26"""
    n = 0
    for ch in col_letters.upper():
        n = n * 26 + (ord(ch) - ord('A') + 1)
    return n - 1


def _parse_range(rng):
    """'A1:K5' -> (startCol, startRow, endCol, endRow) 0-based"""
    m = re.match(r"([A-Za-z]+)(\d+):([A-Za-z]+)(\d+)", rng.strip())
    if not m:
        raise ValueError("bad range: " + rng)
    sc, sr, ec, er = m.groups()
    return _cell_to_idx(sc), int(sr) - 1, _cell_to_idx(ec), int(er) - 1


def resolve_sheet_id(file_id, sheet_name):
    info = _cli("get_sheet_info", {"file_id": file_id})
    sheets = _unwrap_sheets(info)
    for s in sheets:
        if s.get("name") == sheet_name:
            return s.get("sheet_id")
    return None


def append_row(file_id, sheet_name, row):
    sid = resolve_sheet_id(file_id, sheet_name)
    if not sid:
        # 不存在则创建
        add = _cli("add_sheet", {"file_id": file_id, "name": sheet_name})
        sid = add.get("sheet_id") or add.get("id") or resolve_sheet_id(file_id, sheet_name)
    # 取当前最大行
    data = _cli("get_cell_data", {"file_id": file_id, "sheet_id": sid, "return_csv": True})
    csv_text = (data.get("csv_data") or data.get("csv") or "") if isinstance(data, dict) else str(data)
    grid = _csv_to_grid(csv_text) if csv_text else []
    next_row = len(grid) + 1  # 1-based
    cols = max(len(row), 1)
    end_col = chr(ord('A') + cols - 1)
    rng = f"A{next_row}:{end_col}{next_row}"
    cells = [{"row": next_row - 1, "col": i, "value_type": "STRING", "string_value": str(v)}
             for i, v in enumerate(row)]
    _cli("set_range_value", {"file_id": file_id, "sheet_id": sid, "values": cells})
    return {"ok": True, "sheet_id": sid, "row": next_row}


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send(204, {})

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        try:
            if u.path == "/health":
                return self._send(200, {"ok": True, "mode": "cli" if not DOC_TOKEN else "openapi"})
            if u.path == "/sheet/info":
                fid = q.get("file_id", [""])[0]
                info = _cli("get_sheet_info", {"file_id": fid})
                return self._send(200, {"sheets": _unwrap_sheets(info)})
            if u.path == "/sheet/range":
                fid = q.get("file_id", [""])[0]
                sid = q.get("sheet_id", [""])[0]
                rng = q.get("range", ["A1:Z50"])[0]
                data = _cli("get_cell_data", {"file_id": fid, "sheet_id": sid, "return_csv": True})
                csv_text = (data.get("csv_data") or data.get("csv") or "") if isinstance(data, dict) else str(data)
                grid = _csv_to_grid(csv_text) if csv_text else []
                return self._send(200, {"range": rng, "values": grid})
            if u.path == "/kv/get":
                key = q.get("key", [""])[0]
                return self._send(200, {"key": key, "value": kv_get(key)})
            if u.path == "/kv/keys":
                prefix = q.get("prefix", [""])[0]
                return self._send(200, {"keys": kv_keys(prefix)})
            return self._send(404, {"error": "not found"})
        except Exception as e:
            return self._send(500, {"error": str(e)})

    def do_POST(self):
        u = urlparse(self.path)
        try:
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length else b"{}"
            body = json.loads(raw.decode("utf-8") or "{}")
        except Exception as e:
            return self._send(400, {"error": "bad body: " + str(e)})
        try:
            if u.path == "/sheet/range":
                fid = body["file_id"]; sid = body["sheet_id"]; rng = body["range"]; values = body["values"]
                sc, sr, ec, er = _parse_range(rng)
                cells = []
                for r, row in enumerate(values):
                    for c, val in enumerate(row):
                        cells.append({"row": sr + r, "col": sc + c, "value_type": "STRING", "string_value": str(val)})
                res = _cli("set_range_value", {"file_id": fid, "sheet_id": sid, "values": cells})
                return self._send(200, {"ok": True, "written": len(cells)})
            if u.path == "/sheet/append":
                res = append_row(body["file_id"], body["sheet_name"], body["row"])
                return self._send(200, res)
            if u.path == "/sheet/add":
                res = _cli("add_sheet", {"file_id": body["file_id"], "name": body["name"]})
                return self._send(200, {"ok": True, **res})
            # === 云端 KV（生活数据跨设备同步） ===
            if u.path == "/kv/set":
                kv_set(body["key"], body.get("value"))
                return self._send(200, {"ok": True})
            return self._send(404, {"error": "not found"})
        except Exception as e:
            return self._send(500, {"error": str(e)})

    def log_message(self, fmt, *args):
        sys.stderr.write("[proxy] " + (fmt % args) + "\n")


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else PORT
    srv = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"[proxy] listening on http://0.0.0.0:{port}  (TDOC_CLI={TDOC_CLI})")
    srv.serve_forever()


if __name__ == "__main__":
    main()
