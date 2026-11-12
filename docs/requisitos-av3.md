# Matriz de requisitos — AV3

Fonte: `AV3.pdf`, “Atividade de avaliação individual 3”, professor Eng. Dr. Gerson Penha. Páginas abaixo são as páginas físicas do PDF de cinco páginas. Sugestões de biblioteca foram distinguidas dos requisitos funcionais.

| ID  | Referência     | Critério                                                                              | Implementação / evidência                                                                                                   |
| --- | -------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| A01 | p. 3–4         | Node.js, TypeScript e Prisma para módulo analítico independente                       | `src/modules/analytics/service.ts`; usado por rotas e worker                                                                |
| A02 | p. 4           | Eficiência: tempo entre entrada e conclusão da triagem, variação por operador/período | Média/mediana/desvio/máximo, grupos por mês e operador, abertos/gargalos; teste com duração conhecida de 48 h               |
| A03 | p. 4           | Valor médio de recuperação por equipamento, considerando estado/marca/modelo          | Decimal, idade, condição, agrupamento tipo/marca/modelo/estado; teste de recuperação R$144 e líquido R$115,20               |
| A04 | p. 4           | Vida útil com regressão ou suavização                                                 | MQO manual, permitido explicitamente; coorte por tipo, histórico de condição e falhas, regressão testada com reta conhecida |
| A05 | p. 4           | Persistir previsões/relatórios para consulta histórica                                | `RelatorioAnalitico`, versão de modelo, referência, JSONB, trigger de imutabilidade, endpoint de histórico                  |
| A06 | p. 3–4         | Serviços acessíveis por endpoints e tarefas agendadas                                 | `/analises/:categoria`, `src/worker.ts`, `node-cron`, mesma função de cálculo                                               |
| A07 | p. 4           | API pública com chave única por parceiro e permissões                                 | `ChaveApi`, segredo de 256 bits, hash, escopos, emissão/listagem/revogação administrativas                                  |
| A08 | p. 4           | Limite de requisições por cliente                                                     | `@fastify/rate-limit`, chave, janela de um minuto, 429/Retry-After, teste de independência entre chaves                     |
| A09 | p. 4           | Documentação interativa com entradas, respostas, parâmetros e erros                   | Swagger `/docs`, OpenAPI `/docs/json`, schemas, exemplos e jornada `docs/av3.http`                                          |
| A10 | p. 4           | Segregação pública/interna/administrativa e versionamento                             | `/api/v1/public`, `/api/v1/internal`, `/api/v1/admin`; testes de segregação JWT/API key                                     |
| A11 | p. 3, contexto | Consulta de rastreabilidade e submissão de lotes por parceiros                        | Endpoints públicos reutilizam regras de lote e projetam eventos sem dados pessoais; isolamento por organização testado      |
| A12 | p. 5           | Operação assíncrona: identificador imediato, status e download                        | POST 202 + Location; fila durável; polling; download JSON/CSV; 409 antes de concluir                                        |
| A13 | p. 5           | Justificar fila/retry e crescimento de parceiros                                      | Relatório técnico, lease, três tentativas, backoff, fencing e evolução Redis/outbox/quotas                                  |
| A14 | p. 5           | Código-fonte completo e relatório técnico                                             | Este repositório, migrações, testes, README, relatório e roteiro                                                            |
| A15 | p. 5           | Compatibilidade Windows 10+, Ubuntu 24.04.3+ e derivados                              | Scripts Node multiplataforma, banco nativo/Compose, CI Linux e Windows; execução nos sistemas-alvo exatos não é alegada     |

## Escolhas permitidas pelo enunciado

- **MQO manual** em lugar de simple-statistics/mathjs: permitido no texto e suficiente para o escopo.
- **Fila PostgreSQL** em lugar de BullMQ/Redis: o texto propõe BullMQ como possibilidade. A entrega mantém o padrão assíncrono e a durabilidade, com trade-offs no relatório.
- **Polling** em lugar de webhook: atende ao fluxo descrito; não há endpoint de webhook fictício.
- **Sem front-end novo:** a entrega esperada é código da camada analítica e API documentada, com justificativas. Swagger permite exploração no navegador.

## Hipóteses que não foram atribuídas ao professor

Fatores financeiros de estado, limiar de amostra, teto de projeção de 100 anos, unidade do desvio padrão, janela de rate limit, prazo de chave e política de retry são decisões deste projeto, explicitadas no relatório. A regressão usa saúde/falha observada, não uma série de valor de mercado que a AV2 não possui. Não há promessa de precisão, lucro real ou nota.
