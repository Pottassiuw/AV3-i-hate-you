# Registro de validação — AV3

Este registro descreve execuções locais desta implementação. Não incorpora como próprias as evidências antigas da documentação AV2.

## Ambiente

- Linux da sessão de desenvolvimento, Node.js `v22.23.3`, npm `10.9.9`.
- PostgreSQL real temporário, instalado fora do projeto para validação, em `127.0.0.1:55432`.
- O socket Docker da máquina não estava acessível ao usuário. Não foram alteradas permissões nem solicitado acesso privilegiado: usamos PostgreSQL nativo temporário, que também é uma opção suportada pelo projeto.
- Dependências de aplicação continuam definidas em `package.json`/`package-lock.json`; o utilitário usado para disponibilizar o PostgreSQL temporário não foi adicionado ao projeto.

## Resultados

| Verificação | Resultado |
| --- | --- |
| `npm ci` | Instalação reproduzível pelo lockfile |
| `prisma generate` / `prisma validate` | Client gerado, schema válido |
| `npm run setup` em banco limpo | Quatro migrações aplicadas, seed básico concluído |
| `npm run demo:analytics` duas vezes | Sem duplicar equipamentos; novas fotografias históricas geradas |
| `npm run typecheck` | Sem erros TypeScript |
| `npm run test:unit` | 3 testes aprovados, sem banco |
| `npm test` com PostgreSQL real | **49 testes aprovados; 0 falhas; 0 ignorados** |
| `npm audit` | Zero vulnerabilidades reportadas no lockfile desta execução |
| Smoke por socket HTTP real | Saúde, login, chave, 202/PENDENTE, worker, CONCLUIDO, download CSV, histórico e `/docs/json` |
| SIGTERM nos processos HTTP e worker | Ambos encerraram com código 0 |

A suíte completa tem 28 testes herdados da AV2, 18 cenários adicionais da AV3 e 3 testes unitários. Os cenários novos incluem chaves/escopos/expiração/revogação, isolamento entre organizações, limites por chave e por IP, números analíticos conhecidos, histórico imutável, polling/download, concorrência de workers, retry terminal, recuperação de lease, fencing real e deduplicação concorrente do agendamento.

## Problemas encontrados e corrigidos pelos testes

- O `upsert` vazio do Prisma podia competir na restrição de deduplicação diária: tratamos especificamente o conflito de unicidade e recuperamos a tarefa vencedora.
- Dois handlers `rateLimit()` do plugin na mesma requisição faziam o segundo ser ignorado: o limite pré-autenticação passou a usar `createRateLimit` e a verificar `isExceeded`, respeitando a distinção do plugin entre allowlist e janela de consumo.
- Parâmetros de teste precisavam ser atualizados explicitamente, pois a migração AV2 já cria o registro singleton com valores padrão.

## Limites da comprovação

- Não foram executados Windows 10 nem Ubuntu na revisão exata 24.04.3. Portabilidade foi considerada no código/scripts e há jobs CI apropriados; esses jobs dependem da execução no provedor.
- Não houve teste de carga em milhares de parceiros, garantia de acurácia preditiva real, auditoria externa de segurança nem certificação de produção.
- Não foi executado um navegador gráfico nesta validação. O OpenAPI e o fluxo HTTP foram validados programaticamente; as antigas referências a Chromium em `docs/apresentacao.md` pertencem à AV2.
- Zero alertas no `npm audit` é o resultado pontual da base de advisories consultada pela ferramenta, não garantia permanente de ausência de falhas.

Para reproduzir: siga o README, use um PostgreSQL de desenvolvimento, execute `npm run setup`, `npm run typecheck` e `npm test`. A suíte usa schemas aleatórios descartáveis; não faça isso com usuário/banco de produção.
