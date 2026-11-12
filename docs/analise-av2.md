# Análise da predecessora AV2

Repositório analisado: <https://github.com/Pottassiuw/AV2-i-hate-you>, commit `6a4138858db993740fde61738e5236b994bbaeec`. A informação de nota 10 veio do aluno. A inspeção foi de código, schema, migrações, testes e documentação; não uma consulta à avaliação original do professor.

## Pontos fortes preservados

- **Stack coerente:** Node 22, TypeScript estrito, Fastify/TypeBox e Prisma com PostgreSQL real. Não havia razão para trocar ORM/framework.
- **Serviços separados de HTTP:** as regras recebem Prisma e ator, o que permite reutilizar `createLot` na integração externa sem duplicar recebimento, validação e auditoria.
- **Transações de negócio:** recebimento atômico, movimentação + histórico + auditoria, recálculo consistente do lote.
- **Concorrência explícita:** versões condicionais e locks por lote. Não bastava apenas atualizar status e depois gravar histórico.
- **Segurança interna:** JWT com revogação por versão, conta ativa, quatro papéis e proteção do último administrador.
- **Banco como parte da solução:** Decimal, unicidade, CHECKs, FKs e triggers para histórico somente acréscimo.
- **Testes representativos:** jornadas HTTP, falha de persistência, rollback e concorrência, em schemas descartáveis; mantidos na AV3.
- **Documentação didática:** políticas e lacunas do enunciado declaradas em vez de inventar exigências do professor.

## O que faltava especificamente para a AV3

| AV2                                                               | Evolução nesta entrega                                                                  |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Relatórios descritivos por status/organização e financeiro linear | Serviços analíticos com eficiência, segmentação de recuperação e regressão de vida útil |
| Relatório calculado na consulta, sem histórico analítico          | Fotografias JSONB imutáveis com versão do modelo e referência                           |
| JWT para usuários internos                                        | Chaves aleatórias por organização com escopos, validade e revogação                     |
| Limite de tentativas de login                                     | Também limite contratual por chave e proteção ampla pré-autenticação por IP             |
| Rotas de uso interno sem prefixo                                  | Segregação `/api/v1/public`, `/internal` e `/admin`, preservando aliases AV2            |
| Sem processamento assíncrono de relatórios                        | Fila durável no PostgreSQL, worker, lease, retry e polling/download                     |
| Sem rotina analítica agendada                                     | `node-cron` diário e deduplicação entre workers                                         |
| Seed operacional pequeno                                          | Seed opcional de coortes sintéticas, claramente rotulado                                |

## Decisões de continuidade

1. Não transformar a atividade em uma interface visual: o professor pede a plataforma/API e o Swagger já é uma interface de demonstração apropriada.
2. Não quebrar endpoints, fórmulas ou testes AV2 sem necessidade. O financeiro original continua sendo original; o fator de condição pertence ao relatório analítico novo.
3. Reutilizar o histórico de estados da AV2 como evidência disponível para regressão; recusar uma previsão fictícia em base vazia ou insuficiente.
4. Evitar Redis obrigatório nesta escala, mantendo fila durável e documentando o caminho de evolução.
5. Preservar documentação antiga como referência histórica, mas não atribuir à AV3 evidências de navegador/ambientes que não foram executadas novamente.

## Dependências

A instalação inicial herdou três alertas moderados de dependências transitivas do Swagger estático. O lockfile foi atualizado por `npm audit fix`, sem troca major do Prisma/Fastify. A validação final inclui `npm audit`; ela descreve o resultado daquela execução, não garante ausência futura de vulnerabilidades.
