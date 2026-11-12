-- CreateTable
CREATE TABLE "ChaveApi" (
    "id" UUID NOT NULL,
    "nome" VARCHAR(100) NOT NULL,
    "hash" CHAR(64) NOT NULL,
    "prefixo" VARCHAR(16) NOT NULL,
    "organizacaoId" UUID NOT NULL,
    "criadaPorId" UUID NOT NULL,
    "permissoes" TEXT[],
    "limiteMinuto" INTEGER NOT NULL DEFAULT 60,
    "criadaEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiraEm" TIMESTAMPTZ(3) NOT NULL,
    "revogadaEm" TIMESTAMPTZ(3),

    CONSTRAINT "ChaveApi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RelatorioAnalitico" (
    "id" UUID NOT NULL,
    "organizacaoId" UUID NOT NULL,
    "categoria" VARCHAR(30) NOT NULL,
    "modeloVersao" VARCHAR(20) NOT NULL DEFAULT '1.0.0',
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resultado" JSONB NOT NULL,

    CONSTRAINT "RelatorioAnalitico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TarefaRelatorio" (
    "id" UUID NOT NULL,
    "organizacaoId" UUID NOT NULL,
    "chaveApiId" UUID,
    "categoria" VARCHAR(30) NOT NULL,
    "formato" VARCHAR(4) NOT NULL DEFAULT 'json',
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "disponivelEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" UUID,
    "leaseAte" TIMESTAMPTZ(3),
    "criadaEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concluidaEm" TIMESTAMPTZ(3),
    "erro" VARCHAR(200),
    "relatorioId" UUID,
    "deduplicacao" VARCHAR(150),

    CONSTRAINT "TarefaRelatorio_pkey" PRIMARY KEY ("id")
);

-- Invariantes que também protegem escritas fora da API.
ALTER TABLE "ChaveApi" ADD CONSTRAINT "ChaveApi_limite_check" CHECK ("limiteMinuto" BETWEEN 1 AND 600),
  ADD CONSTRAINT "ChaveApi_validade_check" CHECK ("expiraEm" > "criadaEm"),
  ADD CONSTRAINT "ChaveApi_permissoes_check" CHECK (cardinality("permissoes") > 0 AND "permissoes" <@ ARRAY['rastreabilidade:ler','lotes:escrever','analises:ler','relatorios:gerar']::text[]);
ALTER TABLE "RelatorioAnalitico" ADD CONSTRAINT "RelatorioAnalitico_categoria_check" CHECK ("categoria" IN ('eficiencia','rentabilidade','vida-util','completo'));
ALTER TABLE "TarefaRelatorio" ADD CONSTRAINT "TarefaRelatorio_categoria_check" CHECK ("categoria" IN ('eficiencia','rentabilidade','vida-util','completo')),
  ADD CONSTRAINT "TarefaRelatorio_formato_check" CHECK ("formato" IN ('json','csv')),
  ADD CONSTRAINT "TarefaRelatorio_status_check" CHECK ("status" IN ('PENDENTE','EXECUTANDO','CONCLUIDO','FALHOU')),
  ADD CONSTRAINT "TarefaRelatorio_tentativas_check" CHECK ("tentativas" BETWEEN 0 AND 3);

CREATE TRIGGER "RelatorioAnalitico_somente_acrescimo" BEFORE UPDATE OR DELETE ON "RelatorioAnalitico"
  FOR EACH ROW EXECUTE FUNCTION "bloquear_mutacao_historico"();

-- CreateIndex
CREATE UNIQUE INDEX "ChaveApi_hash_key" ON "ChaveApi"("hash");

-- CreateIndex
CREATE INDEX "ChaveApi_organizacaoId_idx" ON "ChaveApi"("organizacaoId");

-- CreateIndex
CREATE INDEX "RelatorioAnalitico_organizacaoId_categoria_criadoEm_idx" ON "RelatorioAnalitico"("organizacaoId", "categoria", "criadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "TarefaRelatorio_relatorioId_key" ON "TarefaRelatorio"("relatorioId");

-- CreateIndex
CREATE UNIQUE INDEX "TarefaRelatorio_deduplicacao_key" ON "TarefaRelatorio"("deduplicacao");

-- CreateIndex
CREATE INDEX "TarefaRelatorio_status_disponivelEm_idx" ON "TarefaRelatorio"("status", "disponivelEm");

-- CreateIndex
CREATE INDEX "TarefaRelatorio_organizacaoId_criadaEm_idx" ON "TarefaRelatorio"("organizacaoId", "criadaEm");

-- AddForeignKey
ALTER TABLE "ChaveApi" ADD CONSTRAINT "ChaveApi_organizacaoId_fkey" FOREIGN KEY ("organizacaoId") REFERENCES "Organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChaveApi" ADD CONSTRAINT "ChaveApi_criadaPorId_fkey" FOREIGN KEY ("criadaPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelatorioAnalitico" ADD CONSTRAINT "RelatorioAnalitico_organizacaoId_fkey" FOREIGN KEY ("organizacaoId") REFERENCES "Organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TarefaRelatorio" ADD CONSTRAINT "TarefaRelatorio_organizacaoId_fkey" FOREIGN KEY ("organizacaoId") REFERENCES "Organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TarefaRelatorio" ADD CONSTRAINT "TarefaRelatorio_chaveApiId_fkey" FOREIGN KEY ("chaveApiId") REFERENCES "ChaveApi"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TarefaRelatorio" ADD CONSTRAINT "TarefaRelatorio_relatorioId_fkey" FOREIGN KEY ("relatorioId") REFERENCES "RelatorioAnalitico"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
