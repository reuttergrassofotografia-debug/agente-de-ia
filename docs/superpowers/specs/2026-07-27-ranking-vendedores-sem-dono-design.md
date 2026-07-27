# CRM: Ranking de vendedores não reconcilia com "Fechados" (negócios sem responsável)

## Contexto

Usuário reportou que o card "Ranking de vendedores" (Dashboard e Relatórios) mostra só uma linha "Sem nome", com valor bem diferente do total "Fechados" mostrado ao lado.

## Causa raiz (confirmada direto no banco de produção)

- Hoje existem 5 negócios com `etapa = 'fechado'`, somando R$ 60.000 — esse é o número que aparece em "Fechados".
- Só 1 desses 5 tem `responsavel_id` preenchido (R$ 15.000). Os outros 4 (R$ 45.000, 75% do valor) têm `responsavel_id = null` — negócios antigos, de antes do Funil passar a gravar o responsável na criação (`criarNegocio`, `app/dashboard/funil/actions.ts:92`); o Funil nunca ganhou UI de reatribuição pra corrigir isso depois (diferente do que a feature de Clientes acabou de ganhar).
- `getRankingVendedores`/`getRankingVendedoresFiltrado` (`lib/supabase/queries.ts:140-159` e `170-194`) descartam silenciosamente todo negócio cujo join `responsavel` vem `null` (`if (!resp) return`) — por isso os 4 negócios sem dono somem do ranking sem deixar rastro.
- O único negócio que sobra está atribuído a uma conta `admin` cujo `profiles.nome` é `null` — daí o rótulo "Sem nome" com valor de R$ 15.000, muito abaixo do R$ 60.000 de "Fechados".

Não é um bug de lógica quebrada — é descarte silencioso de dado real, dois problemas empilhados (negócio sem dono some inteiro; dono sem nome vira rótulo confuso).

## Decisão (confirmada com o usuário)

Negócios fechados sem `responsavel_id` passam a aparecer como uma linha **"Sem vendedor"** no ranking (não são mais descartados), com estilo visualmente discreto (cinza/itálico, diferenciado das linhas de vendedores reais) — assim a soma de todas as linhas do ranking sempre bate com o total "Fechados" do Dashboard.

Refinamento (decisão da controladora, consistente com o pedido): a linha "Sem vendedor", quando existir, sempre aparece **por último**, independente do valor — não participa da ordenação por total como se fosse um vendedor competindo no ranking, já que não representa uma pessoa.

Efeito colateral corrigido junto (mesmo arquivo, mesma linha que já seria tocada): a linha da tabela usa `key={v.nome}` (`components/relatorios/ranking-vendedores.tsx:25`) — dois vendedores com o mesmo nome, ou duas linhas "Sem nome"/"Sem vendedor", colidiriam nessa key. Troca pra `key={i}` (índice), já que a lista é renderizada no servidor sem reordenação animada.

## Mudanças — repo `meu-crm`

### `lib/supabase/queries.ts`

`getRankingVendedores` e `getRankingVendedoresFiltrado` (mesma mudança nas duas, mesmo corpo de agregação):

- Não descartam mais negócio com `responsavel` nulo — agrupam sob uma chave sintética `'sem-vendedor'`, com `nome: 'Sem vendedor'` e uma flag `semVendedor: true` (usada pelo componente pra estilizar, em vez de comparar a string do nome).
- Antes de retornar: ordena as entradas com vendedor real por `total` decrescente (como já era), e anexa a entrada "Sem vendedor" (se existir) sempre no final, independente do valor.
- Tipo de retorno passa a ser `{ nome: string; total: number; count: number; semVendedor?: boolean }[]`.

### `components/relatorios/ranking-vendedores.tsx`

- `key={v.nome}` → `key={i}`.
- Linha com `semVendedor === true` recebe classes visuais diferenciadas (texto cinza, itálico no nome, sem o verde de destaque no valor) em vez do estilo padrão de linha de vendedor.
- Prop `ranking` ganha o campo opcional `semVendedor?: boolean` no tipo.

### `components/relatorios/exportar-relatorio.tsx`

- Tipo da prop `ranking` ganha o mesmo campo opcional `semVendedor?: boolean`, só para manter o tipo compartilhado consistente entre os três consumidores (Dashboard, Relatórios, exportação) — a lógica de exportação (CSV/XLSX/PDF) não precisa de nenhuma mudança de comportamento, a linha "Sem vendedor" é exportada como qualquer outra linha, o que é o comportamento certo (também deve reconciliar no arquivo exportado).

## Fora de escopo

- Nenhuma mudança de schema/migration — não é necessário, o problema é só na leitura/agregação.
- Não inclui nenhuma forma de corrigir os negócios antigos sem dono no Funil (dar um dono a eles) — isso é uma ação de dado, não desta correção; o Funil continua sem UI de reatribuição (fora de escopo, já anotado em rodadas anteriores).
- Não muda o rótulo "Sem nome" (vendedor real sem nome cadastrado) — já existia e já é o comportamento correto pra esse caso específico, só ficou confuso porque coexistia com o descarte silencioso dos negócios sem dono. Corrigir o descarte já resolve a confusão do usuário.
