# Inbox: reordenação em tempo real + indicador de não lida

## Contexto

O Inbox do CRM (`reuttergrasso.com/crm/dashboard/inbox`) já ordena as conversas por `last_message_at desc`, mas a lista só é re-buscada por polling a cada 5s — então uma mensagem nova pode levar até 5s pra subir ao topo. Além disso, não existe nenhum conceito de "não lida": nada distingue visualmente uma conversa com mensagem nova de uma já vista.

O usuário quer um comportamento parecido com o WhatsApp: quando o contato manda uma mensagem, a conversa sobe pro topo da lista imediatamente e fica marcada com um indicador de não lida (nome em negrito + bolinha verde com contador), até alguém abrir a conversa.

## Decisões (via brainstorming)

- **Gatilho de "não lida":** só mensagens **recebidas** do contato (`role='user'` no webhook). Mensagens enviadas pelo usuário/CRM (`fromMe`) não marcam nada.
- **Escopo da leitura:** compartilhado/global. Uma vez que qualquer pessoa do CRM abre a conversa, ela fica lida para todos — não há estado de leitura por usuário/vendedor.
- **Mecanismo de atualização da lista:** Supabase Realtime (websocket), não apenas polling mais rápido — reordenação deve parecer instantânea.
- **Indicador visual:** nome em negrito + bolinha verde com contador numérico (estilo WhatsApp), não apenas um ponto.
- Aplica tanto à aba Contatos quanto à aba Grupos (mensagem de participante em grupo também conta como "recebida do contato").

## Mudanças — repo `agente-de-ia` (webhook)

### Schema (Supabase — migration manual, como nas rodadas anteriores)

- `conversations.unread_count integer not null default 0`
- Função Postgres `increment_unread_count(conv_id uuid)`:
  ```sql
  create or replace function increment_unread_count(conv_id uuid)
  returns void as $$
    update conversations set unread_count = unread_count + 1 where id = conv_id;
  $$ language sql;
  ```
  Atômica no banco — evita race condition se duas mensagens (ex: rajada em grupo) chegarem quase ao mesmo tempo, o que uma leitura-depois-escrita em JS não garantiria.

### `apps/api/src/routes/webhook.ts`

- No branch de mensagem recebida do contato (hoje na linha ~169, logo após `update conversations set last_message_at = ...`), adicionar:
  ```ts
  await db.rpc('increment_unread_count', { conv_id: conversation.id })
  ```
- O branch `fromMe` (linha ~149) **não** é tocado — só o branch `role: 'user'` (linha ~156 em diante) incrementa.
- Roda antes do `fire-and-forget` de mídia e do enqueue pro LLM — é uma call rápida e síncrona, não precisa ser fire-and-forget.

### Teste (vitest, `apps/api/src/__tests__/webhook.test.ts`)

- Novo caso: mensagem recebida de contato incrementa `unread_count`; mensagem `fromMe` não incrementa.

## Mudanças — repo `meu-crm` (CRM)

### `lib/types.ts`

- `Conversa.unread_count: number` adicionado à interface.

### `app/dashboard/inbox/actions.ts`

- `getConversacoes`: incluir `unread_count` no `.select()` de `conversations`.
- Nova server action:
  ```ts
  export async function marcarComoLida(conversationId: string) {
    const supabase = createAdminClient()
    await supabase.from('conversations').update({ unread_count: 0 }).eq('id', conversationId)
  }
  ```

### `components/inbox/inbox-panel.tsx`

- **Realtime:** abrir um canal Supabase Realtime (`supabase.channel('inbox-conversas')`) escutando `postgres_changes` em `conversations` (`UPDATE` e `INSERT`), sem filtro por instância (a Inbox já mostra todas). Cada evento chama o `refreshConversas()` existente — reaproveita toda a lógica de dedupe/paginação/aba já implementada, só troca o gatilho de "timer" para "evento".
- **Polling de 5s vira fallback**, com intervalo maior (20s), para cobrir quedas de websocket não detectadas.
- **Polling de mensagens dentro da conversa aberta (3s) não muda.**
- **Ao selecionar uma conversa** (`onSelect`): chamar `marcarComoLida(id)` em paralelo à seleção, e atualizar o estado local (`unread_count: 0`) imediatamente — mesmo padrão já usado em `updateLocalStatus`, para o badge sumir na hora sem esperar o próximo evento.
- **Conversa já aberta recebendo mensagem nova:** quando o evento Realtime afeta a conversa que é a `selectedId` atual, chamar `marcarComoLida` novamente logo em seguida do `refreshConversas()` — o contador sobe no banco e desce na sequência, sem nunca aparecer visualmente (React só renderiza o estado final).

### `components/inbox/conversa-lista.tsx`

- `ConversaItem`: nome com `font-bold` (em vez de `font-semibold`) quando `c.unread_count > 0`.
- Badge: bolinha verde ao lado do `timeLabel`, com o número (`c.unread_count`, exibindo `99+` acima de 99) — mesma posição/estilo dos badges de instância/pausado já existentes na linha de baixo, mas ao lado do horário.

## Edge cases

- **Busca e paginação:** `unread_count` viaja junto no objeto `Conversa`, sem lógica extra — funciona igual em "Carregar mais" e nas duas abas.
- **Websocket cai:** fallback de polling (20s) garante que a lista eventualmente se corrige mesmo sem o Realtime ativo.
- **Duas abas do CRM abertas ao mesmo tempo (mesmo usuário ou vendedores diferentes):** como a leitura é global, abrir em uma aba zera para todas — comportamento esperado dado o escopo "compartilhado" decidido acima.

## Testes / verificação

- `agente-de-ia`: teste vitest novo cobrindo o incremento (branch recebida vs `fromMe`).
- `meu-crm`: sem framework automatizado — verificação via `tsc --noEmit` + `lint` + `build`, e validação manual (duas abas do navegador, mandar mensagem de um número de teste, confirmar reordenação instantânea + badge aparecendo/sumindo ao abrir a conversa).

## Fora de escopo

- Estado de leitura por usuário/vendedor (decidido explicitamente como não necessário agora).
- Contagem de não lidas na navegação/menu fora da página do Inbox (badge só na lista de conversas dentro do Inbox).
