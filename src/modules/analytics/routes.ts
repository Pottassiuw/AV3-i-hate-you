import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import { wire } from "../../shared/wire.js";
import { CategorySchema, ReportSchema, errors } from "../partners/schemas.js";
import { generateAnalytics } from "./service.js";
import { PageFields } from "../../shared/schemas.js";
import { pagination } from "../../shared/pagination.js";
import { actorFrom } from "../../plugins/auth.js";
import { authorize } from "../../shared/permissions.js";
import { BusinessError } from "../../shared/errors.js";

export function registerAnalyticsRoutes(
  instance: FastifyInstance,
  db: PrismaClient,
) {
  const app = instance.withTypeProvider<TypeBoxTypeProvider>();
  const base = { tags: ["Análises internas"], security: [{ bearerAuth: [] }] };
  app.post(
    "/analises/:categoria",
    {
      schema: {
        ...base,
        summary: "Gerar e persistir análise de uma organização",
        params: Type.Object(
          { categoria: CategorySchema },
          { additionalProperties: false },
        ),
        body: Type.Object(
          { organizacaoId: Type.String({ format: "uuid" }) },
          { additionalProperties: false },
        ),
        response: { ...errors, 201: ReportSchema },
      },
    },
    async (request, reply) => {
      authorize(actorFrom(request), "consultar");
      const org = await db.organizacao.findUnique({
        where: { id: request.body.organizacaoId },
      });
      if (!org)
        throw new BusinessError(
          404,
          "NAO_ENCONTRADO",
          "Organização não encontrada.",
        );
      return reply
        .code(201)
        .send(
          wire(await generateAnalytics(db, org.id, request.params.categoria)),
        );
    },
  );
  app.get(
    "/analises/historico",
    {
      schema: {
        ...base,
        summary: "Consultar histórico analítico persistido",
        querystring: Type.Object(
          {
            ...PageFields,
            organizacaoId: Type.String({ format: "uuid" }),
            categoria: Type.Optional(CategorySchema),
          },
          { additionalProperties: false },
        ),
        response: { ...errors, 200: Type.Array(ReportSchema) },
      },
    },
    async (request) => {
      authorize(actorFrom(request), "consultar");
      return wire(
        await db.relatorioAnalitico.findMany({
          where: {
            organizacaoId: request.query.organizacaoId,
            categoria: request.query.categoria,
          },
          ...pagination(request.query),
          orderBy: [{ criadoEm: "desc" }, { id: "asc" }],
        }),
      );
    },
  );
}
