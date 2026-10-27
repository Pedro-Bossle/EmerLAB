#!/usr/bin/env python3
"""Export em massa: tabelas de Cidades e Negociações → Excel multi-abas na Desktop."""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import date
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env.local"


def load_env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def desktop_dir() -> Path:
    home = Path.home()
    candidates = [
        home / "OneDrive" / "Área de Trabalho",
        home / "OneDrive" / "Desktop",
        home / "Desktop",
        home / "Área de Trabalho",
    ]
    for c in candidates:
        if c.is_dir():
            return c
    return Path(os.environ.get("USERPROFILE", str(home))) / "Desktop"


class SupabaseRest:
    def __init__(self, url: str, key: str):
        self.base = url.rstrip("/") + "/rest/v1"
        self.key = key

    def select(self, table: str, select: str = "*", params: dict | None = None) -> list:
        q = {"select": select}
        if params:
            q.update(params)
        rows: list = []
        page_size = 1000
        start = 0
        while True:
            end = start + page_size - 1
            query = urllib.parse.urlencode(q, doseq=True)
            req = urllib.request.Request(
                f"{self.base}/{table}?{query}",
                headers={
                    "apikey": self.key,
                    "Authorization": f"Bearer {self.key}",
                    "Accept": "application/json",
                    "Range-Unit": "items",
                    "Range": f"{start}-{end}",
                    "Prefer": "count=exact",
                },
            )
            try:
                with urllib.request.urlopen(req, timeout=120) as resp:
                    chunk = json.loads(resp.read().decode("utf-8"))
            except urllib.error.HTTPError as e:
                body = e.read().decode("utf-8", errors="replace")
                raise RuntimeError(f"REST {table}: {e.code} {body[:400]}") from e
            if not chunk:
                break
            rows.extend(chunk)
            if len(chunk) < page_size:
                break
            start += page_size
        return rows


FONT = Font(name="Arial", size=11)
FONT_BOLD = Font(name="Arial", size=11, bold=True)
FILL_HDR = PatternFill("solid", fgColor="D9D9D9")
THIN = Border(
    left=Side(style="thin", color="000000"),
    right=Side(style="thin", color="000000"),
    top=Side(style="thin", color="000000"),
    bottom=Side(style="thin", color="000000"),
)
ALIGN_C = Alignment(vertical="center", horizontal="center", wrap_text=True)
ALIGN_L = Alignment(vertical="center", horizontal="left", wrap_text=True)
MONEY = '#,##0.00'


def sanitize_sheet_name(name: str, used: set[str]) -> str:
    cleaned = re.sub(r'[:\\/?*\[\]]', " ", str(name or "Sem nome")).strip()
    cleaned = re.sub(r"\s+", " ", cleaned)[:31] or "Sem nome"
    base = cleaned
    n = 2
    while cleaned.lower() in used:
        suffix = f" ({n})"
        cleaned = (base[: 31 - len(suffix)] + suffix).strip()
        n += 1
    used.add(cleaned.lower())
    return cleaned


def style_meta_row(ws, row: int = 1):
    for col in range(1, 4):
        cell = ws.cell(row=row, column=col)
        cell.font = FONT_BOLD
        cell.fill = FILL_HDR
        cell.border = THIN
        cell.alignment = ALIGN_L if col != 3 else ALIGN_C


def style_header_row(ws, row: int = 2):
    for col in range(1, 6):
        cell = ws.cell(row=row, column=col)
        cell.font = FONT_BOLD
        cell.fill = FILL_HDR
        cell.border = THIN
        cell.alignment = ALIGN_C


def write_table_sheet(ws, *, nome: str, cidade: str, tipo: str, linhas: list[dict]):
    ws["A1"] = nome or ""
    ws["B1"] = cidade or ""
    ws["C1"] = tipo or ""
    # rótulos conceituais via comentário de linha / cabeçalho implícito
    ws["A1"].comment = None
    style_meta_row(ws, 1)

    ws["A2"] = "Cod"
    ws["B2"] = "Nome"
    ws["C2"] = "P"
    ws["D2"] = "M"
    ws["E2"] = "G"
    style_header_row(ws, 2)

    for i, item in enumerate(linhas, start=3):
        ws.cell(row=i, column=1, value=item.get("codigo") or "").font = FONT
        ws.cell(row=i, column=1).border = THIN
        ws.cell(row=i, column=1).alignment = ALIGN_L

        ws.cell(row=i, column=2, value=item.get("nome") or "").font = FONT
        ws.cell(row=i, column=2).border = THIN
        ws.cell(row=i, column=2).alignment = ALIGN_L

        for j, key in enumerate(("p", "m", "g"), start=3):
            cell = ws.cell(row=i, column=j)
            val = item.get(key)
            if val is None or val == "":
                cell.value = None
            else:
                try:
                    cell.value = float(val)
                    cell.number_format = MONEY
                except (TypeError, ValueError):
                    cell.value = val
            cell.font = FONT
            cell.border = THIN
            cell.alignment = ALIGN_C

    ws.column_dimensions["A"].width = 14
    ws.column_dimensions["B"].width = 48
    ws.column_dimensions["C"].width = 12
    ws.column_dimensions["D"].width = 12
    ws.column_dimensions["E"].width = 12
    ws.freeze_panes = "A3"
    ws.auto_filter.ref = f"A2:E{max(2, 2 + len(linhas))}"


def pivot_pmg(rows, *, id_key: str, proc_key: str, porte_ids: dict[str, int], nome_alt_key: str | None = None):
    """Agrupa por (id_key, proc_key) → {p,m,g, nome_alt}."""
    buckets: dict[tuple, dict] = {}
    for r in rows:
        oid = r.get(id_key)
        pid = r.get(proc_key)
        if oid is None or pid is None:
            continue
        key = (oid, pid)
        bucket = buckets.setdefault(key, {"p": None, "m": None, "g": None, "nome_alt": None})
        porte = r.get("porte_id")
        val = r.get("valor")
        if porte == porte_ids.get("P"):
            bucket["p"] = val
        elif porte == porte_ids.get("M"):
            bucket["m"] = val
        elif porte == porte_ids.get("G"):
            bucket["g"] = val
        if nome_alt_key and r.get(nome_alt_key):
            bucket["nome_alt"] = r.get(nome_alt_key)
    return buckets


def main() -> int:
    env = load_env(ENV_PATH)
    url = env.get("SUPABASE_URL") or env.get("VITE_SUPABASE_URL")
    key = env.get("SUPABASE_SERVICE_ROLE_KEY") or env.get("VITE_SUPABASE_ANON_KEY")
    if not url or not key:
        print("Faltam SUPABASE_URL / SERVICE_ROLE_KEY no .env.local", file=sys.stderr)
        return 1

    api = SupabaseRest(url, key)
    print("Carregando catálogos…")
    portes = api.select("portes", "id,nome")
    porte_ids = {str(p["nome"]).upper(): int(p["id"]) for p in portes}
    procedimentos = api.select("procedimentos", "id,codigo,nome")
    proc_by_id = {int(p["id"]): p for p in procedimentos}
    proc_by_codigo = {str(p["codigo"]): p for p in procedimentos if p.get("codigo")}

    cidades = api.select("cidades", "id,nome,uf", {"order": "nome.asc"})
    try:
        vinculos = api.select("cidades_municipios_vinculo", "cidade_id,municipio_nome,uf")
    except RuntimeError:
        vinculos = []

    mun_por_cidade: dict[int, list[str]] = defaultdict(list)
    for v in vinculos:
        cid = int(v["cidade_id"])
        nome_m = (v.get("municipio_nome") or "").strip()
        if nome_m and nome_m not in mun_por_cidade[cid]:
            mun_por_cidade[cid].append(nome_m)
    for cid in mun_por_cidade:
        mun_por_cidade[cid].sort(key=lambda s: s.casefold())

    print("Carregando repasses…")
    repasses = api.select("repasses", "cidade_id,procedimento_id,porte_id,valor")
    print(f"  {len(repasses)} linhas")

    print("Carregando negociações…")
    vets = api.select(
        "veterinarios",
        "id,nome,tipo,cidade_id,prestador_id,ativo",
        {"order": "nome.asc"},
    )
    neg = api.select(
        "negociacoes_vet",
        "veterinario_id,procedimento_id,porte_id,valor,nome_alternativo",
    )
    print(f"  {len(vets)} credenciados, {len(neg)} valores")

    # --- Cidades ---
    city_buckets = pivot_pmg(repasses, id_key="cidade_id", proc_key="procedimento_id", porte_ids=porte_ids)
    city_linhas: dict[int, list[dict]] = defaultdict(list)
    for (cid, proc_ref), vals in city_buckets.items():
        proc = proc_by_codigo.get(str(proc_ref))
        if not proc and str(proc_ref).isdigit():
            proc = proc_by_id.get(int(proc_ref))
        codigo = (proc or {}).get("codigo") or str(proc_ref)
        nome = (proc or {}).get("nome") or str(proc_ref)
        city_linhas[int(cid)].append(
            {"codigo": codigo, "nome": nome, "p": vals["p"], "m": vals["m"], "g": vals["g"]}
        )
    for cid in city_linhas:
        city_linhas[cid].sort(key=lambda x: str(x["codigo"] or "").casefold())

    wb_c = Workbook()
    wb_c.remove(wb_c.active)
    used_c: set[str] = set()
    # Legenda na primeira aba
    leg = wb_c.create_sheet("_Legenda", 0)
    leg["A1"] = "Export em massa — Tabelas de Cidades"
    leg["A2"] = f"Gerado em {date.today().isoformat()}"
    leg["A3"] = "Linha 1 de cada aba: Nome | Cidade (ou cidades) | Tipo"
    leg["A4"] = "Linha 2: Cod | Nome | P | M | G"
    leg["A5"] = "Tipo = 'Tabela Cidade'. Em cidades com múltiplos municípios, a coluna Cidade lista todos."
    for r in range(1, 6):
        leg.cell(row=r, column=1).font = FONT
    leg.column_dimensions["A"].width = 100

    for c in cidades:
        cid = int(c["id"])
        nome_cidade = c.get("nome") or f"Cidade {cid}"
        munis = mun_por_cidade.get(cid) or []
        if munis:
            cidade_txt = ", ".join(munis)
        else:
            cidade_txt = nome_cidade
        linhas = city_linhas.get(cid, [])
        sheet_name = sanitize_sheet_name(nome_cidade, used_c)
        ws = wb_c.create_sheet(sheet_name)
        write_table_sheet(
            ws,
            nome=nome_cidade,
            cidade=cidade_txt,
            tipo="Tabela Cidade",
            linhas=linhas,
        )
        print(f"  Cidade aba '{sheet_name}': {len(linhas)} procedimentos")

    out_dir = desktop_dir()
    out_c = out_dir / f"Tabelas_Cidades_{date.today().isoformat()}.xlsx"
    wb_c.save(out_c)
    print(f"Salvo: {out_c}")

    # --- Negociações ---
    neg_buckets = pivot_pmg(
        neg,
        id_key="veterinario_id",
        proc_key="procedimento_id",
        porte_ids=porte_ids,
        nome_alt_key="nome_alternativo",
    )
    neg_linhas: dict[int, list[dict]] = defaultdict(list)
    for (vid, proc_id), vals in neg_buckets.items():
        proc = proc_by_id.get(int(proc_id)) if proc_id is not None else None
        codigo = (proc or {}).get("codigo") or str(proc_id)
        nome = vals.get("nome_alt") or (proc or {}).get("nome") or str(proc_id)
        neg_linhas[int(vid)].append(
            {"codigo": codigo, "nome": nome, "p": vals["p"], "m": vals["m"], "g": vals["g"]}
        )
    for vid in neg_linhas:
        neg_linhas[vid].sort(key=lambda x: str(x["codigo"] or "").casefold())

    cidade_nome = {int(c["id"]): c.get("nome") or "" for c in cidades}

    wb_n = Workbook()
    wb_n.remove(wb_n.active)
    used_n: set[str] = set()
    legn = wb_n.create_sheet("_Legenda", 0)
    legn["A1"] = "Export em massa — Tabelas de Negociações"
    legn["A2"] = f"Gerado em {date.today().isoformat()}"
    legn["A3"] = "Linha 1 de cada aba: Nome | Cidade (ou cidades) | Tipo"
    legn["A4"] = "Linha 2: Cod | Nome | P | M | G"
    legn["A5"] = "Nome da aba = nome do credenciado (veterinário/negociação)."
    for r in range(1, 6):
        legn.cell(row=r, column=1).font = FONT
    legn.column_dimensions["A"].width = 100

    for v in vets:
        vid = int(v["id"])
        nome = v.get("nome") or f"Negociacao {vid}"
        cid = v.get("cidade_id")
        cid_i = int(cid) if cid is not None else None
        # Negociações: só a cidade principal da tabela (municípios extras ficam no export de Cidades)
        cidade_txt = cidade_nome.get(cid_i, "") if cid_i else ""
        tipo = v.get("tipo") or ""
        linhas = neg_linhas.get(vid, [])
        sheet_name = sanitize_sheet_name(nome, used_n)
        ws = wb_n.create_sheet(sheet_name)
        write_table_sheet(
            ws,
            nome=nome,
            cidade=cidade_txt,
            tipo=tipo,
            linhas=linhas,
        )

    out_n = out_dir / f"Tabelas_Negociacoes_{date.today().isoformat()}.xlsx"
    wb_n.save(out_n)
    print(f"Salvo: {out_n}")
    print("Concluído.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
