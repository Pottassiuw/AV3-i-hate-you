import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import { wire } from "../../shared/wire.js";
import { actorFrom } from "../../plugins/auth.js";
import { authorize } from "../../shared/permissions.js";
import { recordAudit } from "../../shared/audit.js";
import { BusinessError } from "../../shared/errors.js";
import { IdParams, NonBlank, PageQuery } from "../../shared/schemas.js";
import { pagination } from "../../shared/pagination.js";
import { hashKey, permissions } from "./auth.js";
import { errors } from "./schemas.js";

const safeSelect = {
  id: true,
  nome: true,
  prefixo: true,
  organizacaoId: true,
  permissoes: true,
  limiteMinuto: true,
  criadaEm: true,
  expiraEm: true,
  revogadaEm: true,
} as const;
const KeySchema = Type.Object({
  id: Type.String(),
  nome: Type.String(),
  prefixo: Type.String(),
  organizacaoId: Type.String(),
  permissoes: Type.Array(Type.String()),
  limiteMinuto: Type.Integer(),
  criadaEm: Type.String(),
  expiraEm: Type.String(),
  revogadaEm: Type.Union([Type.String(), Type.Null()]),
});
export function registerKeyRoutes(instance: FastifyInstance, db: PrismaClient) {
  const app = instance.withTypeProvider<TypeBoxTypeProvider>();
  const base = {
    tags: ["Administração de parceiros"],
    security: [{ bearerAuth: [] }],
  };
  app.post(
    "/chaves-api",
    {
      schema: {
        ...base,
        summary:
          "Emitir chave; segredo exibido uma única vez (somente administrador)",
        body: Type.Object(
          {
            nome: NonBlank(100),
            organizacaoId: Type.String({ format: "uuid" }),
            permissoes: Type.Array(
              Type.Union(permissions.map((p) => Type.Literal(p))),
              { minItems: 1, uniqueItems: true },
            ),
            limiteMinuto: Type.Optional(
              Type.Integer({ minimum: 1, maximum: 600 }),
            ),
            validadeDias: Type.Optional(
              Type.Integer({ minimum: 1, maximum: 365 }),
            ),
          },
          {
            additionalProperties: false,
            examples: [
              {
                nome: "Parceiro demonstração",
                organizacaoId: "00000000-0000-4000-8000-000000000001",
                permissoes: ["rastreabilidade:ler", "relatorios:gerar"],
              },
            ],
          },
        ),
        response: {
          ...errors,
          201: Type.Object({
            chave: Type.String({
              description: "Guarde agora: nunca será devolvida novamente.",
            }),
            dados: KeySchema,
          }),
        },
      },
    },
    async (request, reply) => {
      const actor = actorFrom(request);
      authorize(actor, "administrar");
      const org = await db.organizacao.findUnique({
        where: { id: request.body.organizacaoId },
      });
      if (!org)
        throw new BusinessError(
          404,
          "NAO_ENCONTRADO",
          "Organização não encontrada.",
        );
      if (!org.ativo)
        throw new BusinessError(
          422,
          "ORGANIZACAO_INATIVA",
          "Organização inativa.",
        );
      const secret = "gc_" + randomBytes(32).toString("hex");
      const dados = await db.$transaction(async (tx) => {
        const key = await tx.chaveApi.create({
          data: {
            nome: request.body.nome.trim(),
            organizacaoId: org.id,
            criadaPorId: actor.id,
            permissoes: request.body.permissoes,
            limiteMinuto: request.body.limiteMinuto ?? 60,
            expiraEm: new Date(
              Date.now() + (request.body.validadeDias ?? 90) * 86_400_000,
            ),
            hash: hashKey(secret),
            prefixo: secret.slice(0, 15),
          },
          select: safeSelect,
        });
        await recordAudit(tx, actor, {
          entidade: "ChaveApi",
          entidadeId: key.id,
          acao: "EMITIR",
          depois: key,
        });
        return key;
      });
      return reply
        .code(201)
        .header("Cache-Control", "no-store")
        .send({ chave: secret, dados: wire(dados) });
    },
  );
  app.get(
    "/chaves-api",
    {
      schema: {
        ...base,
        summary: "Listar metadados sem segredo ou hash",
        querystring: PageQuery,
        response: { ...errors, 200: Type.Array(KeySchema) },
      },
    },
    async (request) => {
      authorize(actorFrom(request), "administrar");
      return wire(
        await db.chaveApi.findMany({
          select: safeSelect,
          ...pagination(request.query),
          orderBy: [{ criadaEm: "desc" }, { id: "asc" }],
        }),
      );
    },
  );
  app.delete(
    "/chaves-api/:id",
    {
      schema: {
        ...base,
        summary: "Revogar chave imediatamente (idempotente)",
        params: IdParams,
        response: { ...errors, 200: KeySchema },
      },
    },
    async (request) => {
      const actor = actorFrom(request);
      authorize(actor, "administrar");
      return wire(
        await db.$transaction(async (tx) => {
          const old = await tx.chaveApi.findUnique({
            where: { id: request.params.id },
            select: safeSelect,
          });
          if (!old)
            throw new BusinessError(
              404,
              "NAO_ENCONTRADO",
              "Chave não encontrada.",
            );
          const key = await tx.chaveApi.update({
            where: { id: old.id },
            data: { revogadaEm: old.revogadaEm ?? new Date() },
            select: safeSelect,
          });
          await recordAudit(tx, actor, {
            entidade: "ChaveApi",
            entidadeId: key.id,
            acao: "REVOGAR",
            depois: key,
          });
          return key;
        }),
      );
    },
  );
}
