import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import { wire } from "../../shared/wire.js";
import { registerPartnerAuth, partnerFrom } from "./auth.js";
import { CategorySchema, errors, JobSchema, ReportSchema } from "./schemas.js";
import {
  DateOnly,
  IdParams,
  NonBlank,
  PageQuery,
} from "../../shared/schemas.js";
import { pagination } from "../../shared/pagination.js";
import { BusinessError } from "../../shared/errors.js";
import { EquipmentList } from "../lots/routes.js";
import { createLot } from "../lots/service.js";
import { generateAnalytics } from "../analytics/service.js";
import { enqueue, jobStatus, toCsv } from "../jobs/service.js";

const notFound = () =>
  new BusinessError(
    404,
    "NAO_ENCONTRADO",
    "Recurso não encontrado nesta organização.",
  );

export async function registerPublicRoutes(
  instance: FastifyInstance,
  db: PrismaClient,
) {
  // Limite amplo por IP antes da consulta de credencial; o limite contratual é por chave.
  const ipLimit = instance.createRateLimit({
    max: 3000,
    timeWindow: "1 minute",
    keyGenerator: (request) => `ip:${request.ip}`,
  });
  instance.addHook("onRequest", async (request, reply) => {
    const result = await ipLimit(request);
    if (!result.isAllowed && result.isExceeded) {
      reply.header("Retry-After", Math.max(1, Math.ceil(result.ttl / 1000)));
      throw new BusinessError(
        429,
        "LIMITE_EXCEDIDO",
        "Limite de requisições por IP excedido.",
      );
    }
  });
  registerPartnerAuth(instance, db);
  instance.addHook("onSend", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
  });
  instance.addHook(
    "preHandler",
    instance.rateLimit({
      max: (request) => request.partner?.limiteMinuto ?? 60,
      timeWindow: "1 minute",
      keyGenerator: (request) => request.partner?.id ?? request.ip,
    }),
  );
  const app = instance.withTypeProvider<TypeBoxTypeProvider>();
  const base = {
    tags: ["API pública v1"],
    security: [{ apiKey: [] }],
    response: errors,
  };
  app.get(
    "/lotes",
    {
      schema: {
        ...base,
        summary: "Listar somente os lotes da organização da chave",
        querystring: PageQuery,
        response: {
          ...errors,
          200: Type.Array(
            Type.Object({
              id: Type.String(),
              dataEntrada: Type.String(),
              statusProcessamento: Type.String(),
              notaFiscal: Type.String(),
              transportadora: Type.String(),
            }),
          ),
        },
      },
    },
    async (request) => {
      const key = partnerFrom(request, "rastreabilidade:ler");
      return wire(
        await db.lote.findMany({
          where: { organizacaoId: key.organizacaoId },
          ...pagination(request.query),
          orderBy: [{ dataEntrada: "desc" }, { id: "asc" }],
        }),
      );
    },
  );
  app.get(
    "/equipamentos/:id/rastreabilidade",
    {
      schema: {
        ...base,
        summary:
          "Consultar equipamento e eventos, sem dados pessoais de operadores",
        params: IdParams,
        response: {
          ...errors,
          200: Type.Object({
            id: Type.String(),
            codigoBarrasInterno: Type.String(),
            tipo: Type.String(),
            marca: Type.String(),
            modelo: Type.String(),
            estadoFisico: Type.String(),
            statusRastreamento: Type.String(),
            loteId: Type.String(),
            movimentacoes: Type.Array(
              Type.Object({
                dataHora: Type.String(),
                origem: Type.String(),
                destino: Type.String(),
                statusNovo: Type.String(),
                estadoFisicoNovo: Type.String(),
              }),
            ),
          }),
        },
      },
    },
    async (request) => {
      const key = partnerFrom(request, "rastreabilidade:ler");
      const item = await db.equipamento.findFirst({
        where: {
          id: request.params.id,
          lote: { organizacaoId: key.organizacaoId },
        },
        include: {
          movimentacoes: {
            orderBy: [{ dataHora: "asc" }, { versaoEquipamento: "asc" }],
          },
        },
      });
      if (!item) throw notFound();
      return wire(item);
    },
  );
  app.post(
    "/lotes",
    {
      schema: {
        ...base,
        summary: "Submeter lote à própria organização (1–100 equipamentos)",
        description:
          "A organização é derivada da chave; não é aceita no corpo. Usa as mesmas validações e transação da API interna. Duplicidade de código retorna 409, sem recebimento parcial.",
        body: Type.Object(
          {
            dataEntrada: DateOnly,
            notaFiscal: NonBlank(60),
            transportadora: NonBlank(200),
            observacoes: Type.Optional(NonBlank(2000)),
            equipamentos: EquipmentList,
          },
          { additionalProperties: false },
        ),
        response: {
          ...errors,
          201: Type.Object({
            id: Type.String(),
            statusProcessamento: Type.String(),
            equipamentos: Type.Array(
              Type.Object({
                id: Type.String(),
                codigoBarrasInterno: Type.String(),
              }),
            ),
          }),
        },
      },
    },
    async (request, reply) => {
      const key = partnerFrom(request, "lotes:escrever");
      return reply
        .code(201)
        .send(
          await createLot(
            db,
            { id: key.criadaPorId, papel: "OPERADOR_ALMOXARIFADO" },
            { ...request.body, organizacaoId: key.organizacaoId },
          ),
        );
    },
  );
  app.post(
    "/analises/:categoria",
    {
      schema: {
        ...base,
        summary: "Calcular análise e persistir fotografia histórica",
        description:
          "Para volumes grandes, prefira POST /relatorios (assíncrono). Não inventa previsão quando faltam amostras.",
        params: Type.Object(
          { categoria: CategorySchema },
          { additionalProperties: false },
        ),
        response: { ...errors, 201: ReportSchema },
      },
    },
    async (request, reply) => {
      const key = partnerFrom(request, "analises:ler");
      return reply
        .code(201)
        .send(
          wire(
            await generateAnalytics(
              db,
              key.organizacaoId,
              request.params.categoria,
            ),
          ),
        );
    },
  );
  app.get(
    "/analises/historico",
    {
      schema: {
        ...base,
        summary: "Consultar fotografias anteriores da própria organização",
        querystring: PageQuery,
        response: { ...errors, 200: Type.Array(ReportSchema) },
      },
    },
    async (request) => {
      const key = partnerFrom(request, "analises:ler");
      return wire(
        await db.relatorioAnalitico.findMany({
          where: { organizacaoId: key.organizacaoId },
          ...pagination(request.query),
          orderBy: [{ criadoEm: "desc" }, { id: "asc" }],
        }),
      );
    },
  );
  app.post(
    "/relatorios",
    {
      schema: {
        ...base,
        summary: "Enfileirar relatório; resposta imediata 202 com Location",
        body: Type.Object(
          {
            categoria: CategorySchema,
            formato: Type.Optional(
              Type.Union([Type.Literal("json"), Type.Literal("csv")]),
            ),
          },
          {
            additionalProperties: false,
            examples: [{ categoria: "completo", formato: "csv" }],
          },
        ),
        response: { ...errors, 202: JobSchema },
      },
    },
    async (request, reply) => {
      const key = partnerFrom(request, "relatorios:gerar");
      const task = await enqueue(db, {
        ...request.body,
        organizacaoId: key.organizacaoId,
        chaveApiId: key.id,
      });
      return reply
        .code(202)
        .header("Location", `/api/v1/public/relatorios/${task.id}`)
        .header("Retry-After", "2")
        .send(jobStatus(task));
    },
  );
  app.get(
    "/relatorios/:id",
    {
      schema: {
        ...base,
        summary: "Consultar status da tarefa (polling)",
        params: IdParams,
        response: { ...errors, 200: JobSchema },
      },
    },
    async (request) => {
      const key = partnerFrom(request, "relatorios:gerar");
      const task = await db.tarefaRelatorio.findFirst({
        where: { id: request.params.id, organizacaoId: key.organizacaoId },
      });
      if (!task) throw notFound();
      return jobStatus(task);
    },
  );
  app.get(
    "/relatorios/:id/download",
    {
      schema: {
        ...base,
        summary: "Baixar JSON ou CSV somente após conclusão",
        params: IdParams,
        description:
          "409 enquanto não concluído ou em falha. CSV UTF-8 com BOM: colunas caminho,valor (estrutura hierárquica normalizada).",
        response: {
          ...errors,
          200: Type.Any({
            description:
              "application/json ou text/csv segundo formato solicitado.",
            examples: [{ categoria: "completo", equipamentos: 2 }],
          }),
        },
      },
    },
    async (request, reply) => {
      const key = partnerFrom(request, "relatorios:gerar");
      const task = await db.tarefaRelatorio.findFirst({
        where: { id: request.params.id, organizacaoId: key.organizacaoId },
        include: { relatorio: true },
      });
      if (!task) throw notFound();
      if (task.status !== "CONCLUIDO" || !task.relatorio)
        throw new BusinessError(
          409,
          "RELATORIO_INDISPONIVEL",
          "Consulte o status e aguarde a conclusão do relatório.",
        );
      reply
        .header(
          "Content-Disposition",
          `attachment; filename="relatorio-${task.id}.${task.formato}"`,
        )
        .header("Cache-Control", "no-store");
      return task.formato === "csv"
        ? reply
            .type("text/csv; charset=utf-8")
            .send(toCsv(task.relatorio.resultado))
        : reply.send(task.relatorio.resultado);
    },
  );
}
