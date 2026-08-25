import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { buscarDiferencaComCascataPlanos } from "../../../lib/comprasBuscarDiferencaPlanoCidade";

import { escolherValorVendaParaContexto } from "../../../lib/comprasEscolherValorVenda";

import {
  listarPlanoIdsDoSelecionadoParaCima,
  filtrarPlanosParaSelecaoGeral,
  mapearPlanos,
  nomePlanoPorId,
} from "../../../lib/planosHierarquia";

import {
  buscarPrestadoresQuemRealiza,
  carregarDadosCredenciamentoQuemRealiza,
} from "../../../lib/buscarQuemRealizaPrestadores.js";

import { UFS_BRASIL, buscarMunicipiosPorUf } from "../../../lib/ibgeLocalidades.js";

import {
  buscarCidadeIdsFiltroPlanoCredenciados,
  filtrarCidadesTabelaPorIds,
  ufsDisponiveisFiltroCredenciamento,
} from "../../../lib/cidadesSupertabelaVinculos.js";

import { buscarTodosPaginado, supabase } from "../../../lib/supabase";
import { PageHeader } from "../../../components/ui";
import SelectMunicipioBusca from "../../../components/SelectMunicipioBusca/SelectMunicipioBusca.jsx";
import SelectUfBusca from "../../../components/SelectUfBusca/SelectUfBusca.jsx";

import "./ComprasOrcamento.css";

const normalizarTexto = (texto) =>
  String(texto || "")
    .normalize("NFD")

    .replace(/[\u0300-\u036f]/g, "")

    .trim()

    .toUpperCase();

const normalizarCod = (cod) =>
  String(cod || "")
    .trim()
    .toUpperCase();

const normalizarNomeCidade = (texto) =>
  String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

const formatarValorOrcamento = (valor) => {
  if (valor == null || Number.isNaN(Number(valor))) return "—";
  return Number(valor).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
};

const montarTextoCopiaRapidaOrcamento = ({ linhas, nomePlano }) => {
  const itens = Array.isArray(linhas) ? linhas : [];
  const planoLabel = String(nomePlano || "").trim() || "—";

  const linhasCompra = itens.map((row) => {
    const nome = String(row.nome || row.codigo || "Procedimento").trim();
    const q = Math.max(1, Number(row.quantidade || 1));
    const rotulo = q > 1 ? `${nome} (x${q})` : nome;
    return `${rotulo} - ${formatarValorOrcamento(row.totalCompra)}`;
  });

  const linhasDiff = itens.map((row) => {
    const nome = String(row.nome || row.codigo || "Procedimento").trim();
    const q = Math.max(1, Number(row.quantidade || 1));
    const rotulo = q > 1 ? `${nome} (x${q})` : nome;
    return `${rotulo} - ${formatarValorOrcamento(row.totalCoparticipacao)}`;
  });

  const totalGasto = itens.reduce((acc, row) => {
    const compra = row.totalCompra != null ? Number(row.totalCompra) : 0;
    const cop = row.totalCoparticipacao != null ? Number(row.totalCoparticipacao) : 0;
    return acc + compra + cop;
  }, 0);

  return [
    "Segue o seu orçamento de compra de procedimentos:",
    "Valor de Compra:",
    ...linhasCompra,
    "",
    `Valor de Diferença Plano [${planoLabel}]:`,
    ...linhasDiff,
    "",
    `Total gasto: ${formatarValorOrcamento(totalGasto)}`,
  ].join("\n");
};

const ComprasOrcamento = () => {
  const calcLiveIdRef = useRef(0);

  const credenciamentoCacheRef = useRef(null);

  const [quemRealizaLoading, setQuemRealizaLoading] = useState(false);

  const [quemRealizaLista, setQuemRealizaLista] = useState([]);

  const [loading, setLoading] = useState(false);

  const [erro, setErro] = useState("");

  const [headerCompacto, setHeaderCompacto] = useState(false);

  const [procedimentos, setProcedimentos] = useState([]);

  const [vendas, setVendas] = useState([]);

  const [planos, setPlanos] = useState([]);

  const [cidades, setCidades] = useState([]);

  const [idsFiltroPlanoCidade, setIdsFiltroPlanoCidade] = useState(null);

  const [buscaProc, setBuscaProc] = useState("");

  const [carrinho, setCarrinho] = useState([]);

  const [ufComprador, setUfComprador] = useState("");

  const [nomesMunicipiosUf, setNomesMunicipiosUf] = useState(null);

  const [cidadeCompradorId, setCidadeCompradorId] = useState("");

  const [planoCompradorId, setPlanoCompradorId] = useState("");

  const [resultado, setResultado] = useState(null);

  const [gerando, setGerando] = useState(false);

  /** Rascunho da quantidade por cartId enquanto o utilizador digita (evita estado inválido no carrinho). */
  const [quantidadeRascunho, setQuantidadeRascunho] = useState({});

  const [copiaFeedback, setCopiaFeedback] = useState("");

  const mapaPlanos = useMemo(() => mapearPlanos(planos), [planos]);

  const contextoComprador = useMemo(
    () => ({
      uf: ufComprador,
      cidadeId: cidadeCompradorId,
    }),
    [ufComprador, cidadeCompradorId],
  );

  const codigosComValorVenda = useMemo(() => {
    const s = new Set();
    const cods = new Set(
      (vendas || []).map((v) => normalizarCod(v.cod_procedimento)).filter(Boolean),
    );
    for (const cod of cods) {
      const { valor } = escolherValorVendaParaContexto(cod, vendas, contextoComprador);
      if (valor != null) s.add(cod);
    }
    return s;
  }, [vendas, contextoComprador]);

  useEffect(() => {
    if (!ufComprador) {
      setNomesMunicipiosUf(null);
      return undefined;
    }
    let cancelado = false;
    buscarMunicipiosPorUf(ufComprador)
      .then((lista) => {
        if (cancelado) return;
        setNomesMunicipiosUf(
          new Set(lista.map((m) => normalizarNomeCidade(m.nome))),
        );
      })
      .catch(() => {
        if (!cancelado) setNomesMunicipiosUf(new Set());
      });
    return () => {
      cancelado = true;
    };
  }, [ufComprador]);

  const ufsPermitidasCredenciamento = useMemo(() => {
    const set = ufsDisponiveisFiltroCredenciamento(cidades, idsFiltroPlanoCidade);
    return UFS_BRASIL.filter((sigla) => set.has(sigla));
  }, [cidades, idsFiltroPlanoCidade]);

  const cidadesFiltradasUf = useMemo(() => {
    if (!ufComprador || !nomesMunicipiosUf) return [];
    const naUf = filtrarCidadesTabelaPorIds(cidades, idsFiltroPlanoCidade).filter(
      (c) => String(c.uf || "").trim().toUpperCase() === ufComprador,
    );
    return naUf.filter((c) =>
      nomesMunicipiosUf.has(normalizarNomeCidade(c.nome)),
    );
  }, [cidades, ufComprador, nomesMunicipiosUf, idsFiltroPlanoCidade]);

  useEffect(() => {
    let cancelado = false;
    const run = async () => {
      try {
        const ids = await buscarCidadeIdsFiltroPlanoCredenciados(
          supabase,
          planoCompradorId || null,
          buscarTodosPaginado,
        );
        if (!cancelado) setIdsFiltroPlanoCidade(ids);
      } catch {
        if (!cancelado) setIdsFiltroPlanoCidade(new Set());
      }
    };
    void run();
    return () => {
      cancelado = true;
    };
  }, [planoCompradorId]);

  useEffect(() => {
    if (!cidadeCompradorId) return;
    const ok = cidadesFiltradasUf.some(
      (c) => String(c.id) === String(cidadeCompradorId),
    );
    if (!ok) setCidadeCompradorId("");
  }, [cidadeCompradorId, cidadesFiltradasUf]);

  const sugestoesProcedimentos = useMemo(() => {
    const termo = normalizarTexto(buscaProc);

    if (!termo) return [];

    return procedimentos

      .filter((p) => {
        if (!codigosComValorVenda.has(normalizarCod(p.codigo))) return false;

        const cod = normalizarTexto(p.codigo);

        const nome = normalizarTexto(p.nome);

        return cod.includes(termo) || nome.includes(termo);
      })

      .slice(0, 24);
  }, [buscaProc, procedimentos, codigosComValorVenda]);

  const resultadoPorCartId = useMemo(() => {
    const mapa = new Map();

    for (const r of resultado || []) {
      mapa.set(r.cartId, r);
    }

    return mapa;
  }, [resultado]);

  const carregarBase = useCallback(async () => {
    setLoading(true);

    setErro("");

    try {
      const [
        { data: procData, error: errProc },
        { data: vendasData, error: errVendas },
        planResp,
        cidResp,
      ] = await Promise.all([
        buscarTodosPaginado(() =>
          supabase
            .from("procedimentos")
            .select("codigo, nome")
            .order("codigo", { ascending: true }),
        ),

        buscarTodosPaginado(() =>
          supabase
            .from("servico_valor_venda")
            .select("id, cod_procedimento, valor_venda, uf, cidade_id"),
        ),

        supabase
          .from("planos")
          .select("id, nome")
          .order("id", { ascending: true }),

        supabase
          .from("cidades")
          .select("id, nome, uf")
          .order("nome", { ascending: true }),
      ]);

      const mensagens = [];

      if (errProc) mensagens.push(`Procedimentos: ${errProc.message}`);
      else setProcedimentos(procData || []);

      if (errVendas) {
        mensagens.push(`Valores de venda: ${errVendas.message}`);

        setVendas([]);
      } else setVendas(vendasData || []);

      if (planResp.error) mensagens.push(`Planos: ${planResp.error.message}`);
      else {
        const lista = planResp.data || [];
        setPlanos(filtrarPlanosParaSelecaoGeral(lista, mapearPlanos(lista)));
      }

      if (cidResp.error) mensagens.push(`Cidades: ${cidResp.error.message}`);
      else setCidades(cidResp.data || []);

      if (mensagens.length) setErro(mensagens.join(" | "));
      else setErro("");
    } catch (error) {
      setErro(error?.message || "Falha ao carregar dados.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    carregarBase();
  }, [carregarBase]);

  useEffect(() => {
    const onScroll = () => setHeaderCompacto(window.scrollY > 22);

    onScroll();

    window.addEventListener("scroll", onScroll, { passive: true });

    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const calcularOrcamentoLive = useCallback(async () => {
    const reqId = ++calcLiveIdRef.current;

    const isLatest = () => reqId === calcLiveIdRef.current;

    if (!ufComprador || !cidadeCompradorId || !planoCompradorId || !carrinho.length) {
      setResultado(null);

      if (isLatest()) setGerando(false);

      return;
    }

    setGerando(true);

    try {
      const planoIds = listarPlanoIdsDoSelecionadoParaCima(
        Number(planoCompradorId),
        mapaPlanos,
      );

      const linhas = [];

      for (const item of carrinho) {
        const cod = normalizarCod(item.codigo);

        const { valor: valorContexto } = escolherValorVendaParaContexto(
          cod,
          vendas,
          contextoComprador,
        );

        const valorVenda =
          valorContexto != null ? valorContexto : Number(item.valorVenda || 0);

        const diffRes = await buscarDiferencaComCascataPlanos(supabase, {
          procedimentoCod: cod,
          cidadeId: cidadeCompradorId ? Number(cidadeCompradorId) : null,
          uf: ufComprador,
          planoIdsOrdenados: planoIds,
        });

        const dif = diffRes.encontrado ? diffRes.diferenca : null;

        const planoUsadoNome = diffRes.planoUtilizadoId
          ? nomePlanoPorId(diffRes.planoUtilizadoId, planos, mapaPlanos)
          : "—";

        const q = Math.max(0, Number(item.quantidade || 0));

        if (q === 0) continue;

        const valorCompraUn =
          valorVenda != null ? Number(valorVenda) : null;

        const totalCompra =
          valorCompraUn != null ? valorCompraUn * q : null;

        const totalCoparticipacao =
          dif != null ? Number(dif) * q : null;

        linhas.push({
          cartId: item.cartId,

          codigo: cod,

          nome: item.nome,

          quantidade: q,

          valorVenda,

          valorPlanoCidade: dif,

          planoUsadoNome,

          origem: diffRes.origem,

          totalCompra,

          totalCoparticipacao,
        });
      }

      if (isLatest()) {
        setResultado(linhas);

        setErro("");
      }
    } catch (error) {
      if (isLatest()) {
        setErro(error?.message || "Erro ao calcular orçamento.");

        setResultado(null);
      }
    } finally {
      if (isLatest()) setGerando(false);
    }
  }, [
    cidadeCompradorId,
    planoCompradorId,
    carrinho,
    vendas,
    mapaPlanos,
    planos,
    contextoComprador,
    ufComprador,
  ]);

  useEffect(() => {
    void calcularOrcamentoLive();
  }, [calcularOrcamentoLive]);

  const adicionarAoCarrinho = (proc) => {
    const codigo = normalizarCod(proc.codigo);

    if (!codigo) return;

    if (!codigosComValorVenda.has(codigo)) return;

    setCarrinho((atual) => {
      const idx = atual.findIndex(
        (item) => normalizarCod(item.codigo) === codigo,
      );

      if (idx >= 0) {
        const copia = [...atual];

        copia[idx] = {
          ...copia[idx],
          quantidade: Number(copia[idx].quantidade || 1) + 1,
        };

        return copia;
      }

      const escolha = escolherValorVendaParaContexto(codigo, vendas, contextoComprador);

      return [
        ...atual,

        {
          cartId: `${codigo}-${Date.now()}`,

          codigo,

          nome: proc.nome || codigo,

          quantidade: 1,

          valorVenda: escolha.valor != null ? escolha.valor : null,
        },
      ];
    });

    setBuscaProc("");
  };

  const alterarQuantidade = (cartId, delta) => {
    setQuantidadeRascunho((prev) => {
      const { [cartId]: _, ...rest } = prev;
      return rest;
    });

    setCarrinho((atual) => {
      const item = atual.find((i) => i.cartId === cartId);
      if (!item) return atual;

      const cur = Number(item.quantidade ?? 1);
      const next = cur + delta;

      if (next <= 0) {
        return atual.filter((i) => i.cartId !== cartId);
      }

      return atual.map((i) =>
        i.cartId === cartId ? { ...i, quantidade: next } : i,
      );
    });
  };

  const obterTextoQuantidadeInput = (item) => {
    const r = quantidadeRascunho[item.cartId];
    if (r !== undefined) return r;
    return String(Math.max(0, Number(item.quantidade ?? 0)));
  };

  const onQuantidadeFocus = (item) => {
    setQuantidadeRascunho((prev) => ({
      ...prev,
      [item.cartId]: String(Math.max(0, Number(item.quantidade ?? 0))),
    }));
  };

  const onQuantidadeChange = (cartId, valor) => {
    const digitos = String(valor || "").replace(/\D/g, "");

    setQuantidadeRascunho((prev) => ({ ...prev, [cartId]: digitos }));

    if (digitos === "") return;

    const n = parseInt(digitos, 10);

    if (Number.isNaN(n)) return;

    if (n === 0) {
      setCarrinho((atual) => atual.filter((i) => i.cartId !== cartId));
      setQuantidadeRascunho((prev) => {
        const { [cartId]: _, ...rest } = prev;
        return rest;
      });
      return;
    }

    const clamped = Math.min(n, 999_999);

    setCarrinho((atual) =>
      atual.map((item) =>
        item.cartId === cartId ? { ...item, quantidade: clamped } : item,
      ),
    );
  };

  const commitQuantidade = (cartId) => {
    const bruto = quantidadeRascunho[cartId];

    setQuantidadeRascunho((prev) => {
      const { [cartId]: _, ...rest } = prev;
      return rest;
    });

    if (bruto === undefined) return;

    const n = bruto === "" ? 0 : parseInt(bruto, 10);

    if (Number.isNaN(n) || n <= 0) {
      setCarrinho((atual) => atual.filter((i) => i.cartId !== cartId));
      return;
    }

    const clamped = Math.min(n, 999_999);

    setCarrinho((atual) =>
      atual.map((item) =>
        item.cartId === cartId ? { ...item, quantidade: clamped } : item,
      ),
    );
  };

  const limparCarrinho = () => {
    setQuantidadeRascunho({});
    setCarrinho([]);
  };

  const totalCompraQty = useMemo(
    () =>
      (resultado || []).reduce(
        (acc, row) =>
          acc +
          (row.totalCompra != null ? Number(row.totalCompra) : 0),
        0,
      ),

    [resultado],
  );

  const totalCoparticipacaoQty = useMemo(
    () =>
      (resultado || []).reduce(
        (acc, row) =>
          acc +
          (row.totalCoparticipacao != null
            ? Number(row.totalCoparticipacao)
            : 0),
        0,
      ),

    [resultado],
  );

  const nomePlanoComprador = useMemo(
    () =>
      planoCompradorId
        ? nomePlanoPorId(Number(planoCompradorId), planos, mapaPlanos)
        : "",
    [planoCompradorId, planos, mapaPlanos],
  );

  const podeCopiarOrcamento =
    Boolean(resultado?.length) && !gerando && !loading;

  const copiarOrcamentoRapido = async () => {
    if (!podeCopiarOrcamento) return;
    const texto = montarTextoCopiaRapidaOrcamento({
      linhas: resultado,
      nomePlano: nomePlanoComprador,
    });
    try {
      await navigator.clipboard.writeText(texto);
      setCopiaFeedback("Copiado!");
      window.setTimeout(() => setCopiaFeedback(""), 2000);
    } catch {
      setErro("Não foi possível copiar o orçamento. Verifique a permissão da área de transferência.");
    }
  };

  const mensagemContexto = () => {
    if (!ufComprador || !cidadeCompradorId || !planoCompradorId)
      return "Selecione UF, cidade e plano do comprador para preencher coparticipação e totais.";

    return null;
  };

  const ctxMsg = mensagemContexto();

  const cidadeCompradorNome = useMemo(() => {
    const c = cidades.find(
      (item) => String(item.id) === String(cidadeCompradorId),
    );
    return c?.nome || "";
  }, [cidades, cidadeCompradorId]);

  const codigosOrcamento = useMemo(
    () =>
      carrinho
        .map((item) => normalizarCod(item.codigo))
        .filter(Boolean),
    [carrinho],
  );

  const chaveQuemRealiza = useMemo(() => {
    if (!ufComprador || !cidadeCompradorId || !codigosOrcamento.length) return "";
    const cods = [...codigosOrcamento].sort().join(",");
    return `${ufComprador}|${cidadeCompradorId}|${cods}`;
  }, [ufComprador, cidadeCompradorId, codigosOrcamento]);

  const mostrarQuemRealiza =
    Boolean(chaveQuemRealiza) &&
    (Boolean(resultado?.length) || quemRealizaLista.length > 0);

  useEffect(() => {
    if (!chaveQuemRealiza) {
      setQuemRealizaLista([]);
      return undefined;
    }

    let cancelado = false;

    const run = async () => {
      setQuemRealizaLoading(true);
      try {
        if (!credenciamentoCacheRef.current) {
          credenciamentoCacheRef.current =
            await carregarDadosCredenciamentoQuemRealiza(supabase, {
              somenteVeterinarios: false,
            });
        }
        const lista = await buscarPrestadoresQuemRealiza(supabase, {
          codigosProcedimento: codigosOrcamento,
          cidadesAlvo: [{ nome: cidadeCompradorNome, uf: ufComprador }],
          incluirCidadesParalelas: true,
          somenteVeterinarios: false,
          dadosCredenciamento: credenciamentoCacheRef.current,
        });
        if (!cancelado) setQuemRealizaLista(lista);
      } catch {
        if (!cancelado) setQuemRealizaLista([]);
      } finally {
        if (!cancelado) setQuemRealizaLoading(false);
      }
    };

    void run();

    return () => {
      cancelado = true;
    };
  }, [chaveQuemRealiza, cidadeCompradorNome, ufComprador]);

  return (
    <div className="el-legacy-wrap compras_orc">
      <PageHeader
        kicker="Compras"
        title="Orçamento"
        description="Monte orçamentos com valores de compra, diferença de plano e quem realiza."
      />

      <header
        className={`compras_orc_header ${headerCompacto ? "is-compact" : ""}`}
      >
        

        <div className="compras_orc_filtros_flutuantes">
          <div className="compras_orc_filtros_inner">
            <div className="compras_orc_filtro_item compras_orc_filtro_busca">
              <p className="compras_orc_filtro_label">Adicionar Procedimento</p>

              <div className="compras_orc_busca_wrap">
                <input
                  className="compras_orc_input"
                  type="search"
                  value={buscaProc}
                  onChange={(e) => setBuscaProc(e.target.value)}
                  placeholder="Código ou nome — apenas procedimentos que estão na lojinha"
                  autoComplete="off"
                />

                {sugestoesProcedimentos.length > 0 && (
                  <ul
                    className="compras_orc_sugestoes compras_orc_sugestoes_docked"
                    role="listbox"
                  >
                    {sugestoesProcedimentos.map((p) => (
                      <li key={p.codigo}>
                        <button
                          type="button"
                          onClick={() => adicionarAoCarrinho(p)}
                        >
                          <strong>{p.codigo}</strong> — {p.nome}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <label className="compras_orc_filtro_item">
              <span className="compras_orc_filtro_label">UF</span>
              <SelectUfBusca
                value={ufComprador}
                ufs={ufsPermitidasCredenciamento}
                inputClassName="compras_orc_select"
                emptyLabel="Selecione"
                placeholder="Selecione"
                onChange={(u) => {
                  setUfComprador(u);
                  setCidadeCompradorId("");
                }}
              />
            </label>

            <label className="compras_orc_filtro_item">
              <span className="compras_orc_filtro_label">Cidade</span>

              <SelectMunicipioBusca
                value={cidadeCompradorId == null ? "" : String(cidadeCompradorId)}
                valueKey="id"
                options={cidadesFiltradasUf}
                disabled={!ufComprador || !nomesMunicipiosUf}
                loading={Boolean(ufComprador && !nomesMunicipiosUf)}
                inputClassName="compras_orc_select"
                placeholder={
                  !ufComprador ? "Selecione a UF" : "Buscar cidade…"
                }
                onChange={setCidadeCompradorId}
              />
            </label>

            <label className="compras_orc_filtro_item">
              <span className="compras_orc_filtro_label">
                Plano do comprador
              </span>

              <select
                className="compras_orc_select"
                value={planoCompradorId}
                onChange={(e) => setPlanoCompradorId(e.target.value)}
              >
                <option value="">Selecione</option>

                {planos.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.nome}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </header>

      {erro && (
        <div className="compras_orc_alert" role="alert">
          <span>{erro}</span>

          <button type="button" onClick={() => setErro("")}>
            x
          </button>
        </div>
      )}

      {loading ? (
        <p>Carregando...</p>
      ) : (
        <section className="compras_orc_main_card">
          <div className="compras_orc_main_head">
            <h2 className="compras_orc_main_titulo">Itens do orçamento</h2>

            <div className="compras_orc_main_head_actions">
              {gerando && (
                <span className="compras_orc_calc_badge">Calculando…</span>
              )}

              {copiaFeedback && (
                <span className="compras_orc_copia_feedback" role="status">
                  {copiaFeedback}
                </span>
              )}

              <button
                type="button"
                className="compras_orc_btn"
                disabled={!podeCopiarOrcamento}
                onClick={() => void copiarOrcamentoRapido()}
                title={
                  podeCopiarOrcamento
                    ? "Copiar orçamento formatado para colar no WhatsApp / email"
                    : "Calcule o orçamento (UF, cidade, plano e itens) para copiar"
                }
              >
                Copiar orçamento
              </button>

              <button
                type="button"
                className="compras_orc_btn secondary"
                disabled={!carrinho.length}
                onClick={limparCarrinho}
              >
                Limpar carrinho
              </button>
            </div>
          </div>

          {ctxMsg && carrinho.length > 0 && (
            <p className="compras_orc_ctx_msg">{ctxMsg}</p>
          )}

          {carrinho.length > 0 && (
            <p className="compras_orc_remove_hint">
              Para retirar um procedimento do orçamento, defina a quantidade em{" "}
              <strong>0</strong> (ou use o botão − até remover).
            </p>
          )}

          {carrinho.length === 0 ? (
            <p className="compras_orc_empty">
              Nenhum procedimento no orçamento. Use a busca acima para
              adicionar.
            </p>
          ) : (
            <div className="compras_orc_table_wrap overflow-x-auto">
              <table className="table_main compras_orc_table_orc">
                <colgroup>
                  <col className="compras_orc_col_proc" />

                  <col className="compras_orc_col_num" />

                  <col className="compras_orc_col_num" />

                  <col className="compras_orc_col_plano" />

                  <col className="compras_orc_col_qty" />

                  <col className="compras_orc_col_num" />

                  <col className="compras_orc_col_num" />
                </colgroup>

                <thead>
                  <tr>
                    <th className="table_header table_header_no_sort">
                      Procedimento
                    </th>

                    <th className="table_header table_header_no_sort compras_orc_col_mid">
                      Valor de Compra (Un)
                    </th>

                    <th className="table_header table_header_no_sort compras_orc_col_mid">
                      Coparticipação (Un)
                    </th>

                    <th className="table_header table_header_no_sort compras_orc_col_mid">
                      Plano da Coparticipação
                    </th>

                    <th className="table_header table_header_no_sort compras_orc_col_mid">
                      Quantidade
                    </th>

                    <th className="table_header table_header_no_sort compras_orc_col_mid">
                      Total Compra
                    </th>

                    <th className="table_header table_header_no_sort compras_orc_col_mid">
                      Total Cop.
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {carrinho.map((item) => {
                    const calc = resultadoPorCartId.get(item.cartId);

                    const valorCompraExib =
                      calc?.valorVenda != null
                        ? Number(calc.valorVenda)
                        : item.valorVenda != null
                          ? Number(item.valorVenda)
                          : null;

                    const copUn =
                      !gerando && calc?.valorPlanoCidade != null
                        ? Number(calc.valorPlanoCidade)
                        : null;

                    const totalCompraExib =
                      !gerando && calc?.totalCompra != null
                        ? Number(calc.totalCompra)
                        : null;

                    const totalCopExib =
                      !gerando && calc?.totalCoparticipacao != null
                        ? Number(calc.totalCoparticipacao)
                        : null;

                    return (
                      <tr key={item.cartId}>
                        <td className="table_text_left compras_orc_td_proc_full">
                          <span className="compras_orc_proc_nome">{item.nome}</span>
                        </td>

                        <td className="compras_orc_td_num compras_orc_col_mid">
                          {valorCompraExib != null
                            ? valorCompraExib.toFixed(2)
                            : "—"}
                        </td>

                        <td className="compras_orc_td_num compras_orc_col_mid">
                          {gerando
                            ? "…"
                            : copUn != null
                              ? copUn.toFixed(2)
                              : "—"}
                        </td>

                        <td className="compras_orc_td_plano compras_orc_col_mid">
                          {!gerando && calc?.planoUsadoNome
                            ? calc.planoUsadoNome
                            : gerando
                              ? "…"
                              : "—"}
                        </td>

                        <td className="compras_orc_td_qty compras_orc_col_mid">
                          <span className="compras_orc_qty_row">
                            <button
                              type="button"
                              className="compras_orc_btn secondary compras_orc_qty_btn"
                              onClick={() => alterarQuantidade(item.cartId, -1)}
                              aria-label="Diminuir quantidade"
                            >
                              −
                            </button>

                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              className="compras_orc_qty_input"
                              aria-label="Quantidade"
                              value={obterTextoQuantidadeInput(item)}
                              onFocus={() => onQuantidadeFocus(item)}
                              onChange={(e) =>
                                onQuantidadeChange(item.cartId, e.target.value)
                              }
                              onBlur={() => commitQuantidade(item.cartId)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  commitQuantidade(item.cartId);
                                  e.target.blur();
                                }
                              }}
                            />

                            <button
                              type="button"
                              className="compras_orc_btn secondary compras_orc_qty_btn"
                              onClick={() => alterarQuantidade(item.cartId, 1)}
                              aria-label="Aumentar quantidade"
                            >
                              +
                            </button>
                          </span>
                        </td>

                        <td className="compras_orc_td_num compras_orc_col_mid">
                          {gerando
                            ? "…"
                            : totalCompraExib != null
                              ? totalCompraExib.toFixed(2)
                              : "—"}
                        </td>

                        <td className="compras_orc_td_num compras_orc_col_mid">
                          {gerando
                            ? "…"
                            : totalCopExib != null
                              ? totalCopExib.toFixed(2)
                              : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>

                <tfoot>
                  <tr className="compras_orc_tfoot_row">
                    <td colSpan={5} className="compras_orc_subtotal_cell compras_orc_col_mid">
                      <div className="compras_orc_subtotal_inner_centered">
                        <strong>Totais</strong>

                        <span className="compras_orc_subtotal_hint">
                          {" "}
                          (soma das colunas Total Compra e Total Cop.)
                        </span>
                      </div>
                    </td>

                    <td className="compras_orc_td_num compras_orc_tfoot_num compras_orc_col_mid">
                      <strong>
                        {resultado && !gerando
                          ? totalCompraQty.toFixed(2)
                          : "—"}
                      </strong>
                    </td>

                    <td className="compras_orc_td_num compras_orc_tfoot_num compras_orc_col_mid">
                      <strong>
                        {resultado && !gerando
                          ? totalCoparticipacaoQty.toFixed(2)
                          : "—"}
                      </strong>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>
      )}

      {mostrarQuemRealiza && (
        <section className="compras_orc_quem_realiza" aria-labelledby="compras_orc_quem_titulo">
          <h2 id="compras_orc_quem_titulo" className="compras_orc_quem_titulo">
            Conferir quem realiza
          </h2>
          {quemRealizaLoading ? (
            <p className="compras_orc_quem_muted">A carregar prestadores…</p>
          ) : quemRealizaLista.length === 0 ? (
            <p className="compras_orc_quem_muted">
              Nenhum veterinário encontrado para estes procedimentos nesta cidade.
            </p>
          ) : (
            <div className="compras_orc_quem_cards">
              {quemRealizaLista.map((r) => (
                <article key={r.id} className="compras_orc_quem_card">
                  {r.viaCidadeParalela && (
                    <span
                      className="compras_orc_quem_badge"
                      title={`Atende em ${cidadeCompradorNome} (cidade paralela). Cidade principal: ${r.cidadePrincipal}`}
                    >
                      {r.cidadePrincipal}
                    </span>
                  )}
                  <div className="compras_orc_quem_card_meta">
                    <div className="compras_orc_quem_card_meta_item compras_orc_quem_card_meta_nome">
                      <span className="compras_orc_quem_lbl">Nome</span>
                      <span className="compras_orc_quem_val compras_orc_quem_val_nome">{r.nome}</span>
                    </div>
                    <div className="compras_orc_quem_card_meta_row">
                      <div className="compras_orc_quem_card_meta_item">
                        <span className="compras_orc_quem_lbl">Especialidade</span>
                        <span className="compras_orc_quem_val">{r.especialidade}</span>
                      </div>
                      <div className="compras_orc_quem_card_meta_item">
                        <span className="compras_orc_quem_lbl">Telefone</span>
                        <span className="compras_orc_quem_val">{r.telefone}</span>
                      </div>
                    </div>
                  </div>
                  <ul className="compras_orc_quem_procs">
                    {r.procedimentos.map((proc) => (
                      <li key={`${r.id}-${proc.nomeBase}-${proc.nomeAlt || ''}`}>
                        <span className="compras_orc_quem_proc_base">{proc.nomeBase}</span>
                        {proc.nomeAlt ? (
                          <>
                            {' — '}
                            <span className="compras_orc_quem_proc_alt">{proc.nomeAlt}</span>
                          </>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
};

export default ComprasOrcamento;
