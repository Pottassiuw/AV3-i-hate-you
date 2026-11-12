import { Prisma, type EstadoFisico, type PrismaClient } from "@prisma/client";
import { groupBy, regression, summary } from "./statistics.js";

export const categories = [
  "eficiencia",
  "rentabilidade",
  "vida-util",
  "completo",
] as const;
export type Category = (typeof categories)[number];
const health: Record<EstadoFisico, number> = {
  NOVO: 1,
  BOM_ESTADO: 0.9,
  USADO_LEVE: 0.75,
  USADO_MODERADO: 0.55,
  DANIFICADO_LEVE: 0.35,
  DANIFICADO_GRAVE: 0.1,
  INSERVIVEL: 0,
};
const day = 86_400_000;
const year = 365.25 * day;

export async function calculateAnalytics(
  db: PrismaClient,
  organizacaoId: string,
  categoria: Category,
) {
  // Uma fotografia consistente de parâmetros, lotes e histórico.
  return db.$transaction(
    async (tx) => {
      const now = new Date();
      const lots = await tx.lote.findMany({
        where: { organizacaoId },
        orderBy: { id: "asc" },
        include: {
          equipamentos: {
            orderBy: { id: "asc" },
            include: {
              movimentacoes: {
                orderBy: [{ dataHora: "asc" }, { versaoEquipamento: "asc" }],
              },
            },
          },
        },
      });
      const settings = await tx.parametrosSistema.findUniqueOrThrow({
        where: { id: 1 },
      });
      const items = lots.flatMap((lote) =>
        lote.equipamentos.map((e) => ({ ...e, entrada: lote.dataEntrada })),
      );
      const result: Record<string, unknown> = {
        referencia: now.toISOString(),
        organizacaoId,
        modeloVersao: "1.0.0",
        equipamentos: items.length,
        categoria,
      };
      if (categoria === "eficiencia" || categoria === "completo") {
        const completed = lots.filter(
          (l) =>
            l.equipamentos.length > 0 &&
            l.equipamentos.every((e) => e.triagemConcluidaEm),
        );
        const durations = completed.map((l) => ({
          loteId: l.id,
          mesEntrada: l.dataEntrada.toISOString().slice(0, 7),
          horas: Math.max(
            0,
            (Math.max(
              ...l.equipamentos.map((e) => e.triagemConcluidaEm!.getTime()),
            ) -
              l.dataEntrada.getTime()) /
              3_600_000,
          ),
        }));
        const operatorSamples = items
          .filter((e) => e.triagemConcluidaEm)
          .flatMap((e) => {
            const completion = e.movimentacoes.find(
              (m) =>
                m.statusAnterior === "EM_TRIAGEM" &&
                m.statusNovo === "AGUARDANDO_DESMONTE",
            );
            return completion
              ? [
                  {
                    responsavelId: completion.responsavelId,
                    horas: Math.max(
                      0,
                      (e.triagemConcluidaEm!.getTime() - e.entrada.getTime()) /
                        3_600_000,
                    ),
                  },
                ]
              : [];
          });
        const overall = summary(durations.map((d) => d.horas));
        result.eficiencia = {
          unidade: "horas corridas desde a data de entrada (UTC)",
          lotesConcluidos: completed.length,
          lotesAbertos: lots.length - completed.length,
          ...overall,
          porMes: groupBy(durations, (d) => d.mesEntrada).map(
            ([mes, rows]) => ({ mes, ...summary(rows.map((r) => r.horas)) }),
          ),
          porOperador: groupBy(operatorSamples, (d) => d.responsavelId).map(
            ([responsavelId, rows]) => ({
              responsavelId,
              ...summary(rows.map((r) => r.horas)),
            }),
          ),
          gargalos: lots
            .filter((l) => !completed.includes(l))
            .map((l) => ({
              loteId: l.id,
              status: l.statusProcessamento,
              horasEmAberto: Math.max(
                0,
                (now.getTime() - l.dataEntrada.getTime()) / 3_600_000,
              ),
            }))
            .sort((a, b) => b.horasEmAberto - a.horasEmAberto)
            .slice(0, 20),
          ressalva:
            "Por operador, unidade amostral é equipamento e atribuição é ao responsável pela conclusão; não mede exclusivamente seu tempo de trabalho. Entrada tem precisão de dia. Abertos não entram na média.",
        };
      }
      if (categoria === "rentabilidade" || categoria === "completo") {
        const active = items.filter(
          (e) => e.statusRastreamento !== "BAIXA_DEFINITIVA",
        );
        const rows = groupBy(active, (e) =>
          JSON.stringify([e.tipo, e.marca, e.modelo, e.estadoFisico]),
        )
          .map(([, group]) => {
            const first = group[0]!;
            const values = group.map((e) => {
              const age = Math.max(0, now.getUTCFullYear() - e.anoFabricacao);
              const depreciation = Prisma.Decimal.max(
                0,
                new Prisma.Decimal(1).minus(settings.depreciacaoAnual.mul(age)),
              );
              return e.pesoQuilogramas
                .mul(settings.valorBaseQuilograma)
                .mul(depreciation)
                .mul(health[e.estadoFisico])
                .toDecimalPlaces(2);
            });
            const gross = values.reduce(
              (s, v) => s.plus(v),
              new Prisma.Decimal(0),
            );
            const tax = gross.mul(settings.aliquotaImposto).toDecimalPlaces(2);
            return {
              tipo: first.tipo,
              marca: first.marca,
              modelo: first.modelo,
              estadoFisico: first.estadoFisico,
              quantidade: group.length,
              valorMedioRecuperacao: gross.div(group.length).toFixed(2),
              valorBruto: gross.toFixed(2),
              impostoEstimado: tax.toFixed(2),
              valorLiquido: gross.minus(tax).toFixed(2),
            };
          })
          .sort((a, b) =>
            new Prisma.Decimal(b.valorMedioRecuperacao).comparedTo(
              a.valorMedioRecuperacao,
            ),
          );
        result.rentabilidade = {
          moeda: "BRL",
          parametros: {
            depreciacaoAnual: settings.depreciacaoAnual.toString(),
            valorBaseQuilograma: settings.valorBaseQuilograma.toString(),
            aliquotaImposto: settings.aliquotaImposto.toString(),
            fatoresEstado: health,
          },
          grupos: rows,
          ressalva:
            "Recuperação estimada = peso × valor/kg × max(0, 1 − depreciação anual × idade) × fator de estado. Agrupada por tipo/marca/modelo/estado; não é lucro realizado: custos não estão cadastrados. Não há coeficiente comercial arbitrário por marca/modelo.",
        };
      }
      if (categoria === "vida-util" || categoria === "completo") {
        result.vidaUtil = {
          metodo:
            "MQO de saúde (0 a 1) em função da idade em anos; falhas INSERVIVEL correspondem a zero",
          grupos: groupBy(items, (e) => e.tipo).map(([tipo, group]) => {
            // Um ponto por equipamento/dia: não inflar a amostra com movimentações no mesmo dia.
            const observations = group.flatMap((e) => {
              const daily = new Map<string, (typeof e.movimentacoes)[number]>();
              for (const m of e.movimentacoes)
                daily.set(m.dataHora.toISOString().slice(0, 10), m);
              return [...daily.values()].map(
                (m) =>
                  [
                    Math.max(
                      0,
                      (m.dataHora.getTime() - Date.UTC(e.anoFabricacao, 0, 1)) /
                        year,
                    ),
                    health[m.estadoFisicoNovo],
                  ] as [number, number],
              );
            });
            const model = group.length >= 3 ? regression(observations) : null;
            const usable = model && model.slope < -0.000001;
            const failureAge = usable ? -model.intercept / model.slope : null;
            return {
              tipo,
              equipamentos: group.length,
              observacoes: observations.length,
              falhasObservadas: group.filter((e) =>
                e.movimentacoes.some(
                  (m) => m.estadoFisicoNovo === "INSERVIVEL",
                ),
              ).length,
              status: !model
                ? "DADOS_INSUFICIENTES"
                : !usable ||
                    failureAge === null ||
                    failureAge < 0 ||
                    failureAge > 100
                  ? "SEM_TENDENCIA_CONFIAVEL"
                  : "ESTIMADO",
              modelo: model,
              idadeInservivelAnos:
                failureAge !== null && failureAge >= 0 && failureAge <= 100
                  ? failureAge
                  : null,
              previsoes: group
                .filter((e) => e.statusRastreamento !== "BAIXA_DEFINITIVA")
                .map((e) => {
                  const remaining =
                    usable &&
                    failureAge !== null &&
                    failureAge >= 0 &&
                    failureAge <= 100
                      ? Math.max(
                          0,
                          failureAge -
                            (now.getTime() - Date.UTC(e.anoFabricacao, 0, 1)) /
                              year,
                        )
                      : null;
                  return {
                    equipamentoId: e.id,
                    anosRemanescentes:
                      e.estadoFisico === "INSERVIVEL" ? 0 : remaining,
                  };
                }),
            };
          }),
          ressalva:
            "Modelo exploratório, não garantia. Requer ≥3 equipamentos e idades distintas; ausência de degradação não produz data fictícia. Fabricação é aproximada por 1º de janeiro. Pontos do mesmo equipamento são correlacionados; viés de seleção e dados censurados não são corrigidos. R² não é probabilidade de acerto.",
        };
      }
      return JSON.parse(JSON.stringify(result)) as Prisma.InputJsonObject;
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 60_000,
    },
  );
}

export async function generateAnalytics(
  db: PrismaClient,
  organizacaoId: string,
  categoria: Category,
) {
  const resultado = await calculateAnalytics(db, organizacaoId, categoria);
  return db.relatorioAnalitico.create({
    data: { organizacaoId, categoria, resultado },
  });
}
