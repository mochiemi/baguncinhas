<script setup lang="ts">
const route = useRoute()
const api = useBlogApi()

const label = computed(() => String(route.params.label ?? ''))

const requestedPage = computed(() => {
  const raw = Number(route.query.page ?? 1)
  return Number.isInteger(raw) && raw > 0 ? raw : 1
})

const { data, error } = await useAsyncData(
  () => `label:${label.value}:page:${requestedPage.value}`,
  () => api.listPosts({ label: label.value, page: requestedPage.value }),
  { watch: [label, requestedPage] },
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

useSeoMeta({
  title: () =>
    currentPage.value > 1 ? `${label.value} · Página ${currentPage.value}` : label.value,
  description: () => `Todos os posts marcados com “${label.value}”.`,
  ogTitle: () => label.value,
  ogDescription: () => `Todos os posts marcados com “${label.value}”.`,
  ogType: 'website',
})
</script>

<template>
  <div>
    <header class="page-head">
      <span class="page-head__eyebrow">Assunto</span>
      <h1>{{ label }}</h1>
      <p class="page-head__lead">
        {{ posts.length }}
        {{ posts.length === 1 ? 'post encontrado' : 'posts encontrados' }}
        <template v-if="totalPages > 1">nesta página</template>.
      </p>
    </header>

    <ul v-if="posts.length" class="post-list">
      <PostCard v-for="post in posts" :key="post.id" :post="post" />
    </ul>

    <p v-else class="empty-state">Nenhum post com este assunto ainda.</p>

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
