#!/usr/bin/env python3
"""Export em massa: tabelas de Planos (diferenças) → Excel multi-abas na Desktop.

Layout de cada aba:
  Linha 1: Cidades validas para os valores abaixo
  Linha 2: lista de municípios da tabela
  Linha 3: (vazia)
  Linha 4: Cod | Procedimento | Basico | Classico | Avançado | Ultra
"""

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

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env.local"

ORDEM_PLANOS = ("basico", "classico", "avancado", "ultra")
ROTULO_COL = {
    "basico": "Basico",
    "classico": "Classico",
    "avancado": "Avançado",
    "ultra": "Ultra",
}


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
                with urllib.request.urlopen(req, timeout=180) as resp:
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
MONEY = "#,##0.00"


def sanitize_sheet_name(name: str, used: set[str]) -> str:
    cleaned = re.sub(r"[:\\/?*\[\]]", " ", str(name or "Sem nome")).strip()
    cleaned = re.sub(r"\s+", " ", cleaned)[:31] or "Sem nome"
    base = cleaned
    n = 2
    while cleaned.lower() in used:
        suffix = f" ({n})"
        cleaned = (base[: 31 - len(suffix)] + suffix).strip()
        n += 1
    used.add(cleaned.lower())
    return cleaned


def normalizar_nome_plano(texto: str) -> str:
    import unicodedata

    s = unicodedata.normalize("NFD", str(texto or ""))
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn")
    return s.strip().upper()


def mapear_planos(planos: list[dict]) -> dict[str, int | None]:
    """Nome canônico → id do plano (Básico/Clássico/Avançado/Ultra)."""
    resultado: dict[str, int | None] = {k: None for k in ORDEM_PLANOS}
    usados: set[int] = set()

    def buscar(chave: str, alvo_exato: str, matcher) -> None:
        encontrado = None
        for p in planos:
            pid = int(p["id"])
            if pid in usados:
                continue
            if normalizar_nome_plano(p.get("nome")) == alvo_exato:
                encontrado = p
                break
        if not encontrado:
            for p in planos:
                pid = int(p["id"])
                if pid in usados:
                    continue
                if matcher(normalizar_nome_plano(p.get("nome"))):
                    encontrado = p
                    break
        if encontrado:
            usados.add(int(encontrado["id"]))
            resultado[chave] = int(encontrado["id"])

    buscar("basico", "BASICO", lambda n: "BASICO" in n or "BASIC" in n)
    buscar("classico", "CLASSICO", lambda n: "CLASSICO" in n)
    buscar("avancado", "AVANCADO", lambda n: "AVANCADO" in n)
    buscar("ultra", "ULTRA", lambda n: "ULTRA" in n)
    return resultado


def style_header_cells(ws, row: int, cols: int):
    for col in range(1, cols + 1):
        cell = ws.cell(row=row, column=col)
        cell.font = FONT_BOLD
        cell.fill = FILL_HDR
        cell.border = THIN
        cell.alignment = ALIGN_C


def write_planos_sheet(ws, *, cidades_txt: str, linhas: list[dict]):
    # Linha 1 — título
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=6)
    c1 = ws.cell(row=1, column=1, value="Cidades validas para os valores abaixo")
    c1.font = FONT_BOLD
    c1.fill = FILL_HDR
    c1.border = THIN
    c1.alignment = ALIGN_L
    for col in range(2, 7):
        ws.cell(row=1, column=col).border = THIN
        ws.cell(row=1, column=col).fill = FILL_HDR

    # Linha 2 — municípios
    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=6)
    c2 = ws.cell(row=2, column=1, value=cidades_txt or "—")
    c2.font = FONT
    c2.border = THIN
    c2.alignment = ALIGN_L
    for col in range(2, 7):
        ws.cell(row=2, column=col).border = THIN
    ws.row_dimensions[2].height = max(18, min(72, 14 + (len(cidades_txt or "") // 80) * 12))

    # Linha 4 — cabeçalho da grade
    headers = ["Cod", "Procedimento", *(ROTULO_COL[k] for k in ORDEM_PLANOS)]
    for i, title in enumerate(headers, start=1):
        cell = ws.cell(row=4, column=i, value=title)
        cell.font = FONT_BOLD
        cell.fill = FILL_HDR
        cell.border = THIN
        cell.alignment = ALIGN_C

    for i, item in enumerate(linhas, start=5):
        cod = ws.cell(row=i, column=1, value=item.get("codigo") or "")
        cod.font = FONT
        cod.border = THIN
        cod.alignment = ALIGN_L

        nome = ws.cell(row=i, column=2, value=item.get("procedimento") or "")
        nome.font = FONT
        nome.border = THIN
        nome.alignment = ALIGN_L

        for j, chave in enumerate(ORDEM_PLANOS, start=3):
            cell = ws.cell(row=i, column=j)
            val = item.get(chave)
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
    for col in ("C", "D", "E", "F"):
        ws.column_dimensions[col].width = 12
    ws.freeze_panes = "A5"
    if linhas:
        ws.auto_filter.ref = f"A4:F{4 + len(linhas)}"


def main() -> int:
    env = load_env(ENV_PATH)
    url = env.get("SUPABASE_URL") or env.get("VITE_SUPABASE_URL")
    key = env.get("SUPABASE_SERVICE_ROLE_KEY") or env.get("VITE_SUPABASE_ANON_KEY")
    if not url or not key:
        print("Faltam SUPABASE_URL / SERVICE_ROLE_KEY no .env.local", file=sys.stderr)
        return 1

    api = SupabaseRest(url, key)
    print("Carregando catálogos…")
    planos = api.select("planos", "id,nome", {"order": "id.asc"})
    mapa = mapear_planos(planos)
    id_para_chave = {pid: chave for chave, pid in mapa.items() if pid is not None}
    print("  Planos mapeados:", {k: mapa[k] for k in ORDEM_PLANOS})
    if not id_para_chave:
        print("Nenhum plano Básico/Clássico/Avançado/Ultra encontrado.", file=sys.stderr)
        return 1

    procedimentos = api.select("procedimentos", "id,codigo,nome")
    proc_by_codigo = {str(p["codigo"]).strip().upper(): p for p in procedimentos if p.get("codigo")}

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

    print("Carregando planos_cidade…")
    pc = api.select("planos_cidade", "cidade_id,plano_id,procedimento_cod,diferenca")
    print(f"  {len(pc)} linhas")

    # cidade_id → codigo → {basico, classico, avancado, ultra}
    por_cidade: dict[int, dict[str, dict]] = defaultdict(lambda: defaultdict(dict))
    for row in pc:
        cid = row.get("cidade_id")
        plano_id = row.get("plano_id")
        cod = str(row.get("procedimento_cod") or "").strip()
        if cid is None or plano_id is None or not cod:
            continue
        chave = id_para_chave.get(int(plano_id))
        if not chave:
            continue
        por_cidade[int(cid)][cod.upper()][chave] = row.get("diferenca")

    wb = Workbook()
    wb.remove(wb.active)
    used: set[str] = set()

    leg = wb.create_sheet("_Legenda", 0)
    leg["A1"] = "Export em massa — Tabelas de Planos (diferenças)"
    leg["A2"] = f"Gerado em {date.today().isoformat()}"
    leg["A3"] = "Linha 1: Cidades validas para os valores abaixo"
    leg["A4"] = "Linha 2: municípios vinculados à tabela"
    leg["A5"] = "Linha 4: Cod | Procedimento | Basico | Classico | Avançado | Ultra"
    leg["A6"] = "Uma aba por cidade (tabela de valores). Valores = diferença do plano."
    for r in range(1, 7):
        leg.cell(row=r, column=1).font = FONT
    leg.column_dimensions["A"].width = 100

    abas = 0
    for c in cidades:
        cid = int(c["id"])
        nome_cidade = c.get("nome") or f"Cidade {cid}"
        munis = mun_por_cidade.get(cid) or []
        nomes = list(munis)
        if nome_cidade and nome_cidade not in nomes:
            nomes.insert(0, nome_cidade)
        # únicos preservando ordem
        vistos: set[str] = set()
        cidades_txt_list = []
        for n in nomes:
            k = n.casefold()
            if k in vistos:
                continue
            vistos.add(k)
            cidades_txt_list.append(n)
        cidades_txt = ", ".join(cidades_txt_list)

        buckets = por_cidade.get(cid) or {}
        linhas: list[dict] = []
        for cod, vals in buckets.items():
            proc = proc_by_codigo.get(cod) or proc_by_codigo.get(cod.upper())
            nome_proc = (proc or {}).get("nome") or cod
            codigo_exib = (proc or {}).get("codigo") or cod
            linhas.append(
                {
                    "codigo": codigo_exib,
                    "procedimento": nome_proc,
                    "basico": vals.get("basico"),
                    "classico": vals.get("classico"),
                    "avancado": vals.get("avancado"),
                    "ultra": vals.get("ultra"),
                }
            )
        linhas.sort(key=lambda x: str(x["codigo"] or "").casefold())

        sheet_name = sanitize_sheet_name(nome_cidade, used)
        ws = wb.create_sheet(sheet_name)
        write_planos_sheet(ws, cidades_txt=cidades_txt, linhas=linhas)
        abas += 1
        print(f"  Aba '{sheet_name}': {len(linhas)} procedimentos")

    out_dir = desktop_dir()
    out_path = out_dir / f"Tabelas_Planos_{date.today().isoformat()}.xlsx"
    wb.save(out_path)
    print(f"Salvo: {out_path} ({abas} abas)")
    print("Concluído.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
