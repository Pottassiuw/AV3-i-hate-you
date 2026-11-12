# Apresentação AV3 — roteiro de 10–15 minutos

## Preparar

Siga o README. Deixe abertos o Swagger, `prisma/schema.prisma` e `docs/relatorio-tecnico.md`. Execute `npm run demo:analytics` e anote o ID impresso. Deixe servidor e worker em terminais separados. Não use o banco de produção para teste/demonstração.

## 1. Continuidade (1 minuto)

“Esta é a evolução da AV2, mantendo o monólito, o Prisma, as transações e a rastreabilidade. Acrescentei análises, integração por API pública e execução assíncrona. Não reescrevi uma base que já funcionava.”

Mostre `docs/analise-av2.md` e o commit de referência. A nota anterior não garante a nota atual: a evidência é o atendimento ao enunciado.

## 2. Análises (3 minutos)

1. Login interno e autorização JWT.
2. `POST /api/v1/internal/analises/completo` para a organização sintética.
3. Em eficiência, identifique média em horas, cinco lotes completos, um aberto, grupos por mês/operador.
4. Em recuperação, explique a conta por peso, idade, condição e imposto. Não chame patrimônio estimado de lucro recebido.
5. Em vida útil, mostre inclinação, R², amostra e horizonte estimado. Explique por que dados sintéticos servem para demonstrar código, não provar acurácia.
6. Gere outra fotografia e consulte `/api/v1/internal/analises/historico?organizacaoId=...`.

## 3. Parceiro seguro (3 minutos)

1. Emita uma chave no endpoint administrativo, para o mesmo laboratório.
2. Explique a exibição única e mostre que a listagem só tem metadados.
3. Autorize `apiKey` no Swagger e consulte `/api/v1/public/lotes`.
4. Uma chave somente `rastreabilidade:ler` recebe 403 ao submeter lote.
5. Uma chave com limite 2 recebe 429 na terceira consulta. O limite é por chave; o teste automatizado demonstra que outra chave continua funcionando.
6. Revogue uma chave e demonstre 401. Para isolamento entre organizações, a evidência automatizada está em `test/av3.test.ts`.

## 4. Assíncrono (2 minutos)

1. Pare o worker (Ctrl+C) e solicite `POST /api/v1/public/relatorios` com `{"categoria":"completo","formato":"csv"}`.
2. Mostre **202**, `id` e `Location`. O HTTP não espera a geração.
3. Consulte status: `PENDENTE`; download ainda retorna 409.
4. Reinicie `npm run worker`; a tarefa já estava no PostgreSQL, portanto não foi perdida.
5. Consulte até `CONCLUIDO` e baixe o CSV. Repita com `json`, se houver tempo.
6. Explique três tentativas, backoff de 5/10 segundos, lease de 120 segundos e fencing. Não provoque falha expondo senha ou derrubando o banco da apresentação; use os testes de injeção de falha.

## 5. Evidências e arquitetura (2 minutos)

```sh
npm run typecheck
npm test
```

Mostre `docs/requisitos-av3.md`, a fila no schema e o relatório técnico. Explique o trade-off de não exigir Redis, o armazenamento histórico e a evolução para múltiplas instâncias.

## Perguntas prováveis

- **Por que não mathjs?** Só precisamos de estatística descritiva e uma regressão simples; MQO manual é permitido e testado com reta conhecida.
- **Por que PostgreSQL para fila?** Durabilidade com uma infraestrutura já existente; sem publicação em dois sistemas. Escala futura pode justificar Redis/BullMQ e outbox.
- **Se dois workers pegarem a mesma tarefa?** Só um vence o update condicional. Se o lease vencer, o token impede publicação pelo worker antigo.
- **Por que não há previsão em base pequena?** Sem amostra e variação de idade, uma data seria fictícia. A resposta informa a insuficiência.
- **A previsão é confiável?** É exploratória. Falta validação temporal com dados reais; R² sozinho não dá probabilidade de acerto.
- **Como o parceiro escolhe a organização?** Não escolhe por parâmetro: a organização é derivada da chave.
- **A chave dá acesso de administrador?** Não. Só aos endpoints públicos e escopos emitidos; a autoria técnica do recebimento usa o emissor para preservar a FK/auditoria AV2.
- **Rate limit já escala horizontalmente?** Não: o store atual é local. A próxima etapa é um store Redis/gateway compartilhado.
- **Funciona em Windows?** Os scripts são Node multiplataforma e há CI de tipos/unitários no Windows. Não afirmamos ter certificado o Windows 10 ou o Ubuntu na revisão exata pedidos.
