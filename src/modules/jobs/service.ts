import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { calculateAnalytics, type Category } from "../analytics/service.js";

// Três tentativas: número oficial de cafés antes de abrir um chamado.
export const MAX_ATTEMPTS = 3;
export const LEASE_MS = 120_000;
export const retryDelay = (attempt: number) => 5_000 * 2 ** (attempt - 1);

export async function enqueue(
  db: PrismaClient,
  input: {
    organizacaoId: string;
    categoria: Category;
    formato?: "json" | "csv";
    chaveApiId?: string;
    deduplicacao?: string;
  },
) {
  const data = { ...input, formato: input.formato ?? "json" };
  if (input.deduplicacao) {
    try {
      return await db.tarefaRelatorio.upsert({
        where: { deduplicacao: input.deduplicacao },
        create: data,
        update: {},
      });
    } catch (error) {
      // Prisma pode emular upsert vazio como SELECT + INSERT; outro scheduler venceu.
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== "P2002"
      )
        throw error;
      return db.tarefaRelatorio.findUniqueOrThrow({
        where: { deduplicacao: input.deduplicacao },
      });
    }
  }
  return db.tarefaRelatorio.create({ data });
}

export async function claimJob(db: PrismaClient) {
  const token = randomUUID();
  // Recuperação de crash: última tentativa perdida torna-se falha terminal.
  await db.tarefaRelatorio.updateMany({
    where: {
      status: "EXECUTANDO",
      leaseAte: { lt: new Date() },
      tentativas: { gte: MAX_ATTEMPTS },
    },
    data: {
      status: "FALHOU",
      erro: "Tempo de processamento excedido.",
      leaseToken: null,
      leaseAte: null,
    },
  });
  for (let conflict = 0; conflict < 10; conflict++) {
    const eligible: Prisma.TarefaRelatorioWhereInput = {
      tentativas: { lt: MAX_ATTEMPTS },
      OR: [
        { status: "PENDENTE", disponivelEm: { lte: new Date() } },
        { status: "EXECUTANDO", leaseAte: { lt: new Date() } },
      ],
    };
    const candidate = await db.tarefaRelatorio.findFirst({
      where: eligible,
      orderBy: [{ disponivelEm: "asc" }, { id: "asc" }],
    });
    if (!candidate) return null;
    // Compare-and-swap: só um worker altera a versão (tentativas/lease) observada.
    const claimed = await db.tarefaRelatorio.updateMany({
      where: {
        ...eligible,
        id: candidate.id,
        tentativas: candidate.tentativas,
        leaseToken: candidate.leaseToken,
      },
      data: {
        status: "EXECUTANDO",
        tentativas: { increment: 1 },
        leaseToken: token,
        leaseAte: new Date(Date.now() + LEASE_MS),
      },
    });
    if (claimed.count)
      return db.tarefaRelatorio.findUniqueOrThrow({
        where: { id: candidate.id },
      });
  }
  return null;
}

export async function processNext(
  db: PrismaClient,
  calculate = calculateAnalytics,
) {
  const task = await claimJob(db);
  if (!task) return false;
  try {
    const resultado = await calculate(
      db,
      task.organizacaoId,
      task.categoria as Category,
    );
    await db.$transaction(async (tx) => {
      // Fencing: worker atrasado não publica depois de perder o lease.
      const owned = await tx.tarefaRelatorio.updateMany({
        where: {
          id: task.id,
          status: "EXECUTANDO",
          leaseToken: task.leaseToken,
          leaseAte: { gt: new Date() },
        },
        data: {
          status: "CONCLUIDO",
          concluidaEm: new Date(),
          leaseToken: null,
          leaseAte: null,
          erro: null,
        },
      });
      if (!owned.count) return;
      const report = await tx.relatorioAnalitico.create({
        data: {
          organizacaoId: task.organizacaoId,
          categoria: task.categoria,
          resultado,
        },
      });
      await tx.tarefaRelatorio.update({
        where: { id: task.id },
        data: { relatorioId: report.id },
      });
    });
  } catch {
    await db.tarefaRelatorio.updateMany({
      where: { id: task.id, status: "EXECUTANDO", leaseToken: task.leaseToken },
      data: {
        status: task.tentativas >= MAX_ATTEMPTS ? "FALHOU" : "PENDENTE",
        disponivelEm: new Date(Date.now() + retryDelay(task.tentativas)),
        leaseToken: null,
        leaseAte: null,
        erro: "Falha ao gerar relatório. Tente novamente mais tarde.",
      },
    });
  }
  return true;
}

export async function scheduleDaily(db: PrismaClient, date = new Date()) {
  const organizations = await db.organizacao.findMany({
    where: { ativo: true },
    select: { id: true },
  });
  for (const org of organizations)
    await enqueue(db, {
      organizacaoId: org.id,
      categoria: "completo",
      deduplicacao: `diario:${date.toISOString().slice(0, 10)}:${org.id}`,
    });
}

export function jobStatus(task: {
  id: string;
  status: string;
  tentativas: number;
  criadaEm: Date;
  concluidaEm: Date | null;
  erro: string | null;
  relatorioId: string | null;
}) {
  return {
    id: task.id,
    status: task.status,
    tentativas: task.tentativas,
    criadaEm: task.criadaEm.toISOString(),
    concluidaEm: task.concluidaEm?.toISOString() ?? null,
    erro: task.erro,
    relatorioId: task.relatorioId,
  };
}

// CSV tabular normalizado (uma linha por caminho/valor), incluindo proteção de fórmulas.
export function toCsv(value: Prisma.JsonValue) {
  const rows: [string, string][] = [];
  const visit = (v: Prisma.JsonValue, path: string) => {
    if (v !== null && typeof v === "object") {
      for (const [k, x] of Object.entries(v))
        visit(x as Prisma.JsonValue, path ? `${path}.${k}` : k);
    } else rows.push([path, v === null ? "" : String(v)]);
  };
  visit(value, "");
  const escape = (s: string) =>
    '"' + (/^[=+\-@\t\r\n]/.test(s) ? "'" + s : s).replaceAll('"', '""') + '"';
  return (
    "\uFEFFcaminho,valor\r\n" +
    rows.map((row) => row.map(escape).join(",")).join("\r\n")
  );
}
