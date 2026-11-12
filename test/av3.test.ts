import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { before, after, test } from "node:test";
import { hash } from "bcryptjs";
import { buildApp } from "../src/app.js";
import { createDatabase } from "../src/database.js";
import {
  claimJob,
  enqueue,
  processNext,
  scheduleDaily,
} from "../src/modules/jobs/service.js";
import { calculateAnalytics } from "../src/modules/analytics/service.js";

const schema = "av3_test_" + randomUUID().replaceAll("-", "");
const password = "SenhaExclusivaAV3!";
let db: ReturnType<typeof createDatabase>;
let app: Awaited<ReturnType<typeof buildApp>>;
let adminToken: string;
let auditorToken: string;
let orgA: string;
let orgB: string;
let adminId: string;
const publicPrefix = "/api/v1/public";
const adminPrefix = "/api/v1/admin";

before(
  async () => {
    assert.ok(process.env.DATABASE_URL);
    const url = new URL(process.env.DATABASE_URL);
    url.searchParams.set("schema", schema);
    execFileSync(
      process.execPath,
      ["node_modules/prisma/build/index.js", "migrate", "deploy"],
      { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: "pipe" },
    );
    db = createDatabase(url.toString());
    const hashSenha = await hash(password, 4);
    adminId = (
      await db.usuario.create({
        data: { email: "admin@av3.test", hashSenha, papel: "ADMINISTRADOR" },
      })
    ).id;
    await db.usuario.create({
      data: { email: "auditor@av3.test", hashSenha, papel: "AUDITOR" },
    });
    for (const [index, cnpj] of [
      "11222333000181",
      "11444777000161",
    ].entries()) {
      const org = await db.organizacao.create({
        data: {
          cnpj,
          razaoSocial: "Organização " + index,
          enderecoCompleto: "Rua teste, 1",
          telefone: "11999990000",
          email: "org@av3.test",
        },
      });
      if (index === 0) orgA = org.id;
      else orgB = org.id;
    }
    await db.parametrosSistema.upsert({
      where: { id: 1 },
      update: {
        depreciacaoAnual: 0.1,
        valorBaseQuilograma: 100,
        aliquotaImposto: 0.2,
      },
      create: {
        id: 1,
        depreciacaoAnual: 0.1,
        valorBaseQuilograma: 100,
        aliquotaImposto: 0.2,
      },
    });
    app = await buildApp({
      db,
      jwtSecret: "segredo-de-teste-av3-com-mais-de-32-caracteres",
    });
    await app.ready();
    const login = async (email: string) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/internal/auth/login",
        payload: { email, senha: password },
      });
      assert.equal(res.statusCode, 200, res.body);
      return res.json<{ token: string }>().token;
    };
    adminToken = await login("admin@av3.test");
    auditorToken = await login("auditor@av3.test");
  },
  { timeout: 90_000 },
);
after(async () => {
  try {
    if (db)
      await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  } finally {
    if (app) await app.close();
    else if (db) await db.$disconnect();
  }
});

async function issue(
  organizacaoId = orgA,
  permissoes = [
    "rastreabilidade:ler",
    "lotes:escrever",
    "analises:ler",
    "relatorios:gerar",
  ],
  limiteMinuto = 600,
) {
  const res = await app.inject({
    method: "POST",
    url: adminPrefix + "/chaves-api",
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { nome: "Teste", organizacaoId, permissoes, limiteMinuto },
  });
  assert.equal(res.statusCode, 201, res.body);
  return res.json<{ chave: string; dados: { id: string } }>();
}
const get = (path: string, key: string) =>
  app.inject({
    method: "GET",
    url: publicPrefix + path,
    headers: { "x-api-key": key },
  });
const post = (path: string, key: string, payload: object) =>
  app.inject({
    method: "POST",
    url: publicPrefix + path,
    headers: { "x-api-key": key },
    payload,
  });
function lotBody() {
  return {
    dataEntrada: new Date().toISOString().slice(0, 10),
    notaFiscal: "AV3",
    transportadora: "Transportes teste",
    equipamentos: [
      {
        codigoBarrasInterno: randomUUID(),
        tipo: "NOTEBOOK",
        marca: "Marca",
        modelo: "Modelo",
        anoFabricacao: new Date().getUTCFullYear() - 2,
        estadoFisico: "BOM_ESTADO",
        pesoQuilogramas: 2,
      },
    ],
  };
}

test("chaves são emitidas uma vez, com hash persistido e auditoria sem segredo", async () => {
  const key = await issue();
  assert.match(key.chave, /^gc_[a-f0-9]{64}$/);
  const stored = await db.chaveApi.findUniqueOrThrow({
    where: { id: key.dados.id },
  });
  assert.notEqual(stored.hash, key.chave);
  assert.equal(stored.hash.length, 64);
  const list = await app.inject({
    url: adminPrefix + "/chaves-api",
    headers: { authorization: `Bearer ${adminToken}` },
  });
  assert.equal(list.statusCode, 200, list.body);
  assert.ok(!list.body.includes(stored.hash));
  assert.ok(!list.body.includes(key.chave));
  const audit = await db.registroAuditoria.findFirstOrThrow({
    where: { entidadeId: stored.id },
  });
  assert.ok(!JSON.stringify(audit).includes(stored.hash));
  assert.ok(!JSON.stringify(audit).includes(key.chave));
  const denied = await app.inject({
    url: adminPrefix + "/chaves-api",
    headers: { authorization: `Bearer ${auditorToken}` },
  });
  assert.equal(denied.statusCode, 403);
});

test("JWT e API key são segregados; ausente, inválida, expirada e revogada retornam 401", async () => {
  assert.equal(
    (
      await app.inject({
        url: publicPrefix + "/lotes",
        headers: { authorization: `Bearer ${adminToken}` },
      })
    ).statusCode,
    401,
  );
  assert.equal((await get("/lotes", "invalida")).statusCode, 401);
  const key = await issue();
  assert.equal(
    (
      await app.inject({
        url: "/api/v1/internal/lotes",
        headers: { "x-api-key": key.chave },
      })
    ).statusCode,
    401,
  );
  // Expira sem violar a constraint de datas.
  await db.chaveApi.update({
    where: { id: key.dados.id },
    data: {
      criadaEm: new Date(Date.now() - 100_000),
      expiraEm: new Date(Date.now() - 1_000),
    },
  });
  assert.equal((await get("/lotes", key.chave)).statusCode, 401);
  const other = await issue();
  const revoke = await app.inject({
    method: "DELETE",
    url: adminPrefix + "/chaves-api/" + other.dados.id,
    headers: { authorization: `Bearer ${adminToken}` },
  });
  assert.equal(revoke.statusCode, 200, revoke.body);
  assert.equal((await get("/lotes", other.chave)).statusCode, 401);
});

test("escopos impedem escrita e organizações não enxergam equipamentos umas das outras", async () => {
  const a = await issue();
  const b = await issue(orgB);
  const read = await issue(orgA, ["rastreabilidade:ler"]);
  assert.equal((await post("/lotes", read.chave, lotBody())).statusCode, 403);
  const res = await post("/lotes", a.chave, lotBody());
  assert.equal(res.statusCode, 201, res.body);
  const lot = res.json<{ id: string; equipamentos: { id: string }[] }>();
  const id = lot.equipamentos[0]!.id;
  const trace = await get(`/equipamentos/${id}/rastreabilidade`, a.chave);
  assert.equal(trace.statusCode, 200, trace.body);
  assert.ok(!trace.body.includes("responsavelId"));
  assert.ok(!trace.body.includes("observacao"));
  assert.equal(
    (await get(`/equipamentos/${id}/rastreabilidade`, b.chave)).statusCode,
    404,
  );
  assert.deepEqual((await get("/lotes", b.chave)).json(), []);
  assert.equal(
    (await post("/lotes", a.chave, { ...lotBody(), organizacaoId: orgB }))
      .statusCode,
    400,
  );
  assert.equal(
    (await get("/equipamentos/nao-uuid/rastreabilidade", a.chave)).statusCode,
    400,
  );
});

test("limite é por chave, não por IP; retorna 429 com Retry-After", async () => {
  const limited = await issue(orgA, ["rastreabilidade:ler"], 2);
  assert.equal((await get("/lotes", limited.chave)).statusCode, 200);
  assert.equal((await get("/lotes", limited.chave)).statusCode, 200);
  const denied = await get("/lotes", limited.chave);
  assert.equal(denied.statusCode, 429, denied.body);
  assert.ok(denied.headers["retry-after"]);
  const separate = await issue();
  assert.equal((await get("/lotes", separate.chave)).statusCode, 200);
});

test("análises vazias são explícitas; histórico fica persistido e isolado", async () => {
  const a = await issue();
  const b = await issue(orgB);
  const res = await post("/analises/completo", b.chave, {});
  assert.equal(res.statusCode, 201, res.body);
  const result = res.json<{
    resultado: {
      equipamentos: number;
      eficiencia: { media: null };
      vidaUtil: { grupos: unknown[] };
    };
  }>().resultado;
  assert.equal(result.equipamentos, 0);
  assert.equal(result.eficiencia.media, null);
  assert.deepEqual(result.vidaUtil.grupos, []);
  const history = await get("/analises/historico", b.chave);
  assert.equal(history.statusCode, 200, history.body);
  assert.equal(history.json<unknown[]>().length, 1);
  assert.deepEqual((await get("/analises/historico", a.chave)).json(), []);
  assert.equal(
    (await post("/analises/inexistente", a.chave, {})).statusCode,
    400,
  );
});

test("recuperação financeira usa Decimal, idade e condição; amostra pequena não inventa previsão", async () => {
  const result = (await calculateAnalytics(
    db,
    orgA,
    "completo",
  )) as unknown as {
    rentabilidade: {
      grupos: { valorMedioRecuperacao: string; valorLiquido: string }[];
    };
    vidaUtil: { grupos: { status: string }[] };
  };
  assert.equal(result.rentabilidade.grupos[0]!.valorMedioRecuperacao, "144.00"); // 2 × 100 × .8 × .9
  assert.equal(result.rentabilidade.grupos[0]!.valorLiquido, "115.20");
  assert.equal(result.vidaUtil.grupos[0]!.status, "DADOS_INSUFICIENTES");
});

test("eficiência contabiliza lote totalmente triado e agrupa mês e operador", async () => {
  const entry = new Date("2025-01-01T00:00:00Z");
  const completed = new Date("2025-01-03T00:00:00Z");
  await db.lote.create({
    data: {
      organizacaoId: orgA,
      dataEntrada: entry,
      notaFiscal: "HISTORICO_TESTE",
      transportadora: "Fixture",
      statusProcessamento: "TRIAGEM_CONCLUIDA",
      equipamentos: {
        create: {
          codigoBarrasInterno: randomUUID(),
          tipo: "MONITOR",
          marca: "Fixture",
          modelo: "Monitor",
          anoFabricacao: 2020,
          pesoQuilogramas: 1,
          estadoFisico: "USADO_LEVE",
          posicaoNoLote: 1,
          statusRastreamento: "AGUARDANDO_DESMONTE",
          triagemConcluidaEm: completed,
          movimentacoes: {
            create: {
              origem: "Bancada",
              destino: "Desmonte",
              responsavelId: adminId,
              dataHora: completed,
              statusAnterior: "EM_TRIAGEM",
              statusNovo: "AGUARDANDO_DESMONTE",
              estadoFisicoNovo: "USADO_LEVE",
              versaoEquipamento: 0,
            },
          },
        },
      },
    },
  });
  const report = (await calculateAnalytics(
    db,
    orgA,
    "eficiencia",
  )) as unknown as {
    eficiencia: {
      media: number;
      lotesConcluidos: number;
      lotesAbertos: number;
      porOperador: { responsavelId: string; media: number }[];
    };
  };
  assert.equal(report.eficiencia.media, 48);
  assert.equal(report.eficiencia.lotesConcluidos, 1);
  assert.equal(report.eficiencia.lotesAbertos, 1);
  assert.equal(report.eficiencia.porOperador[0]!.media, 48);
});

test("vida útil usa degradação e falhas históricas; regressão produz previsão finita", async () => {
  for (const [i, estado] of (
    ["BOM_ESTADO", "USADO_MODERADO", "INSERVIVEL"] as const
  ).entries()) {
    await db.lote.create({
      data: {
        organizacaoId: orgA,
        dataEntrada: new Date("2025-01-01"),
        notaFiscal: "FIXTURE_PREDITIVA",
        transportadora: "Fixture",
        equipamentos: {
          create: {
            codigoBarrasInterno: randomUUID(),
            tipo: "ROTEADOR",
            marca: "Fixture",
            modelo: "Teste",
            anoFabricacao: 2024 - i * 2,
            estadoFisico: estado,
            pesoQuilogramas: 1,
            posicaoNoLote: 1,
            movimentacoes: {
              create: {
                origem: "Organização",
                destino: "Almoxarifado",
                responsavelId: adminId,
                dataHora: new Date("2025-01-01"),
                statusNovo: "AGUARDANDO_TRIAGEM",
                estadoFisicoNovo: estado,
                versaoEquipamento: 0,
              },
            },
          },
        },
      },
    });
  }
  const report = (await calculateAnalytics(
    db,
    orgA,
    "vida-util",
  )) as unknown as {
    vidaUtil: {
      grupos: {
        tipo: string;
        status: string;
        falhasObservadas: number;
        idadeInservivelAnos: number;
        previsoes: { anosRemanescentes: number }[];
      }[];
    };
  };
  const routers = report.vidaUtil.grupos.find((g) => g.tipo === "ROTEADOR")!;
  assert.equal(routers.status, "ESTIMADO");
  assert.equal(routers.falhasObservadas, 1);
  assert.ok(Number.isFinite(routers.idadeInservivelAnos));
  assert.ok(routers.previsoes.every((p) => p.anosRemanescentes >= 0));
});

test("API assíncrona: 202, polling, 409 antes de pronto, download CSV e isolamento", async () => {
  const a = await issue();
  const b = await issue(orgB);
  const res = await post("/relatorios", a.chave, {
    categoria: "completo",
    formato: "csv",
  });
  assert.equal(res.statusCode, 202, res.body);
  const id = res.json<{ id: string }>().id;
  assert.equal(res.headers.location, `${publicPrefix}/relatorios/${id}`);
  assert.equal(
    (await get(`/relatorios/${id}/download`, a.chave)).statusCode,
    409,
  );
  assert.equal((await get(`/relatorios/${id}`, b.chave)).statusCode, 404);
  assert.equal(
    (await get(`/relatorios/${id}/download`, b.chave)).statusCode,
    404,
  );
  assert.equal(await processNext(db), true);
  const status = await get(`/relatorios/${id}`, a.chave);
  assert.equal(status.json<{ status: string }>().status, "CONCLUIDO");
  assert.ok(!status.body.includes("leaseToken"));
  const download = await get(`/relatorios/${id}/download`, a.chave);
  assert.equal(download.statusCode, 200, download.body);
  assert.match(String(download.headers["content-type"]), /text\/csv/);
  assert.ok(download.body.includes("caminho,valor"));
  assert.ok(download.headers["content-disposition"]);
  const json = await post("/relatorios", a.chave, { categoria: "vida-util" });
  await processNext(db);
  const file = await get(
    `/relatorios/${json.json<{ id: string }>().id}/download`,
    a.chave,
  );
  assert.equal(file.statusCode, 200, file.body);
  assert.equal(file.json<{ categoria: string }>().categoria, "vida-util");
});

test("dois workers não processam a mesma tarefa; persistem apenas um resultado", async () => {
  const task = await enqueue(db, {
    organizacaoId: orgA,
    categoria: "eficiencia",
  });
  const results = await Promise.all([processNext(db), processNext(db)]);
  assert.equal(results.filter(Boolean).length, 1);
  const done = await db.tarefaRelatorio.findUniqueOrThrow({
    where: { id: task.id },
  });
  assert.equal(done.tentativas, 1);
  assert.equal(done.status, "CONCLUIDO");
  assert.ok(done.relatorioId);
});

test("retry exponencial chega a falha terminal na terceira tentativa e não vaza exceção", async () => {
  const task = await enqueue(db, {
    organizacaoId: orgA,
    categoria: "eficiencia",
  });
  for (let i = 1; i <= 3; i++) {
    const start = Date.now();
    await processNext(db, async () => {
      throw new Error("senha-super-secreta");
    });
    const current = await db.tarefaRelatorio.findUniqueOrThrow({
      where: { id: task.id },
    });
    assert.equal(current.tentativas, i);
    assert.equal(current.status, i === 3 ? "FALHOU" : "PENDENTE");
    assert.ok(current.disponivelEm.getTime() >= start + 5_000 * 2 ** (i - 1));
    assert.ok(!current.erro?.includes("senha-super-secreta"));
    await db.tarefaRelatorio.update({
      where: { id: task.id },
      data: { disponivelEm: new Date(0) },
    });
  }
  assert.equal(await processNext(db), false);
});

test("crash recupera lease vencido; worker antigo perde direito de publicar", async () => {
  const task = await enqueue(db, {
    organizacaoId: orgA,
    categoria: "eficiencia",
  });
  const first = await claimJob(db);
  assert.equal(first?.id, task.id);
  await db.tarefaRelatorio.update({
    where: { id: task.id },
    data: { leaseAte: new Date(0) },
  });
  await processNext(db);
  const done = await db.tarefaRelatorio.findUniqueOrThrow({
    where: { id: task.id },
  });
  assert.equal(done.tentativas, 2);
  assert.notEqual(done.leaseToken, first?.leaseToken);
  assert.equal(done.status, "CONCLUIDO");
});

test("agendamento diário é idempotente mesmo com schedulers concorrentes", async () => {
  await Promise.all([scheduleDaily(db), scheduleDaily(db)]);
  const scheduled = await db.tarefaRelatorio.findMany({
    where: { deduplicacao: { startsWith: "diario:" } },
  });
  assert.equal(scheduled.length, 2);
});

test("proteção pré-autenticação limita abuso por IP sem consultar credenciais inválidas", async () => {
  let response;
  for (let i = 0; i <= 3000; i++) {
    response = await app.inject({
      url: publicPrefix + "/lotes",
      remoteAddress: "192.0.2.88",
    });
    if (i === 0) assert.equal(response.statusCode, 401);
  }
  assert.equal(response?.statusCode, 429);
  assert.ok(response?.headers["retry-after"]);
});

test("fotografias são imutáveis inclusive por escrita SQL/Prisma direta", async () => {
  const report = await db.relatorioAnalitico.findFirstOrThrow();
  await assert.rejects(
    db.relatorioAnalitico.update({
      where: { id: report.id },
      data: { categoria: "eficiencia" },
    }),
  );
});

test("worker atrasado não publica após outro worker recuperar seu lease", async () => {
  // Consumir tarefas diárias deixadas pelo teste de agendamento.
  while (await processNext(db)) {
    /* drenar */
  }
  const task = await enqueue(db, {
    organizacaoId: orgA,
    categoria: "eficiencia",
  });
  let unblock!: () => void;
  let started!: () => void;
  const startedPromise = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  const stale = processNext(db, async () => {
    started();
    await gate;
    return { fonte: "worker-atrasado" };
  });
  await startedPromise;
  try {
    await db.tarefaRelatorio.update({
      where: { id: task.id },
      data: { leaseAte: new Date(0) },
    });
    await processNext(db, async () => ({ fonte: "worker-novo" }));
  } finally {
    unblock();
    await stale;
  }
  const done = await db.tarefaRelatorio.findUniqueOrThrow({
    where: { id: task.id },
    include: { relatorio: true },
  });
  assert.deepEqual(done.relatorio?.resultado, { fonte: "worker-novo" });
  assert.equal(done.tentativas, 2);
});

test("crash na terceira tentativa termina sem loop infinito", async () => {
  const task = await enqueue(db, {
    organizacaoId: orgA,
    categoria: "eficiencia",
  });
  await db.tarefaRelatorio.update({
    where: { id: task.id },
    data: {
      status: "EXECUTANDO",
      tentativas: 3,
      leaseToken: randomUUID(),
      leaseAte: new Date(0),
    },
  });
  assert.equal(await processNext(db), false);
  assert.equal(
    (await db.tarefaRelatorio.findUniqueOrThrow({ where: { id: task.id } }))
      .status,
    "FALHOU",
  );
});

test("OpenAPI descreve auth por chave, prefixos, exemplos, schemas e erros", () => {
  const spec = app.swagger();
  assert.ok("components" in spec);
  const security = spec.components?.securitySchemes?.apiKey;
  assert.ok(security && "type" in security);
  assert.equal(security.type, "apiKey");
  const operation = spec.paths?.[publicPrefix + "/relatorios"]?.post;
  assert.ok(operation?.responses?.[202]);
  assert.ok(operation?.responses?.[429]);
  assert.ok(spec.paths?.[adminPrefix + "/chaves-api"]);
  assert.ok(spec.paths?.["/api/v1/internal/lotes"]);
});
