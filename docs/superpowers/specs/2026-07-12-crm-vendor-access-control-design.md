# CRM: Controle de Acesso por Vendedor (Funil, Clientes, Inbox)

> **Nota sobre este spec:** a investigação e a proposta foram feitas sem o fluxo normal de brainstorming em tempo real (o usuário tinha autorizado avançar sozinho enquanto dormia, mas eu parei antes do plano por ser uma decisão de acesso a dados da equipe inteira). Em 2026-07-12 o usuário revisou e confirmou a recomendação nas 3 decisões abaixo — as escolhas estão fechadas, o spec segue pro plano de implementação.

## Contexto

Este é o item **B** dos três discutidos no brainstorming original (2026-07-10): **A** (gestão de usuários em Configurações) está pronto, revisado e em produção. **B** é restringir de verdade quem vê o quê no Funil e no Inbox por vendedor — hoje qualquer usuário logado vê os negócios/conversas de todo mundo, só a escrita (mover/editar/excluir) já é restrita a não-admins.

Investigando o código antes de propor qualquer coisa, o problema é maior e mais inconsistente do que a formulação original ("restringir Funil e Inbox") sugeria — ver Achados abaixo.

## Achados do estado atual

### 1. O padrão de restrição por dono já existe, mas só na escrita, e só em `negocios` e `clientes`

- `negocios` (Funil): `moverNegocio`, `atualizarNegocio`, `excluirNegocio` (`app/dashboard/funil/actions.ts`) já restringem não-admin a `responsavel_id = user.id`. A leitura (`app/dashboard/funil/page.tsx:8-12`) não filtra nada — todo mundo vê todos os negócios na tela.
- `clientes`: mesmo padrão exato — `editarCliente`/`excluirCliente` (`app/dashboard/clientes/actions.ts`) restringem por `user_id`, mas a leitura (`app/dashboard/clientes/page.tsx:12-15`) também não filtra nada.
- Em nenhum dos dois lugares o perfil `gerente` é tratado diferente de `vendedor` — a checagem é sempre `perfil !== 'admin'` (nunca "sou gerente, então vejo o time"). Isso significa que, hoje, um gerente tem exatamente as mesmas restrições de escrita que um vendedor.

### 2. O Inbox (`conversations`/`contacts`) não tem NENHUM conceito de dono

Diferente de `negocios`/`clientes`, as tabelas usadas pelo Inbox (`conversations`, `contacts`, `messages` — schema em `agente-de-ia`) não têm nenhuma coluna de responsável. Não existe hoje nenhum jeito de saber "essa conversa é de qual vendedor" a nível de dado.

### 3. O botão "Funil" do Inbox cria Cliente/Negócio sem dono nenhum

`adicionarAoFunil` (`app/dashboard/inbox/actions.ts:186-222`) — acionado pelo botão "Funil" na conversa — usa `createAdminClient()` (client de service role, sem `getAuthUser()`/sessão) e faz:

```ts
await supabase.from('clientes').insert({ nome: contactName, telefone: phone, status: 'lead' })
// ...
await supabase.from('negocios').insert({ titulo, valor, etapa: etapaValida, cliente_id: clienteId, motivo_encerramento: null })
```

Nem `clientes.user_id` nem `negocios.responsavel_id` são preenchidos — ficam `null`. Isso já é uma inconsistência hoje (antes de qualquer restrição de leitura): um negócio criado direto no Funil (`criarNegocio`) sempre tem dono; um negócio criado pelo botão "Funil" do Inbox, nunca tem. Se a leitura passar a filtrar por `responsavel_id`, todo negócio/cliente criado por esse caminho ficaria invisível pra todo mundo (exceto admin) — um bug novo, não só uma limitação.

### 4. Não existe nenhuma ligação real entre `contacts` (WhatsApp) e `clientes` (Funil)

A única correspondência é um match de telefone feito ad-hoc em pontos específicos do código (`adicionarAoFunil`, o botão "Funil" da conversa). Não é uma foreign key — é comparação de string. Um contato do WhatsApp só tem um `Cliente`/`Negocio` associado se alguém explicitamente clicou em "Funil" ou criou o negócio manualmente com aquele telefone.

## Decisões (confirmadas pelo usuário em 2026-07-12)

### Decisão 1 — Como o Inbox sabe de quem é a conversa?

**Confirmado: Opção B — adicionar `contacts.responsavel_id` de verdade.** Migration nova em `agente-de-ia` (nova coluna, nullable — contato sem dono continua existindo, só não aparece pra vendedor nenhum até ser atribuído). Atribuição automática: o primeiro vendedor que responde a conversa vira o dono (grava no primeiro envio de mensagem pelo CRM), com opção de reatribuir manualmente depois.

Junto com isso, corrigir o Achado 3 (`adicionarAoFunil` passa a receber e gravar o `user_id` de quem clicou, em vez de usar só o client admin sem sessão) — os dois problemas são a mesma causa raiz.

### Decisão 2 — `gerente` vê o time inteiro, ou só o próprio, igual vendedor?

**Confirmado: gerente vê o time inteiro** (visão de supervisão), igual admin. A restrição de leitura passa a valer só pra `vendedor` — a checagem vira `perfil === 'vendedor'` em vez do atual `perfil !== 'admin'`.

### Decisão 3 — Restringir só Funil+Inbox, ou também Clientes (leitura)?

**Confirmado: incluir Clientes** na mesma restrição de leitura, já que a lógica e o padrão são idênticos aos de negócios.

## Design proposto

- **`agente-de-ia`**: migration adicionando `contacts.responsavel_id uuid null references profiles(id)`. Nenhuma FK cross-database de verdade (profiles é do `meu-crm`/Supabase Auth, mas ambos os repos já compartilham o mesmo projeto Supabase, então a FK funciona).
- **`meu-crm`**:
  - `app/dashboard/funil/page.tsx` e `app/dashboard/clientes/page.tsx`: leitura passa a filtrar por `responsavel_id`/`user_id` quando `perfil === 'vendedor'` (admin e gerente veem tudo).
  - `app/dashboard/inbox/actions.ts` (`getConversacoes`): mesmo filtro, via `contacts.responsavel_id`, quando vendedor.
  - Atribuição automática: primeira mensagem enviada pelo CRM numa conversa sem dono grava `responsavel_id` do remetente.
  - UI de reatribuir manualmente (provavelmente no cabeçalho da conversa, perto do botão "Funil"/editar contato) — só admin/gerente.
  - `adicionarAoFunil`: passa a receber o usuário logado e gravar `user_id`/`responsavel_id` nos registros que cria, corrigindo o Achado 3.

## Fora de escopo

- Ranking de vendedores (item **C**, spec/plano separado).
- Qualquer mudança em quem pode ver o quê fora de Funil/Clientes/Inbox (relatórios, tarefas, etc. não entram nesta rodada).

## Status

**Aprovado em 2026-07-12 — pronto para o plano de implementação.**
