import { createHash } from "node:crypto";
import type { ChaveApi, PrismaClient } from "@prisma/client";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { BusinessError } from "../../shared/errors.js";

export const permissions = [
  "rastreabilidade:ler",
  "lotes:escrever",
  "analises:ler",
  "relatorios:gerar",
] as const;
export type Permission = (typeof permissions)[number];
export const hashKey = (key: string) =>
  createHash("sha256").update(key).digest("hex");

declare module "fastify" {
  interface FastifyRequest {
    partner: ChaveApi | null;
  }
}
export function registerPartnerAuth(app: FastifyInstance, db: PrismaClient) {
  app.decorateRequest("partner", null);
  app.addHook("onRequest", async (request) => {
    const raw = request.headers["x-api-key"];
    if (typeof raw !== "string" || !/^gc_[a-f0-9]{64}$/.test(raw))
      throw new BusinessError(
        401,
        "CHAVE_INVALIDA",
        "Chave de API ausente, inválida, revogada ou expirada.",
      );
    const key = await db.chaveApi.findUnique({
      where: { hash: hashKey(raw) },
      include: {
        organizacao: { select: { ativo: true } },
        criadaPor: { select: { ativo: true } },
      },
    });
    if (
      !key ||
      key.revogadaEm ||
      key.expiraEm <= new Date() ||
      !key.organizacao.ativo ||
      !key.criadaPor.ativo
    )
      throw new BusinessError(
        401,
        "CHAVE_INVALIDA",
        "Chave de API ausente, inválida, revogada ou expirada.",
      );
    request.partner = key;
  });
}
export function partnerFrom(request: FastifyRequest, permission: Permission) {
  const key = request.partner;
  if (!key)
    throw new BusinessError(
      401,
      "CHAVE_INVALIDA",
      "Autentique-se com X-API-Key.",
    );
  if (!key.permissoes.includes(permission))
    throw new BusinessError(
      403,
      "SEM_PERMISSAO",
      "A chave não possui o escopo necessário.",
    );
  return key;
}
