# Greencode · AV3

Evolução da [AV2](https://github.com/Pottassiuw/AV2-i-hate-you): logística reversa com **inteligência analítica, API de parceiros e relatórios assíncronos**. Node.js 22, TypeScript, Fastify, Prisma e PostgreSQL; sem front-end adicional ou serviços pagos.

A AV2 foi preservada (cadastros, contratos, lotes, triagem, rastreabilidade, JWT, papéis, versões e auditoria). A nova camada é independente e atende tanto HTTP quanto o worker agendado.

## Iniciar

Requisitos: **Node ≥22.12** e **PostgreSQL 17+**, nativo ou via Docker Compose. Compatível por projeto com Windows 10+, Ubuntu 24.04.3+ e derivados; veja [plataformas e limites de validação](docs/relatorio-tecnico.md#8-portabilidade-e-validação).

```sh
npm ci
node -e "require('node:fs').copyFileSync('.env.example', '.env')"
docker compose up -d --wait
npm run setup
npm run demo:analytics
npm run dev
```

Em **outro terminal**, na mesma pasta:

```sh
npm run worker
```

- API: <http://127.0.0.1:3000>
- Swagger interativo: <http://127.0.0.1:3000/docs>
- OpenAPI JSON: <http://127.0.0.1:3000/docs/json>
- Saúde do HTTP/banco: <http://127.0.0.1:3000/health>

Se já tiver PostgreSQL, **não precisa de Docker**: crie um banco e ajuste `DATABASE_URL` no `.env`. Nunca sobrescreva seu `.env` existente ao atualizar. `setup` aplica migrações incrementais, sem reset. O seed não redefine contas existentes. Use `npm start` para executar sem watch.

### Contas locais

Senha de demonstração: `GreencodeDemo123!` (definida no `.env.example`).

| E-mail                         | Papel                                   |
| ------------------------------ | --------------------------------------- |
| `admin@greencode.local`        | Administrador                           |
| `cadastro@greencode.local`     | Operador de cadastro                    |
| `almoxarifado@greencode.local` | Operador de almoxarifado                |
| `auditor@greencode.local`      | Auditor, somente consultas operacionais |

**Não exponha as credenciais de desenvolvimento na internet.** Em produção, altere senha/JWT, desative seeds demonstrativos e use HTTPS.

## Demonstrar a AV3

1. `npm run demo:analytics` imprime um `organizacaoId` do **Laboratório AV3 — DADOS SINTÉTICOS**. Esse comando é opcional, reexecutável e não altera equipamentos já existentes. Os resultados são exemplos, não evidência de capacidade preditiva real.
2. No Swagger, faça `POST /api/v1/internal/auth/login` com `email` e `senha` do administrador. Copie o `token` para **Authorize → bearerAuth**.
3. Faça `POST /api/v1/admin/chaves-api`:

```json
{
  "nome": "Parceiro da apresentação",
  "organizacaoId": "SUBSTITUA-PELO-ID-DO-LABORATORIO",
  "permissoes": [
    "rastreabilidade:ler",
    "lotes:escrever",
    "analises:ler",
    "relatorios:gerar"
  ],
  "limiteMinuto": 60,
  "validadeDias": 90
}
```

4. Guarde o campo `chave` **agora**; não será devolvido novamente. Em **Authorize → apiKey**, informe essa chave (sem `Bearer`).
5. `POST /api/v1/public/analises/completo` gera e persiste as três análises. `GET /api/v1/public/analises/historico` permite comparar fotografias anteriores.
6. `POST /api/v1/public/relatorios` com `{"categoria":"completo","formato":"csv"}` retorna **202**, um `id` e o cabeçalho `Location`, sem esperar pelo cálculo.
7. Com o worker rodando, consulte `GET /api/v1/public/relatorios/{id}` até `CONCLUIDO`. Baixe em `GET /api/v1/public/relatorios/{id}/download`.
8. Emita uma chave apenas de leitura e demonstre **403** na escrita. Emita outra com `limiteMinuto: 2` e consulte três vezes: a terceira retorna **429** com `Retry-After`.
9. Revogue a chave com `DELETE /api/v1/admin/chaves-api/{id}` e demonstre **401** imediatamente.

Veja também [jornada HTTP AV3](docs/av3.http) e [roteiro de apresentação](docs/apresentacao-av3.md).

## O que foi acrescentado

| Pilar                  | Implementação                                                                                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Eficiência operacional | Média, mediana, desvio padrão e máximo em horas; lotes completos, abertos/gargalos, grupos por mês e por operador                                                       |
| Recuperação financeira | Estimativa em BRL agrupada por tipo, marca, modelo e estado físico; parâmetros e fatores publicados; Decimal para valores monetários                                    |
| Vida útil              | MQO de saúde × idade a partir do histórico de estados e falhas; R², tamanho da amostra, previsão por equipamento e ausência explícita de estimativa quando insuficiente |
| Histórico analítico    | Fotografias imutáveis, organização, categoria, referência, versão do modelo e JSON dos resultados                                                                       |
| API pública            | `/api/v1/public`, autenticação `X-API-Key`, escopos, isolamento por organização, expiração e revogação                                                                  |
| Segurança/contrato     | Chaves aleatórias de 256 bits, só SHA-256 armazenado; limite por chave, proteção ampla por IP, schemas e Swagger                                                        |
| Assíncrono             | Fila durável PostgreSQL, worker separado, polling, downloads JSON/CSV, três tentativas e recuperação após crash                                                         |
| Agendamento            | `node-cron`, diariamente às 02:00 UTC; catch-up ao iniciar e deduplicação por organização/dia                                                                           |

**A estimativa de recuperação não é lucro realizado. A previsão de vida útil é exploratória e não é uma garantia.** A AV2 não tinha preços de venda, custos nem séries de falhas extensas; as hipóteses e limites são parte do relatório, não escondidos no código.

## Contrato e segregação

| Prefixo                  | Credencial           | Finalidade                                               |
| ------------------------ | -------------------- | -------------------------------------------------------- |
| `/api/v1/internal`       | JWT (exceto login)   | Funcionalidades da AV2 e análises internas               |
| `/api/v1/admin`          | JWT de administrador | Emitir, listar metadados e revogar chaves                |
| `/api/v1/public`         | `X-API-Key`          | Operações de parceiros, limitadas à organização da chave |
| Rotas sem prefixo da AV2 | JWT (exceto login)   | Compatibilidade; não dão acesso a parceiros              |

Listagens paginadas usam `pagina` e `limite` (1–100). Erros seguem `{"erro":"CODIGO","mensagem":"Descrição"}`. As rotas públicas documentam 400/401/403/404/409/422/429/500. Dinheiro é string decimal; datas são ISO/UTC. Um ID de outra organização retorna o mesmo **404** de um ID inexistente.

## Scripts e testes

```sh
npm run typecheck
npm run test:unit  # estatística, retry e CSV; não exige banco
npm test          # integração AV2 + AV3 e testes unitários; exige PostgreSQL
```

Os testes de integração criam **schemas aleatórios e descartáveis** e os removem ao terminar. Não apagam seus dados de desenvolvimento. O usuário de teste precisa de permissão para criar schemas; use um banco de desenvolvimento. Não execute testes com credenciais de produção.

| Script                                 | Uso                                                               |
| -------------------------------------- | ----------------------------------------------------------------- |
| `setup`                                | Gerar Prisma Client, aplicar migrações e seed básico              |
| `demo:analytics`                       | Importar dados sintéticos identificados e gerar exemplo analítico |
| `dev` / `start`                        | Servidor com / sem watch                                          |
| `worker`                               | Consumir fila e agendar relatórios diários                        |
| `db:migrate` / `db:seed` / `db:studio` | Operação do banco                                                 |

## Documentação da entrega

- **[Relatório técnico AV3](docs/relatorio-tecnico.md)** — decisões arquiteturais, fórmulas, modelagem, retry, escalabilidade e portabilidade.
- **[Matriz de requisitos AV3](docs/requisitos-av3.md)** — relação com as páginas 3–5 do documento do professor e evidências.
- **[Análise da AV2](docs/analise-av2.md)** — origem, pontos preservados e lacunas resolvidas.
- [Roteiro de apresentação AV3](docs/apresentacao-av3.md).
- [Glossário herdado](GLOSSARY.md) e documentação AV2 em `docs/` — referência histórica, não nova evidência de execução.

O projeto é uma entrega acadêmica funcional, não uma certificação de produção: exige implantação apropriada de TLS, backups, observabilidade, retenção e limite distribuído antes de escalar para múltiplas instâncias HTTP.
