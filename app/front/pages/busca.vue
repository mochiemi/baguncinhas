<script setup lang="ts">
import type { Paginated, PostSummary } from '../../bff/src/shared/index.js'

const route = useRoute()
const router = useRouter()
const api = useBlogApi()

/** O que está digitado no campo. */
const term = ref(String(route.query.q ?? ''))

/**
 * O termo que vale é o da URL, não o do campo.
 *
 * Essa separação é pequena mas importante: a busca só acontece quando a URL
 * muda. Assim o link fica compartilhável, o botão "voltar" do navegador
 * funciona, e o `useAsyncData` cacheia por termo em vez de buscar a cada
 * tecla digitada.
 */
const query = computed(() => String(route.query.q ?? '').trim())

/**
 * Página vazia, no mesmo formato que o BFF devolve.
 *
 * Sem isso, o caso "ainda não buscou nada" teria que devolver `null`, e o Nuxt
 * avisa que `useAsyncData` deve sempre devolver um valor: um retorno nulo pode
 * fazer a busca repetir no cliente. Uma página vazia mantém o tipo e o fluxo
 * uniformes, e o template não precisa tratar dois formatos.
 */
function emptyPage(): Paginated<PostSummary> {
  return {
    items: [],
    page: 1,
    pageSize: 10,
    totalItems: 0,
    totalPages: 1,
    hasMore: false,
  }
}

const { data } = await useAsyncData(
  () => `search:${query.value}`,
  () => (query.value ? api.searchPosts(query.value) : Promise.resolve(emptyPage())),
  { watch: [query] },
)

const results = computed(() => data.value?.items ?? [])
const total = computed(() => data.value?.totalItems ?? 0)

function submit() {
  const value = term.value.trim()
  void router.push({ query: value ? { q: value } : {} })
}

/**
 * Nota de escopo: esta página mostra só a primeira página de resultados.
 * A API já aceita `page` desde o começo, então paginar a busca é só uma
 * questão de adicionar o controle quando fizer falta.
 */
useSeoMeta({
  title: 'Busca',
  description: 'Procure por receitas, assuntos e posts antigos no Mochi Blog.',
  robots: 'noindex, follow',
})
</script>

<template>
  <div>
    <header class="page-head">
      <h1>Busca</h1>
      <p class="page-head__lead">Procure por um ingrediente, um assunto ou uma palavra do texto.</p>
    </header>

    <form class="search-form" role="search" @submit.prevent="submit">
      <label class="visually-hidden" for="campo-busca">Buscar posts</label>
      <input
        id="campo-busca"
        v-model="term"
        type="search"
        name="q"
        placeholder="Ex.: pão, gato, bordado…"
        autocomplete="off"
      />
      <button class="btn" type="submit">Buscar</button>
    </form>

    <p v-if="!query" class="empty-state">Digite algo acima para começar.</p>

    <template v-else>
      <p v-if="results.length" class="page-head__lead">
        {{ total }} {{ total === 1 ? 'resultado' : 'resultados' }} para “{{ query }}”.
      </p>

      <ul v-if="results.length" class="post-list">
        <PostCard v-for="post in results" :key="post.id" :post="post" />
      </ul>

      <p v-else class="empty-state">Nada encontrado para “{{ query }}”.</p>
    </template>
  </div>
</template>
