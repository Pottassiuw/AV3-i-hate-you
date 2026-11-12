# Relatório técnico — Greencode AV3

## 1. Objetivo, fonte e continuidade

A atividade individual 3 do professor Eng. Dr. Gerson Penha pede a evolução do Greencode transacional para uma plataforma analítica e integrada. Foram considerados os três eixos das páginas 3–5 do `AV3.pdf`: análises, API pública segura/documentada e processamento assíncrono. A narrativa introdutória contextualiza possibilidades de negócio; não foi tratada como exigência de implementar todos os exemplos de BI ou machine learning.

A base é o repositório `Pottassiuw/AV2-i-hate-you`, commit `6a4138858db993740fde61738e5236b994bbaeec`. A nota 10 foi informada pelo aluno, não inferida do código nem usada como garantia de resultado nesta avaliação. A evolução preserva suas regras, migrações, auditoria e testes. Não há reescrita em outra stack, front-end artificial nem microserviços sem necessidade.

## 2. Arquitetura e segregação

```text
Clientes internos ── JWT ── /api/v1/internal ──┐
Administrador ────── JWT ── /api/v1/admin ─────┤
Parceiro ──── X-API-Key ── /api/v1/public ─────┤
                                            ↓
                         Fastify: validação, autenticação e autorização
                                            ↓
              serviços de negócio / análises / enfileiramento
                                            ↓
                                    Prisma → PostgreSQL
                                                   ↑
                  worker Node separado ─────────────┘
                       ↑                │
                node-cron UTC     calcula e publica resultados
```

- `src/app.ts` compõe a aplicação e pode ser usada por `Fastify.inject` sem abrir uma porta.
- `analytics/service.ts` recebe Prisma + organização + categoria; não depende de HTTP, JWT, cron ou fila.
- `partners/` concentra autenticação por chave, escopos, contratos e projeções de resposta públicas.
- `jobs/service.ts` concentra enfileiramento, reserva, retries, publicação atômica e CSV.
- `src/worker.ts` é outro processo Node, no mesmo projeto e banco. Nunca precisa receber uma chave de API para calcular.
- Rotas sem prefixo permanecem como aliases de compatibilidade AV2, com o mesmo JWT. O contrato recomendado para novos clientes internos é `/api/v1/internal`.

A API pública está na versão principal `v1`; a especificação e o modelo analítico têm versão semântica `1.0.0`. Correções compatíveis não mudam a URL; mudanças incompatíveis exigirão `/api/v2/public`, convivência temporária e aviso prévio. Ainda não existe versão depreciada, portanto não se publica um prazo de remoção fictício.

## 3. Estatística: escolha e métodos

### Por que MQO manual, não mathjs/simple-statistics?

O enunciado permite mínimos quadrados implementados manualmente. O escopo usa somente estatística descritiva e regressão de uma variável. As funções puras em `analytics/statistics.ts` são curtas, tipadas e testadas com resultados conhecidos; isso reduz dependências e torna a fórmula explicável na apresentação. Uma biblioteca robusta passaria a valer a pena com modelos multivariados, álgebra matricial ou métodos adicionais. Não se afirma que a implementação substitui um pacote científico geral.

Para valores `v`, calculamos média aritmética, mediana, máximo e desvio padrão **populacional** (`divisor n`), pois descrevemos os registros selecionados, não estimamos variância de uma população externa. Sem registros, métricas são `null`, não zero. Amostra unitária tem desvio zero.

Para pontos `(x, y)`, MQO estima:

```text
b = Σ((x − média(x)) × (y − média(y))) / Σ((x − média(x))²)
a = média(y) − b × média(x)
y estimado = a + b × x
R² = 1 − Σ(resíduo²) / Σ((y − média(y))²)
```

Recusamos menos de três pontos ou variância zero de `x`. `R²` é `null` para saúde constante e **não** representa probabilidade de acerto.

### 3.1 Eficiência operacional

Unidade principal: **lote completamente triado**. Duração em horas corridas = maior `triagemConcluidaEm` dos seus equipamentos − `dataEntrada`. Um lote aberto não entra na média de concluídos, mesmo que tenha equipamentos triados. Estados avançados também contam como triagem concluída; usamos o timestamp, não somente o status atual.

Saídas: `amostras`, `media`, `mediana`, `desvioPadrao`, `maximo`, `lotesConcluidos`, `lotesAbertos`, `porMes`, `porOperador` e os 20 lotes abertos mais antigos em `gargalos`.

- Por mês, agrupamos o mês de entrada, com ano: permite comparação sazonal sem misturar anos.
- Por operador, cada amostra é um **equipamento** e o responsável é quem confirmou `EM_TRIAGEM → AGUARDANDO_DESMONTE`.
- Não se atribui o tempo completo de um lote a cada operador nem se diz que o tempo decorrido representa trabalho exclusivo dele.
- A entrada da AV2 é `DATE`, sem hora: há uma imprecisão de até um dia. Não adicionamos retrospectivamente horários inexistentes.
- Gargalo é um indicador descritivo de espera, não prova causal de baixa produtividade.

### 3.2 Recuperação financeira por tipo, marca, modelo e estado

A AV2 já tem peso, idade, estado físico e parâmetros de imposto/depreciação. Não tem preço de venda ou custo de triagem. Portanto, entregamos **valor de recuperação estimado**, não lucro real.

```text
idade = max(0, ano da referência − ano de fabricação)
fator depreciação = max(0, 1 − taxa anual × idade)
recuperação do item = arredondar(peso × valor/kg × fator depreciação × fator estado, 2)
bruto do grupo = soma dos itens
média do grupo = bruto / quantidade
imposto = arredondar(bruto × alíquota, 2)
líquido estimado = bruto − imposto
```

Fatores didáticos explícitos: NOVO 1; BOM_ESTADO 0,9; USADO_LEVE 0,75; USADO_MODERADO 0,55; DANIFICADO_LEVE 0,35; DANIFICADO_GRAVE 0,1; INSERVIVEL 0. São aproximações declaradas, **não coeficientes fornecidos pelo professor nem cotações de mercado**. A convenção conservadora de INSERVIVEL=0 pode subestimar sucata; uma evolução deve cadastrar rendimento por material.

Os grupos são `(tipo, marca, modelo, estadoFisico)`, ordenados por valor médio decrescente. Não inventamos multiplicadores comerciais por marca/modelo: essas dimensões segmentam observações, mas não criam uma tabela de preços inexistente. Baixas definitivas são excluídas. Operações monetárias usam `Prisma.Decimal`, com strings de duas casas no JSON. O relatório registra os parâmetros usados, de modo que sua leitura futura não dependa dos parâmetros atuais.

O endpoint financeiro da AV2 continua com sua fórmula original (sem fator de estado); não quebramos silenciosamente seu contrato. A estimativa analítica é uma nova política versionada, documentada aqui e em cada resultado.

### 3.3 Vida útil remanescente

Usamos os estados históricos de `Movimentacao`, não somente o estado atual. Saúde varia de 1 a 0 conforme os fatores acima; observações `INSERVIVEL` representam falha. `x` é a idade em anos (365,25 dias), aproximando fabricação por 1º de janeiro, porque a base só possui o ano.

Agrupamos por tipo; mantemos a última observação por equipamento/dia para não inflar pontos com trocas logísticas no mesmo dia. Exigimos **ao menos três equipamentos** e idades distintas. Estimamos a idade de falha resolvendo `0 = a + b × idade`. Só há previsão se a inclinação é negativa (`b < −0,000001`) e a idade projetada fica entre 0 e 100 anos. Esse teto é uma proteção didática contra extrapolação absurda, não uma propriedade física.

- `DADOS_INSUFICIENTES`: coorte pequena ou sem variação de idade; previsão nula.
- `SEM_TENDENCIA_CONFIAVEL`: inclinação não degradante ou extrapolação fora do limite; previsão nula.
- `ESTIMADO`: projeção exploratória; informamos coeficientes, R², amostras, falhas e anos remanescentes por equipamento ativo.
- Já inservível: remanescente zero. Baixa definitiva não recebe previsão individual.

O histórico de condição/falha é a variável dependente; a depreciação financeira é publicada no relatório de recuperação. Não usamos depreciação contábil para fabricar falhas inexistentes. O enunciado cita ambas como fontes históricas, mas a AV2 não tinha valor de mercado observado ao longo do tempo. Essa lacuna permanece explícita; o modelo usa a fonte histórica efetivamente disponível. Futuramente, uma tabela de inspeções com valor observado, horas de uso e falhas permitiria integrar as duas fontes sem circularidade.

**Limites:** observações repetidas do mesmo equipamento são correlacionadas, há viés de seleção de eletrônicos descartados, fabricação aproximada e censura dos equipamentos ainda ativos. Não há amostra real extensa, validação temporal fora da amostra, intervalo de confiança nem certificação de confiabilidade. Uma inclinação negativa com R² baixo ainda é apresentada como exploratória, não como recomendação automática de descarte. Antes de uso comercial, comparar previsões arquivadas com falhas futuras, medir MAE/erro temporal e avaliar análise de sobrevivência.

## 4. Modelo de persistência

| Tabela nova          | Responsabilidade                                                                                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ChaveApi`           | Organização, administrador emissor, prefixo, hash único, escopos, limite, criação, validade e revogação                                                                    |
| `RelatorioAnalitico` | Organização, categoria, versão semântica do modelo, criação e documento JSONB contendo referência, parâmetros, métricas e limitações                                       |
| `TarefaRelatorio`    | Organização, chave solicitante opcional, categoria, formato, status, tentativas, disponibilidade, lease, erro público, vínculo único com resultado e chave de deduplicação |

FKs impedem órfãos e remoção acidental de entidades referenciadas. Índices apoiam buscas por organização/categoria/data e fila por status/disponibilidade. CHECKs protegem categorias, formatos, limites e número de tentativas. Um trigger impede UPDATE/DELETE das fotografias analíticas, como a AV2 já fazia com movimentações e auditoria.

Cada geração cria um novo relatório. Não sobrescrevemos “último resultado”: preservamos previsões anteriores para comparações futuras. JSONB foi escolhido porque as categorias têm estruturas diferentes; os metadados consultados frequentemente são colunas relacionais. Custos: grandes documentos aumentam tamanho do banco e não têm schema SQL detalhado por métrica. Uma evolução pode extrair previsões individuais para uma tabela normalizada com métricas de erro realizado.

O cálculo lê uma fotografia `RepeatableRead`; parâmetros e dados não são misturados entre versões. O resultado guarda a referência e a versão do modelo; em execução assíncrona, a fotografia corresponde ao **processamento**, não ao instante de solicitação. O relatório agendado usa a mesma função de cálculo da API.

## 5. Autenticação, autorização e limites

- O administrador emite chaves com `crypto.randomBytes(32)` (256 bits), prefixadas por `gc_`.
- Guardamos somente SHA-256 do segredo, nunca segredo em texto puro. Não usamos bcrypt para um segredo aleatório de alta entropia: não há senha humana a resistir a dicionário.
- A chave só aparece na resposta de emissão (`Cache-Control: no-store`). Listagem e auditoria usam projeções sem hash/segredo. Logs ocultam `Authorization` e `X-API-Key`.
- Expiração padrão 90 dias (máximo 365); revogação é imediata. A cada requisição verificamos organização e emissor ativos. Desativá-los invalida o acesso; não há cache de credencial que atrase a revogação.
- Escopos: `rastreabilidade:ler`, `lotes:escrever`, `analises:ler`, `relatorios:gerar`.
- `analises:ler` permite calcular/consultar relatórios derivados; o POST persiste a fotografia, mas não altera dados operacionais.
- Organização sempre vem da chave, nunca de um `organizacaoId` público. IDs de outra organização devolvem 404. Tarefas e resultados podem ser consultados por **outras chaves da mesma organização** com o escopo correspondente (política organizacional, não pessoal).
- O recebimento reutiliza `createLot`, com o usuário emissor como responsável técnico e o papel operacional mínimo apenas nessa chamada. O parceiro não recebe JWT nem o papel do administrador. A chave solicitante fica nas tarefas; a auditoria operacional do lote usa o emissor. Uma futura evolução deve adicionar o identificador da chave à auditoria do recebimento para granularidade por integração.
- Respostas de rastreabilidade excluem responsável, e-mail, justificativa e observações livres. Relatórios por operador usam identificadores internos, não nomes/e-mails; ainda exigem cuidado de governança por serem pseudônimos.

`@fastify/rate-limit` aplica janela de um minuto por chave: padrão 60, ajustável de 1 a 600. Há um limite amplo pré-autenticação de 3000/minuto por IP para reduzir abuso do banco. Excesso retorna 429 e `Retry-After`. O limitador por IP usa `createRateLimit`, separado do handler por chave; dois handlers `rateLimit()` na mesma requisição não funcionariam, pois o plugin marca a execução e pula o segundo. O teste de limite por chave protege essa integração.

**Limite atual:** contadores estão na memória de cada instância HTTP. Reinícios zeram a janela e réplicas multiplicam o limite; não é rate limit distribuído. Para escalar, configurar armazenamento Redis do plugin/gateway e política de quota diária por organização. `trustProxy` não é habilitado indiscriminadamente; se houver proxy, configurar somente proxies confiáveis para evitar falsificação de IP.

O Swagger inclui autenticações distintas, parâmetros, exemplos, schemas de resposta e erros. A estrutura interna do resultado analítico é um documento flexível (JSONB); as métricas detalhadas estão nesta seção e nos resultados. CSV tem UTF-8/BOM e colunas `caminho,valor`, com caminhos hierárquicos normalizados; aspas e quebras são escapadas e valores iniciados por caracteres de fórmula são protegidos.

## 6. Fila, retry e consistência

### Por que PostgreSQL em vez de BullMQ/Redis?

O PDF sugere BullMQ, não o impõe como única implementação. Para o volume acadêmico, já há um banco transacional confiável. Uma fila nele evita mais um serviço obrigatório no Windows/Linux e evita o problema de gravar a solicitação no banco e falhar antes de publicar em Redis. A fila é **durável**, não um array em memória. O worker é um processo separado e pode ser replicado.

Fluxo:

1. API persiste `PENDENTE` e retorna 202 + `Location` + `Retry-After: 2`.
2. Worker procura uma tarefa elegível em ordem de disponibilidade/ID.
3. Um **compare-and-swap** (`updateMany` com ID, tentativas e lease observados) reserva a tarefa atomicamente; concorrentes perdedores tentam novamente, no máximo dez disputas por ciclo.
4. Incrementa tentativas e cria token UUID de lease, válido por 120 segundos.
5. Calcula fora da transação de reserva, com timeout de leitura de 60 segundos.
6. Publica relatório e conclui a tarefa na **mesma transação**, somente se o lease/token ainda pertence ao worker.
7. O cliente faz polling; antes de conclusão, download devolve 409; depois, fornece JSON ou CSV sem arquivos temporários compartilhados.

Sem trabalho, o worker espera um segundo. Usa processamento at-least-once: após crash, um lease vencido pode ser reservado por outro worker. O token atua como fencing; um worker antigo não publica depois de perder o lease. A publicação é efetivamente única por tarefa, protegida por condição e vínculo único. Não prometemos execução exatamente uma vez do cálculo.

### Política de falha

Máximo **três tentativas**. Após a primeira falha: 5 segundos; após a segunda: 10 segundos; após a terceira: `FALHOU` sem nova execução. A função de backoff calcula 20 segundos no terceiro registro, mas a data não reativa tarefas em falha terminal. Exceções não são expostas: a mensagem pública é genérica, sem credenciais/SQL.

Se a terceira tentativa morrer sem conseguir registrar erro, a varredura converte `EXECUTANDO` com lease vencido em `FALHOU`. Se o banco cair ao registrar falha, o lease ainda permite recuperação posterior. Nenhum heartbeat foi implementado: o timeout do cálculo é menor que o lease, e o fencing impede publicação tardia. Relatórios que exijam mais de dois minutos precisam de divisão em etapas ou heartbeat, não apenas um timeout HTTP maior. Workers precisam de relógios sincronizados (NTP), porque a elegibilidade usa o horário do processo.

Tarefas terminais ficam retidas para inspeção; uma nova solicitação cria nova tarefa. Não há retry infinito nem endpoint público de alteração de status. A chave de origem pode ser revogada após enfileirar: isso impede novas consultas, mas não cancela automaticamente um relatório da organização já solicitado.

### Agendamento

`node-cron`: `ANALYTICS_CRON`, padrão `0 2 * * *`, timezone UTC. Ao iniciar, o worker também agenda o dia corrente (catch-up, não todos os dias passados). A chave única `diario:AAAA-MM-DD:organizacaoId` evita duplicação entre reinícios/workers. O `upsert` vazio do Prisma pode competir no INSERT; tratamos especificamente `P2002` e recuperamos a linha vencedora. A concorrência foi reproduzida e testada. Não fazemos `catch` genérico que esconda indisponibilidade do banco.

## 7. Evolução para centenas/milhares de parceiros

1. **Limites distribuídos e backpressure:** Redis/gateway para quotas e limite global de tarefas pendentes por organização; hoje a taxa limita chamadas, mas não limita o backlog acumulado ao longo de dias.
2. **Fila de maior escala:** BullMQ/Redis com persistência configurada e outbox transacional no PostgreSQL para não perder solicitações entre os dois sistemas. Alternativamente, aprimorar a fila SQL com `FOR UPDATE SKIP LOCKED`, particionamento e prioridade justa por organização.
3. **Processamento:** lotes/paginação de registros e agregação SQL, evitando carregar toda a organização em memória. Hoje a leitura usa `findMany` e até 60 segundos; o caminho assíncrono evita prender HTTP, mas não elimina esse limite.
4. **Isolamento:** adicionar políticas de segurança por linha (RLS), credenciais separadas HTTP/worker e orçamento de processamento por cliente. Atualmente o isolamento é aplicado nos filtros dos serviços públicos.
5. **Armazenamento:** documentos grandes em object storage, URLs assinadas curtas; banco apenas com metadados e checksum. Retenção/LGPD precisam de política explícita; o histórico atual é somente acréscimo e não tem expurgo automático.
6. **Observabilidade:** métricas de backlog, idade da tarefa, retries, latência por categoria; tracing e logs estruturados com identificador da tarefa e sem dados sensíveis.
7. **Estatística:** inspeções/valores observados, validação temporal, comparação previsão × realização e modelos de sobrevivência; não usar dados sintéticos como comprovação de acurácia.
8. **Contrato:** idempotency key para novas solicitações públicas, webhooks assinados como alternativa a polling e plano de depreciação da API. Hoje a deduplicação é somente do agendamento diário; repetir POST público pode criar nova tarefa.

## 8. Portabilidade e validação

Scripts de execução usam Node/tsx e caminhos portáveis; não dependem de `bash`, `cp`, `rm`, `export` ou de um serviço de sistema exclusivo de Linux. O comando de cópia do README funciona em PowerShell e shell POSIX. PostgreSQL pode ser nativo em ambos. Docker no Windows requer Docker Desktop/WSL2 compatível; os containers usam Linux, não imagens Windows. Não se exige Redis.

A suíte completa usa PostgreSQL real e schemas isolados. A suíte unitária não exige banco. CI Linux cobre integração; CI Windows cobre instalação, geração, tipos e testes unitários. Esse arranjo **não certifica Windows 10 nem a revisão exata Ubuntu 24.04.3**, porque runners têm suas próprias versões. Também não simula o banco com SQLite, que não cobriria Decimal, enum, trigger, FKs e concorrência reais.

Na sessão de implementação foi possível iniciar um PostgreSQL real de desenvolvimento em porta temporária (sem alterar permissões do Docker) e executar migrações/testes. Ver `docs/validacao.md` para o registro final e limites. A documentação AV2 é material herdado; quaisquer evidências antigas de navegador ou sistemas operacionais não são apresentadas como novas execuções da AV3.

Para implantação comercial: TLS, backups/restauração testada, segredos aleatórios, usuário SQL com privilégio mínimo, monitoramento, quotas duráveis e testes nos sistemas-alvo exatos continuam necessários.
