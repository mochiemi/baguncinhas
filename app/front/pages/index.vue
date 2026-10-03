<script setup lang="ts">
const route = useRoute()
const api = useBlogApi()
const { siteName, siteDescription } = useRuntimeConfig().public

/**
 * A página vem da query string (`/?page=3`).
 *
 * Toda entrada externa precisa ser tratada como suspeita, inclusive a query
 * string. `Number(route.query.page)` com um valor como "abc" devolve NaN, e
 * `?page=-5` produziria um slice absurdo. Normalizamos aqui, uma vez, em vez de
 * confiar que a URL está correta.
 */
const requestedPage = computed(() => {
  const raw = Number(route.query.page ?? 1)
  return Number.isInteger(raw) && raw > 0 ? raw : 1
})

/**
 * A chave do `useAsyncData` inclui a página.
 *
 * Isso é o que faz o Nuxt guardar o resultado de cada página separadamente:
 * voltar para a página 2 é instantâneo, sem nova chamada. Se a chave fosse fixa,
 * todas as páginas compartilhariam o mesmo cache e a navegação mostraria dados
 * errados por um instante.
 */
const { data, error } = await useAsyncData(
  () => `posts:page:${requestedPage.value}`,
  () => api.listPosts({ page: requestedPage.value }),
  { watch: [requestedPage] },
)

if (error.value) {
  // `statusMessage` vai para a linha de status do HTTP e precisa ser ASCII.
  // O texto em português que o leitor lê vai em `message`.
  throw createError({
    statusCode: 502,
    statusMessage: 'Bad Gateway',
    message: 'Não foi possível carregar os posts agora. Tente de novo em instantes.',
  })
}

const posts = computed(() => data.value?.items ?? [])
const currentPage = computed(() => data.value?.page ?? 1)
const totalPages = computed(() => data.value?.totalPages ?? 1)

/**
 * `title` cuida do `<title>` da aba; `ogTitle` e `ogDescription` cuidam do
 * cartão de preview quando alguém compartilha o link. São coisas diferentes e
 * precisam ser declaradas separadamente.
 */
useSeoMeta({
  title: () => (currentPage.value > 1 ? `Página ${currentPage.value}` : siteName),
  description: siteDescription,
  ogTitle: () => (currentPage.value > 1 ? `Página ${currentPage.value}` : siteName),
  ogDescription: siteDescription,
  ogType: 'website',
  ogSiteName: siteName,
})
</script>

<template>
  <div>
    <header class="page-head">
      <h1>Últimos posts</h1>
      <p class="page-head__lead">{{ siteDescription }}</p>
    </header>

    <ul v-if="posts.length" class="post-list">
      <PostCard v-for="post in posts" :key="post.id" :post="post" />
    </ul>

    <p v-else class="empty-state">
      Nenhum post publicado ainda. Volte em breve.
    </p>

    <nav v-if="totalPages > 1" class="pagination" aria-label="Paginação">
      <NuxtLink
        v-if="currentPage > 1"
        :to="{ query: currentPage > 2 ? { page: currentPage - 1 } : {} }"
        rel="prev"
      >
        ← Mais recentes
      </NuxtLink>
      <span v-else />

      <span class="pagination__status">Página {{ currentPage }} de {{ totalPages }}</span>

      <NuxtLink
        v-if="currentPage < totalPages"
        :to="{ query: { page: currentPage + 1 } }"
        rel="next"
      >
        Mais antigos →
      </NuxtLink>
      <span v-else />
    </nav>
  </div>
</template>
