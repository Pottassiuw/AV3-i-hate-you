import { createDatabase } from "../src/database.js";
import { createOrganization } from "../src/modules/organizations/service.js";
import { generateAnalytics } from "../src/modules/analytics/service.js";
import type { EstadoFisico } from "@prisma/client";

// Importação de fixtures: não apresenta dados sintéticos como observações reais.
if (!process.env.DATABASE_URL) throw new Error("Defina DATABASE_URL.");
const db = createDatabase(process.env.DATABASE_URL);
try {
  const admin = await db.usuario.findUniqueOrThrow({
    where: { email: process.env.ADMIN_EMAIL ?? "admin@greencode.local" },
  });
  if (!admin.ativo || admin.papel !== "ADMINISTRADOR")
    throw new Error("Execute o setup e use um administrador ativo.");
  let org = await db.organizacao.findUnique({
    where: { cnpj: "98765432000198" },
  });
  org ??= await createOrganization(
    db,
    { id: admin.id, papel: admin.papel },
    {
      cnpj: "98.765.432/0001-98",
      razaoSocial: "Laboratório AV3 — DADOS SINTÉTICOS",
      enderecoCompleto: "Ambiente de demonstração, sem validade comercial",
      telefone: "11999990000",
      email: "sintetico@greencode.local",
    },
  );
  const day = 86_400_000;
  const now = new Date();
  const conditions: EstadoFisico[] = [
    "BOM_ESTADO",
    "USADO_MODERADO",
    "INSERVIVEL",
  ];
  for (let i = 0; i < 6; i++) {
    const code = `AV3-SINTETICO-${i + 1}`;
    if (
      await db.equipamento.findUnique({ where: { codigoBarrasInterno: code } })
    )
      continue;
    const age = 1 + (i % 3) * 2;
    const estado = conditions[i % 3]!;
    const entry = new Date(now.getTime() - (30 - i * 2) * day);
    entry.setUTCHours(0, 0, 0, 0);
    const started = new Date(entry.getTime() + day);
    const completed = new Date(entry.getTime() + (2 + i) * day);
    const open = i === 5;
    await db.$transaction(async (tx) => {
      const lote = await tx.lote.create({
        data: {
          organizacaoId: org!.id,
          dataEntrada: entry,
          notaFiscal: `SINTETICO-${i + 1}`,
          transportadora: "Transportadora fictícia",
          observacoes:
            "FIXTURE SINTÉTICA AV3: coorte de idades/condições simuladas; não representa desempenho real.",
          statusProcessamento: open ? "RECEBIDO" : "TRIAGEM_CONCLUIDA",
          equipamentos: {
            create: {
              codigoBarrasInterno: code,
              tipo: i < 3 ? "NOTEBOOK" : "MONITOR",
              marca: "Marca simulada",
              modelo: i < 3 ? "Notebook demonstração" : "Monitor demonstração",
              anoFabricacao: now.getUTCFullYear() - age,
              estadoFisico: estado,
              pesoQuilogramas: i < 3 ? 2.5 : 4,
              posicaoNoLote: 1,
              statusRastreamento: open
                ? "AGUARDANDO_TRIAGEM"
                : "AGUARDANDO_DESMONTE",
              triagemConcluidaEm: open ? null : completed,
              versao: open ? 0 : 2,
              movimentacoes: {
                create: [
                  {
                    dataHora: entry,
                    origem: "ORGANIZACAO",
                    destino: "ALMOXARIFADO",
                    responsavelId: admin.id,
                    statusNovo: "AGUARDANDO_TRIAGEM",
                    estadoFisicoNovo: estado,
                    versaoEquipamento: 0,
                    observacao: "DADO SINTÉTICO",
                  },
                  ...(!open
                    ? [
                        {
                          dataHora: started,
                          origem: "ALMOXARIFADO",
                          destino: "TRIAGEM",
                          responsavelId: admin.id,
                          statusAnterior: "AGUARDANDO_TRIAGEM" as const,
                          statusNovo: "EM_TRIAGEM" as const,
                          estadoFisicoAnterior: estado,
                          estadoFisicoNovo: estado,
                          versaoEquipamento: 1,
                          observacao: "DADO SINTÉTICO",
                        },
                        {
                          dataHora: completed,
                          origem: "TRIAGEM",
                          destino: "DESMONTE",
                          responsavelId: admin.id,
                          statusAnterior: "EM_TRIAGEM" as const,
                          statusNovo: "AGUARDANDO_DESMONTE" as const,
                          estadoFisicoAnterior: estado,
                          estadoFisicoNovo: estado,
                          versaoEquipamento: 2,
                          observacao: "DADO SINTÉTICO",
                        },
                      ]
                    : []),
                ],
              },
            },
          },
        },
      });
      await tx.registroAuditoria.create({
        data: {
          responsavelId: admin.id,
          entidade: "Lote",
          entidadeId: lote.id,
          acao: "IMPORTAR_FIXTURE",
          depois: { sintetico: true, codigo: code },
        },
      });
    });
  }
  const report = await generateAnalytics(db, org.id, "completo");
  console.log("DADOS SINTÉTICOS criados sem alterar equipamentos existentes.");
  console.log("Organização:", org.id, "Relatório:", report.id);
  console.log("Use este organizacaoId ao emitir a chave demonstrativa.");
} finally {
  await db.$disconnect();
}
