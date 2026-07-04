# Edição de Contato + Nota Interna — Design Spec

**Date:** 2026-07-04
**Status:** Approved
**Scope:** CRM (Inbox) + migration de schema compartilhado (Supabase)

---

## 1. Problema

Hoje o nome de um contato do WhatsApp (tabela `contacts`) só é preenchido automaticamente pelo webhook, a partir do `pushName` que a Evolution API manda. Não há como corrigir ou definir um nome manualmente pelo CRM. Também não existe nenhum campo para anotações internas da equipe sobre um contato (preferências, histórico, contexto) — informação que não deve ir para o WhatsApp, só ficar visível no CRM.

Separadamente, o CRM já tem uma entidade "Cliente" (tabela `clientes`) com seu próprio `nome`, usada no funil de vendas. Hoje os dois nomes (contato do Inbox e Cliente do funil) não têm nenhuma sincronização — são conectados apenas implicitamente, quando `adicionarAoFunil` casa um `Cliente` a uma conversa por igualdade de telefone.

## 2. Objetivo

1. Permitir editar/trocar o nome de um contato diretamente do Inbox.
2. Ao editar o nome de um contato que tem um Cliente correspondente (mesmo telefone), atualizar o nome do Cliente também — sem criar um Cliente novo se não existir.
3. Permitir registrar uma nota interna de texto livre por contato, visível só na equipe, editável no mesmo lugar.

## 3. Fora de escopo

- Editar/remover foto de perfil manualmente.
- Arquivar/ocultar contatos do Inbox.
- Sincronizar a nota interna com o Cliente (fica só em `contacts`).
- Vínculo formal via foreign key entre `contacts` e `clientes` (ver seção 5 — decisão de manter o match por telefone).
- Qualquer edição em massa (edição é sempre de um contato por vez, a partir do Inbox).

## 4. Schema de Dados

Nova coluna em `contacts` (schema compartilhado, migration vive no repo `agente-de-ia`, mesmo padrão de `is_group` e `profile_picture_url`):

```sql
alter table contacts add column if not exists notes text;
```

`clientes` não ganha nenhuma coluna nova — apenas `nome` é atualizado quando aplicável.

## 5. Sincronização nome Inbox ↔ Cliente

**Abordagem escolhida:** uma única server action no CRM, `updateContactDetails(contactId, phone, name, notes)`, que:

1. Faz `update contacts set name = ..., notes = ... where id = contactId`.
2. Faz `select id from clientes where telefone = phone` — se encontrar, `update clientes set nome = name where id = ...`.
3. Se não encontrar Cliente, não cria nenhum registro novo (criar Cliente continua sendo responsabilidade exclusiva do botão "Funil" já existente).

Isso segue o mesmo padrão de match-por-telefone que `adicionarAoFunil` (em `app/dashboard/inbox/actions.ts`) já usa hoje — não introduz um mecanismo de vínculo novo.

**Alternativa considerada e descartada:** adicionar uma foreign key real `clientes.contact_id` para ligar os registros de forma robusta (em vez de comparar telefone como texto, que pode divergir em formatação). Seria mais correto a longo prazo, mas exige migration + script de backfill para os registros existentes, e o restante do código já confia em match por telefone — introduzir um segundo mecanismo de vínculo (FK) só para esta feature aumentaria a complexidade sem necessidade imediata. Fica registrado aqui como possível melhoria futura caso divergências de formatação de telefone causem bugs de sincronização.

## 6. UI

No cabeçalho da conversa (`components/inbox/mensagem-thread.tsx`), ao lado do nome exibido, um ícone de lápis abre um diálogo (reaproveitando `components/ui/dialog.tsx`, já usado em outros formulários do projeto) com dois campos:

- **Nome** (`input` de texto, obrigatório — não permite salvar vazio)
- **Nota interna** (`textarea`, opcional)

Botão "Salvar" chama `updateContactDetails` e atualiza a UI local (nome exibido no cabeçalho e na lista de conversas) sem esperar um novo fetch completo. A nota interna não aparece em nenhum lugar visível para o contato/WhatsApp — só dentro desse diálogo (não precisa de exibição permanente na tela, pode ficar só acessível reabrindo o diálogo de edição nesta primeira versão).

Grupos (`contacts.is_group = true`) também podem ter nome/nota editados pelo mesmo diálogo — o nome editado manualmente sobrescreve o nome do grupo obtido da Evolution API (o fetch automático de nome de grupo já é best-effort e só roda quando `contact.name` é nulo, então não há conflito: uma vez editado manualmente, o nome não é mais nulo e o fetch automático não roda de novo).

## 7. Testes

- `formatPhone`/lógica de match por telefone já existente não muda — não precisa de teste novo ali.
- Se o repo `meu-crm` ganhar um framework de testes automatizados nesse meio tempo, cobrir `updateContactDetails` (atualiza `contacts`, atualiza `clientes` quando existe, não cria `clientes` quando não existe). Caso contrário (situação atual: sem framework configurado), validar manualmente os três casos antes de considerar concluído.

## 8. Erros e casos de borda

- Nome vazio: bloqueado no client (input `required`) e a server action também rejeita string vazia/whitespace, retornando erro tratado no diálogo (não deixa a UI num estado inconsistente).
- Telefone do contato não bate com nenhum Cliente: só atualiza `contacts`, sem erro.
- Falha de rede/Supabase ao salvar: diálogo mostra mensagem de erro e mantém os valores digitados (não fecha sozinho).
