<script setup lang="ts">
const route = useRoute()
const api = useBlogApi()
const { siteUrl } = useRuntimeConfig().public

const slug = computed(() => String(route.params.slug ?? ''))

const { data: post, error } = await useAsyncData(
  () => `post:${slug.value}`,
  () => api.getPost(slug.value),
  { watch: [slug] },
)

/**
 * Tratamento de erro em dois níveis, e a diferença importa.
 *
 * Se o BFF respondeu 404, o post realmente não existe: devolvemos 404 e o
 * Google entende que aquela página saiu do ar.
 *
 * Se o BFF não respondeu (caiu, timeout), isso NÃO é um 404. Devolver 404 aqui
 * faria o Google desindexar posts que estão perfeitamente no ar. Por isso a
 * distinção: falha de infraestrutura vira 502, que é um erro temporário e não
 * apaga nada do índice de busca.
 */
if (error.value) {
  const statusCode = (error.value as { statusCode?: number }).statusCode ?? 500
  const isNotFound = statusCode === 404

  /**
   * `statusMessage` e `message` são coisas diferentes, e trocar as duas causa
   * problema.
   *
   * `statusMessage` vai para a LINHA DE STATUS do HTTP, que por especificação
   * só aceita ASCII. Um "não" acentuado ali seria descartado ou corrompido. Ele
   * é curto e em inglês porque é isso que o protocolo espera.
   *
   * `message` é o texto que o leitor vê, e vive na página de erro.
   */
  throw createError({
    statusCode: isNotFound ? 404 : 502,
    statusMessage: isNotFound ? 'Not Found' : 'Bad Gateway',
    message: isNotFound
      ? 'Post não encontrado'
      : 'Não foi possível carregar o post agora. Tente de novo em instantes.',
    fatal: true,
  })
}

if (!post.value) {
  throw createError({
    statusCode: 404,
    statusMessage: 'Not Found',
    message: 'Post não encontrado',
    fatal: true,
  })
}

/**
 * Canonical aponta para ESTE site.
 *
 * O mesmo texto também existe no Blogger, então os buscadores veem conteúdo
 * duplicado. O canonical diz qual das duas versões é a oficial.
 *
 * Falta um passo do lado do Blogger: para a estratégia funcionar de verdade, o
 * tema de lá precisa declarar o mesmo canonical, apontando para cá. Sem isso, o
 * Blogger continua se declarando a versão original. Está anotado nas pendências
 * em docs/arquitetura.md.
 */
const canonicalUrl = computed(() => {
  const current = post.value
  if (!current) return undefined
  return new URL(`/post/${encodeURIComponent(current.slug)}`, siteUrl).toString()
})

/**
 * Dados estruturados (JSON-LD).
 *
 * Não muda nada na tela. Serve para o buscador entender que isto é um artigo,
 * com autor e data, e poder mostrar um resultado mais rico. É o mesmo tipo de
 * marcação que você já usa no `bio`.
 */
const jsonLd = computed(() => {
  const current = post.value
  if (!current) return undefined

  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: current.title,
    description: current.excerpt,
    datePublished: current.publishedAt,
    dateModified: current.updatedAt,
    image: current.coverUrl ?? undefined,
    keywords: current.labels.join(', '),
    inLanguage: 'pt-BR',
    mainEntityOfPage: canonicalUrl.value,
  })
})

/**
 * Metatags da página.
 *
 * `ogTitle` e `ogDescription` são declarados SEPARADAMENTE de `title` e
 * `description`, e isso não é redundância. `title` alimenta apenas o `<title>`
 * da aba; as tags `og:*` são as que WhatsApp, Twitter e LinkedIn leem para
 * montar o cartão de preview do link.
 *
 * Confirmei no HTML renderizado que elas não eram geradas sozinhas: o link
 * compartilhado apareceria sem título nem resumo.
 */
useSeoMeta({
  title: () => post.value?.title ?? '',
  description: () => post.value?.excerpt ?? '',
  ogTitle: () => post.value?.title ?? '',
  ogDescription: () => post.value?.excerpt ?? '',
  ogType: 'article',
  ogUrl: canonicalUrl,
  ogImage: () => post.value?.coverUrl ?? undefined,
  twitterCard: () => (post.value?.coverUrl ? 'summary_large_image' : 'summary'),
  articlePublishedTime: () => post.value?.publishedAt,
  articleModifiedTime: () => post.value?.updatedAt,
})

useHead({
  link: [{ rel: 'canonical', href: canonicalUrl }],
  script: [{ type: 'application/ld+json', innerHTML: jsonLd }],
})
</script>

<template>
  <article v-if="post">
    <NuxtLink class="back-link" to="/">← Todos os posts</NuxtLink>

    <header class="post__header">
      <h1>{{ post.title }}</h1>

      <div class="post__meta">
        <time :datetime="toMachineDate(post.publishedAt)">
          {{ formatDateLong(post.publishedAt) }}
        </time>

        <ul v-if="post.labels.length" class="tag-list">
          <li v-for="label in post.labels" :key="label">
            <NuxtLink class="tag" :to="`/tag/${encodeURIComponent(label)}`">
              {{ label }}
            </NuxtLink>
          </li>
        </ul>
      </div>
    </header>

    <img
      v-if="post.coverUrl"
      class="post__cover"
      :src="post.coverUrl"
      :alt="post.title"
      fetchpriority="high"
      decoding="async"
    />

    <!--
      `v-html` com HTML de terceiro costuma ser um bug de segurança esperando
      acontecer. Aqui é uma escolha consciente: tudo que sai do BFF passou pelo
      sanitize-html, que remove script, evento inline, atributo style e iframe
      de domínio não autorizado. O navegador nunca vê HTML cru do Blogger.
    -->
    <div class="prose" v-html="post.html" />

    <p class="post__source">
      Este post também está publicado no
      <a :href="post.sourceUrl" target="_blank" rel="noopener noreferrer nofollow">Blogger</a>.
    </p>
  </article>
</template>
