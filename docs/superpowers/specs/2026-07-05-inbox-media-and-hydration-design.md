# Inbox: Mídia Real, Remetente em Grupo e Correção de Hidratação — Design Spec

**Date:** 2026-07-05
**Status:** Approved
**Scope:** CRM (Inbox) + Supabase Storage + schema/webhook compartilhados (repo `agente-de-ia`)

---

## 1. Problema

Usuário reportou, testando o Inbox em produção:

1. Não consegue abrir/ouvir mídia recebida (áudio, imagem, documento) nem enviar arquivo/áudio pelo Inbox — o botão "não reage".
2. Dentro de conversas de grupo, não dá pra saber quem mandou cada mensagem — só o texto aparece, sem nome nem número do participante.

## 2. Causa raiz (investigação sistemática)

### 2.1 Mídia nunca é armazenada

O webhook (`apps/api/src/routes/webhook.ts`, `extractContent`) só extrai um texto-placeholder pra mensagens de mídia (`[Áudio]`, `[Imagem] legenda`, `[Documento] nome.pdf`) e descarta o resto do payload — nunca baixa nem guarda o arquivo. O mesmo vale pro envio: `sendMediaMessage`/`sendAudioMessage` (repo `meu-crm`) mandam o base64 pra Evolution API mas nunca guardam uma cópia — a mensagem salva no banco também vira só texto. Resultado: não existe arquivo nenhum pra abrir ou tocar, em nenhuma direção.

Confirmado que dá pra recuperar mídia já recebida via `POST {EVOLUTION_API_URL}/chat/getBase64FromMediaMessage/{instance}` com `{"message":{"key":{"id": evolution_message_id}}}` — testado contra uma mensagem de áudio real em produção, retornou o base64 completo.

### 2.2 Botão "não reage" = bug de hidratação do React, não bug de envio

Console do navegador mostra **React error #418** (mismatch de hidratação) se repetindo a cada poucos segundos no Inbox. Duas fontes identificadas:

- `formatTime` em `components/inbox/conversa-lista.tsx` calcula "há Xmin"/"Xh" a partir de `new Date()` (agora) — o valor calculado durante a renderização no servidor quase nunca bate com o valor calculado no navegador no momento da hidratação (alguns segundos depois), gerando incompatibilidade de texto a cada render.
- `formatTime` em `components/inbox/mensagem-thread.tsx` usa `toLocaleTimeString('pt-BR')` sem fixar `timeZone` — se o fuso do container em produção for diferente do fuso do navegador do usuário, o mesmo horário formata como string diferente em cada lado.

Confirmado experimentalmente: ao clicar no botão de microfone durante um erro de hidratação, o clique foi na verdade recebido pelo botão "Sair" (logout) — evidência direta de que o React perde a referência entre o DOM real e a árvore de componentes depois do mismatch, fazendo cliques caírem no elemento errado. Isso explica o botão de enviar arquivo/áudio "não reagir": não é falha de rede nem da Evolution API, é o clique nunca chegando no handler certo.

### 2.3 Sem identificação do remetente em grupo

`WebhookPayloadSchema` (`apps/api/src/schemas/webhook.ts`) não declara o campo `key.participant` que a Evolution API manda em mensagens de grupo (identifica quem escreveu) — como o schema Zod não tem `.passthrough()`, esse campo é descartado na validação mesmo que venha no payload. A tabela `messages` também não tem nenhuma coluna pra guardar remetente. Resultado: impossível saber quem, dentro do grupo, mandou qual mensagem.

## 3. Objetivo

1. Corrigir o bug de hidratação (prioridade alta — é a causa dos botões travados).
2. Guardar mídia recebida e enviada no Supabase Storage e mostrar de verdade na tela (áudio tocável, imagem visível, link de documento).
3. Mostrar nome/telefone de quem mandou cada mensagem dentro de conversas de grupo.

## 4. Fora de escopo

- Vídeo/thumbnail especial (vídeo vira link de download como documento, não precisa player embutido nesta rodada).
- Edição/exclusão de mídia já enviada.
- Sincronizar `sender_name`/`sender_phone` com a tabela `contacts` (não cria contato pra cada participante de grupo — só anota o remetente na própria mensagem).
- Corrigir o crash isolado `createJobFailure failed: fetch failed` visto nos logs do worker (transitório, não reproduzido de novo, fora do escopo pedido).

## 5. Correção do bug de hidratação

**`components/inbox/conversa-lista.tsx`:** `formatTime` não pode rodar durante a renderização inicial (que é igual no servidor e no cliente) com um valor que depende de "agora". Trocar por um hook que renderiza uma string vazia na primeira passada (idêntica em servidor e cliente — sem mismatch possível) e só calcula o valor real depois de montado no navegador, via `useEffect`:

```ts
function useRelativeTime(dateStr: string | null): string {
  const [label, setLabel] = useState('')
  useEffect(() => {
    function compute() {
      if (!dateStr) { setLabel(''); return }
      const d = new Date(dateStr)
      const diff = Date.now() - d.getTime()
      const hours = Math.floor(diff / 3600000)
      const mins = Math.floor(diff / 60000)
      if (mins < 1) setLabel('agora')
      else if (mins < 60) setLabel(`${mins}min`)
      else if (hours < 24) setLabel(`${hours}h`)
      else setLabel(d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }))
    }
    compute()
    const id = setInterval(compute, 30000)
    return () => clearInterval(id)
  }, [dateStr])
  return label
}
```

**`components/inbox/mensagem-thread.tsx`:** `formatTime` (hora absoluta da mensagem) não depende de "agora", só precisa de um fuso fixo pra ser determinístico entre servidor e cliente:

```ts
function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
}
```

## 6. Armazenamento de mídia

### 6.1 Bucket

Bucket privado `whatsapp-media` no Supabase Storage (criado via SQL, já que o schema já é versionado assim neste projeto):

```sql
insert into storage.buckets (id, name, public)
values ('whatsapp-media', 'whatsapp-media', false)
on conflict (id) do nothing;
```

Privado porque documentos/fotos podem conter dado pessoal sensível. Toda leitura/escrita usa a service role key (bypassa RLS) — nunca é acessado com a anon key. Exibição na tela usa uma signed URL de curta duração (1h), gerada a cada busca de mensagens — sem necessidade de política de acesso público nem de RLS na tabela `storage.objects`.

### 6.2 Schema

Novas colunas em `messages` (repo `agente-de-ia`, mesmo padrão das migrations anteriores):

```sql
alter table messages add column if not exists media_path text;
alter table messages add column if not exists media_mimetype text;
alter table messages add column if not exists sender_phone text;
alter table messages add column if not exists sender_name text;
```

- `media_path`: caminho do objeto dentro do bucket `whatsapp-media` (não a URL — a URL assinada é gerada na hora de exibir).
- `media_mimetype`: tipo MIME guardado no upload, usado pra decidir como renderizar (áudio/imagem/documento).
- `sender_phone`/`sender_name`: só preenchidos em mensagens de grupo recebidas (`is_group=true`, `role='user'`); `null` em conversas individuais (a UI já sabe quem é, não precisa repetir).

### 6.3 Mídia recebida (webhook, repo `agente-de-ia`)

`WebhookPayloadSchema` ganha o campo `participant` opcional:

```ts
key: z.object({
  remoteJid: z.string(),
  fromMe: z.boolean(),
  id: z.string(),
  participant: z.string().optional(),
}),
```

No handler do webhook, depois de salvar a mensagem (`role: 'user'`, ou seja, mensagem recebida — não se aplica ao ramo `fromMe`), se a mensagem não for de texto (`!isText`), busca e guarda a mídia de forma best-effort (não bloqueia nem derruba o webhook se falhar):

```ts
async function fetchAndStoreMedia(
  db: SupabaseClient<Database>,
  evolutionInstanceName: string,
  evolutionMessageId: string,
  messageDbId: string,
): Promise<void> {
  try {
    const evoUrl = process.env['EVOLUTION_API_URL']!
    const evoKey = process.env['EVOLUTION_API_KEY']!
    const r = await fetch(`${evoUrl}/chat/getBase64FromMediaMessage/${evolutionInstanceName}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: evoKey },
      body: JSON.stringify({ message: { key: { id: evolutionMessageId } } }),
    })
    if (!r.ok) return
    const data = await r.json() as { base64?: string; mimetype?: string }
    if (!data.base64 || !data.mimetype) return
    const buffer = Buffer.from(data.base64, 'base64')
    const path = `${messageDbId}`
    const { error: uploadError } = await db.storage
      .from('whatsapp-media')
      .upload(path, buffer, { contentType: data.mimetype })
    if (uploadError) return
    await db.from('messages').update({ media_path: path, media_mimetype: data.mimetype }).eq('id', messageDbId)
  } catch { /* media is best-effort — the text placeholder already saved is enough to not lose the message */ }
}
```

Chamado depois do `upsert` de mensagem recebida (branch que não é `fromMe`), só quando `!isText`, passando o `id` retornado pelo `upsert`.

Remetente de grupo: no mesmo branch (mensagem recebida, `!fromMe`), quando `isGroup`, extrai e salva `sender_phone`/`sender_name` junto com o insert da mensagem:

```ts
const senderPhone = isGroup ? payload.data.key.participant?.split('@')[0] ?? null : null
const senderName = isGroup ? payload.data.pushName ?? null : null
```

(`pushName` já não é usado como nome do *contato* em grupos desde a feature anterior — aqui é reaproveitado corretamente como nome do *remetente da mensagem*, escopo diferente.)

### 6.4 Mídia enviada (CRM, repo `meu-crm`)

`sendMediaMessage`/`sendAudioMessage` (`app/dashboard/inbox/actions.ts`) já recebem o base64 do navegador — fazem upload pro Storage no mesmo request, sem precisar buscar de volta na Evolution API:

```ts
const path = crypto.randomUUID()
const buffer = Buffer.from(mediaBase64, 'base64')
await supabase.storage.from('whatsapp-media').upload(path, buffer, { contentType: mimetype })
await supabase.from('messages').insert({
  conversation_id: conversationId,
  role: 'assistant',
  content: caption ? `${prefix} ${caption}` : prefix,
  status: 'delivered',
  evolution_message_id: evoRes?.key?.id ?? null,
  media_path: path,
  media_mimetype: mimetype,
})
```

Upload do Storage acontece **depois** do envio via Evolution API ter confirmado sucesso (mesma ordem que já existe hoje) — se o upload falhar, a mensagem ainda é salva sem mídia (best-effort, não trava o envio).

### 6.5 Exibição (CRM)

`getMensagens` (`app/dashboard/inbox/actions.ts`) gera uma signed URL (1h) pra cada mensagem que tiver `media_path`:

```ts
export async function getMensagens(conversationId: string) {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
  const mensagens = data ?? []
  const withUrls = await Promise.all(mensagens.map(async (m) => {
    if (!m.media_path) return m
    const { data: signed } = await supabase.storage.from('whatsapp-media').createSignedUrl(m.media_path, 3600)
    return { ...m, media_url: signed?.signedUrl ?? null }
  }))
  return withUrls
}
```

`mensagem-thread.tsx` troca os placeholders estáticos por elementos reais quando `media_url` existe:
- Áudio → `<audio controls src={media_url} />`
- Imagem → `<img src={media_url} />` (com fallback pro ícone atual se `media_url` for `null`, ex.: mídia antiga sem arquivo salvo)
- Documento/vídeo → link `<a href={media_url} download>` com o nome do arquivo

Mensagens antigas (sem `media_path`, criadas antes desta mudança) continuam mostrando o placeholder de texto atual — não há backfill retroativo de mídia antiga (a Evolution API só guarda mensagens recentes; tentar buscar mídia de mensagens muito antigas provavelmente retorna erro, e não faz parte do pedido do usuário).

## 7. Remetente em grupo (CRM)

`Mensagem` (`lib/types.ts`) ganha `sender_phone: string | null` e `sender_name: string | null` (mais `media_path`/`media_mimetype`/`media_url` da seção anterior).

Em `mensagem-thread.tsx`, quando `conversa.contacts?.is_group` for `true` e a mensagem for `role === 'user'` (recebida, nunca teria sentido pra `assistant`, que é sempre a própria empresa), mostra um rótulo pequeno acima da bolha com `sender_name || formatPhone(sender_phone) || 'Desconhecido'`.

## 8. Erros e casos de borda

- Evolution API fora do ar / `getBase64FromMediaMessage` falha: mensagem fica só com o texto-placeholder, sem quebrar o webhook (try/catch já é o padrão usado pra foto de perfil e nome de grupo).
- Upload pro Storage falha (bucket cheio, rede): mesma lógica — mensagem salva sem mídia, sem erro visível pro usuário do WhatsApp (ele já recebeu a mensagem de verdade, isso é só sobre exibir no CRM).
- `sender_phone`/`sender_name` ausentes numa mensagem de grupo antiga (antes desta mudança): rótulo mostra "Desconhecido" em vez de quebrar a tela.
- Signed URL expirada (usuário deixa o Inbox aberto por mais de 1h sem trocar de conversa): próxima busca de mensagens (polling de 3s já existente) gera uma URL nova automaticamente — não precisa de refresh manual.
