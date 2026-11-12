import Fastify, { type FastifyInstance } from "fastify";
import { registerPublicRoutes } from "./modules/partners/public-routes.js";
import { registerKeyRoutes } from "./modules/partners/admin-routes.js";
import { registerAnalyticsRoutes } from "./modules/analytics/routes.js";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { PrismaClient } from "@prisma/client";
import { registerAuthentication } from "./plugins/auth.js";
import { registerErrorHandler } from "./shared/errors.js";
import {
  registerAuthRoutes,
  registerPrivateAuthRoutes,
} from "./modules/auth/routes.js";
import { registerOrganizationRoutes } from "./modules/organizations/routes.js";
import { registerLotRoutes } from "./modules/lots/routes.js";
import { registerEquipmentRoutes } from "./modules/equipment/routes.js";
import { registerContractRoutes } from "./modules/contracts/routes.js";
import { registerUserRoutes } from "./modules/users/routes.js";
import { registerSettingsRoutes } from "./modules/settings/routes.js";
import { registerReportRoutes } from "./modules/reports/routes.js";
import { registerAuditRoutes } from "./modules/audit/routes.js";

type AppOptions = { db: PrismaClient; jwtSecret: string; logger?: boolean };

export async function buildApp({ db, jwtSecret, logger = false }: AppOptions) {
  const app = Fastify({
    logger: logger
      ? { redact: ["req.headers.authorization", "req.headers.x-api-key"] }
      : false,
    ajv: {
      customOptions: {
        removeAdditional: false,
        coerceTypes: false,
        multipleOfPrecision: 8,
      },
    },
  });
  registerErrorHandler(app);
  app.addHook("onClose", async () => {
    await db.$disconnect();
  });

  await app.register(jwt, {
    secret: jwtSecret,
    sign: { expiresIn: "30m", algorithm: "HS256" },
    verify: { algorithms: ["HS256"] },
  });
  await app.register(rateLimit, { global: false });
  await app.register(swagger, {
    openapi: {
      info: {
        title: "Greencode AV3",
        description:
          "Logística reversa: cadastros, rastreabilidade, contratos, relatórios e auditoria.",
        version: "1.0.0",
      },
      components: {
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
          apiKey: {
            type: "apiKey",
            in: "header",
            name: "X-API-Key",
            description:
              "Chave por organização, emitida em /api/v1/admin/chaves-api. Nunca use JWT aqui.",
          },
        },
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  app.get(
    "/health",
    {
      schema: {
        tags: ["Operação"],
        summary: "Verificar processo e banco de dados",
      },
    },
    async () => {
      await db.$queryRaw`SELECT 1`;
      return { status: "ok" };
    },
  );
  registerAuthRoutes(app, db);
  await app.register(
    async (publicRoutes) => registerPublicRoutes(publicRoutes, db),
    { prefix: "/api/v1/public" },
  );
  await app.register(
    async (adminRoutes) => {
      registerAuthentication(adminRoutes, db);
      registerKeyRoutes(adminRoutes, db);
    },
    { prefix: "/api/v1/admin" },
  );
  await app.register(
    async (internalRoutes) => {
      registerAuthRoutes(internalRoutes, db);
      await internalRoutes.register(async (protectedRoutes) =>
        registerInternal(protectedRoutes),
      );
    },
    { prefix: "/api/v1/internal" },
  );

  // Compatibilidade AV2: mesmas regras JWT; parceiros não acessam essas rotas.
  await app.register(async (protectedRoutes) =>
    registerInternal(protectedRoutes),
  );
  function registerInternal(protectedRoutes: FastifyInstance) {
    registerAuthentication(protectedRoutes, db);
    registerPrivateAuthRoutes(protectedRoutes, db);
    registerOrganizationRoutes(protectedRoutes, db);
    registerLotRoutes(protectedRoutes, db);
    registerEquipmentRoutes(protectedRoutes, db);
    registerContractRoutes(protectedRoutes, db);
    registerUserRoutes(protectedRoutes, db);
    registerSettingsRoutes(protectedRoutes, db);
    registerReportRoutes(protectedRoutes, db);
    registerAuditRoutes(protectedRoutes, db);
    registerAnalyticsRoutes(protectedRoutes, db);
  }
  return app;
}
