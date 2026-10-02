import {
  PostSchema,
  type LabelSummary,
  type Paginated,
  type Post,
  type PostSummary,
} from '../shared/index.js'

import { fetchAllPosts } from '../blogger/client.js'
import type { RawPost } from '../blogger/types.js'
import { blogOrigin, env } from '../env.js'
import { excerptFrom, sanitizePostHtml } from '../lib/html.js'
import { IMAGE_WIDTH, pickCoverImage, resizeBloggerImage } from '../lib/images.js'
import { slugFromUrl, slugKey } from '../lib/slug.js'
import { fold, normalizeLabels } from '../lib/text.js'

/**
 * ============================================================================
 * O ÍNDICE DE POSTS
 * ============================================================================
 *
 * Esta classe é a decisão arquitetural mais importante do BFF, então vale
 * explicar o raciocínio inteiro.
 *
 * O PROBLEMA
 * A API do Blogger é uma API de leitura paginada e remota. Se cada visita ao
 * site virasse uma chamada, teríamos:
 *   - latência do Google somada à nossa em toda página;
 *   - a quota da API consumida por leitores, não por conteúdo novo;
 *   - nenhuma forma boa de paginar por número de página, porque o Blogger usa
 *     cursor opaco (pageToken) e não aceita "me dê a página 3".
 *
 * A APOSTA
 * Um blog é um conjunto pequeno de conteúdo que muda pouco: algumas centenas de
 * posts, atualizados de vez em quando. Isso cabe confortavelmente em memória.
 *
 * Então: lemos o blog INTEIRO de uma vez, de 15 em 15 minutos, e servimos tudo
 * da memória. Uma varredura custa poucas requisições e paga por milhares de
 * visitas.
 *
 * O QUE ISSO RESOLVE DE GRAÇA
 *   - paginação por número de página, como o site precisa para o SEO;
 *   - busca textual sem gastar quota;
 *   - lista de categorias com contagem, que a API v3 nem oferece;
 *   - zero chamadas remotas durante o acesso do leitor.
 *
 * O QUE ISSO CUSTA
 *   - memória proporcional ao tamanho do blog (alguns MB, aceitável);
 *   - a primeira requisição após um "nascimento" de instância espera a
 *     varredura completa;
 *   - conteúdo novo demora até INDEX_TTL_MS para aparecer. 15 minutos é um
 *     intervalo honesto para um blog e pode ser reduzido à vontade.
 *
 * Se um dia o blog crescer para dezenas de milhares de posts, o caminho é
 * trocar a memória por um armazenamento externo (KV) mantendo esta mesma
 * interface. Os endpoints não precisariam mudar.
 */

interface ListOptions {
  page: number
  pageSize: number
  label?: string | undefined
}

/**
 * Espera mínima entre duas tentativas de varredura que FALHARAM.
 *
 * Sem isso existe um efeito colateral feio: se a API do Blogger estiver fora do
 * ar (ou a chave estiver errada), cada visita ao site dispara uma nova tentativa
 * de varredura. Ou seja, o problema do vizinho vira um ataque de nós mesmos
 * contra ele, e a quota da API derrete justamente no momento em que ela já está
 * com problema.
 *
 * Com o intervalo, a primeira falha "liga um cronômetro" e as requisições
 * seguintes recebem o erro na hora, sem tocar na rede. Trinta segundos é curto o
 * bastante para o serviço se recuperar sozinho e longo o bastante para não
 * martelar o upstream.
 */
const RETRY_COOLDOWN_MS = 30_000

function toSummary(post: Post): PostSummary {
  return {
    id: post.id,
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    publishedAt: post.publishedAt,
    updatedAt: post.updatedAt,
    labels: post.labels,
    coverUrl: post.coverUrl,
    sourceUrl: post.sourceUrl,
  }
}

class PostIndex {
  #posts: Post[] = []
  #bySlug = new Map<string, Post>()
  #labels: LabelSummary[] = []
  #loadedAt: number | null = null
  #refreshing: Promise<void> | null = null
  #lastAttemptAt = 0
  #lastError: string | null = null
  /** O erro original, guardado para poder ser relançado com o tipo intacto. */
  #lastFailure: unknown = null

  /**
   * Devolve o índice, atualizando se necessário.
   *
   * O comportamento é "stale-while-revalidate": se já temos dados, mesmo
   * vencidos, respondemos na hora e atualizamos em segundo plano. Nenhum
   * visitante espera pela atualização. Só a primeira requisição de uma
   * instância nova espera, porque aí não existe nada para servir.
   */
  async get(): Promise<Post[]> {
    const isFresh =
      this.#loadedAt !== null && Date.now() - this.#loadedAt < env.INDEX_TTL_MS

    if (isFresh) return this.#posts

    // Falhou há pouco? Não insiste. Ver RETRY_COOLDOWN_MS.
    const inCooldown =
      this.#lastError !== null && Date.now() - this.#lastAttemptAt < RETRY_COOLDOWN_MS

    if (inCooldown) {
      // Sem dado nenhum para servir, o jeito é devolver o erro (502 no cliente).
      if (this.#loadedAt === null) throw this.#lastFailure

      // Com dado vencido, conteúdo velho é melhor que tela de erro.
      return this.#posts
    }

    if (this.#loadedAt !== null) {
      // Já temos conteúdo (vencido). Libera a resposta e atualiza por trás.
      void this.#refresh().catch(() => {
        // O erro já foi registrado em #lastError. Aqui só evitamos que a
        // Promise rejeitada derrube o processo.
      })
      return this.#posts
    }

    await this.#refresh()
    return this.#posts
  }

  /** Garante que a varredura aconteça uma vez só, mesmo com várias chamadas. */
  #refresh(): Promise<void> {
    this.#refreshing ??= this.#load()
      .then((posts) => {
        this.#posts = posts
        this.#bySlug = new Map(posts.map((post) => [slugKey(post.slug), post]))
        this.#labels = buildLabels(posts)
        this.#loadedAt = Date.now()
        this.#lastError = null
        this.#lastFailure = null
      })
      .catch((error: unknown) => {
        this.#lastError = error instanceof Error ? error.message : String(error)
        this.#lastFailure = error
        throw error
      })
      .finally(() => {
        this.#refreshing = null
      })

    return this.#refreshing
  }

  async #load(): Promise<Post[]> {
    // Marcamos a tentativa ANTES de chamar a rede. Se marcássemos depois, um
    // timeout longo deixaria a janela de espera aberta para outra tentativa
    // entrar em paralelo.
    this.#lastAttemptAt = Date.now()

    const raw = await fetchAllPosts()
    const posts: Post[] = []
    const usedSlugs = new Set<string>()

    for (const item of raw) {
      const post = normalizePost(item, usedSlugs)
      if (post) posts.push(post)
    }

    // Mais recentes primeiro. Ordenamos por timestamp, não por texto: datas com
    // fusos diferentes (`-03:00` e `-02:00`) se ordenam errado como string.
    posts.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    return posts
  }

  async list({ page, pageSize, label }: ListOptions): Promise<Paginated<PostSummary>> {
    const all = await this.get()

    const filtered = label
      ? all.filter((post) => post.labels.some((item) => fold(item) === fold(label)))
      : all

    return paginate(filtered, page, pageSize, toSummary)
  }

  async search(query: string, page: number, pageSize: number): Promise<Paginated<PostSummary>> {
    const term = fold(query)
    if (term.length === 0) {
      return paginate<Post>([], page, pageSize, toSummary)
    }

    const all = await this.get()
    const matches = all.filter((post) => {
      // Buscamos no título e no texto do post. O resumo tem só 180 caracteres,
      // então serve de atalho barato antes de olhar o corpo inteiro.
      return (
        fold(post.title).includes(term) ||
        fold(post.excerpt).includes(term) ||
        fold(post.html).includes(term)
      )
    })

    return paginate(matches, page, pageSize, toSummary)
  }

  async bySlug(slug: string): Promise<Post | null> {
    await this.get()
    return this.#bySlug.get(slugKey(slug)) ?? null
  }

  async labels(): Promise<LabelSummary[]> {
    await this.get()
    return this.#labels
  }

  /** Estado do índice, para o endpoint de saúde. Não dispara varredura. */
  status(): {
    loaded: boolean
    ageMs: number | null
    postCount: number
    labelCount: number
    lastError: string | null
  } {
    return {
      loaded: this.#loadedAt !== null,
      ageMs: this.#loadedAt === null ? null : Date.now() - this.#loadedAt,
      postCount: this.#posts.length,
      labelCount: this.#labels.length,
      lastError: this.#lastError,
    }
  }

  /**
   * Marca o índice como vencido depois de uma escrita.
   *
   * Sem isso, um post recém-publicado ficaria invisível no site até o TTL de 15
   * minutos vencer — o que pareceria bug para quem acabou de publicar.
   *
   * Usa 0 em vez de `null` de propósito. `null` significa "nunca carregado", e
   * aí a próxima consulta esperaria uma varredura completa. Com 0, o índice
   * continua sendo servido na hora e a atualização acontece por trás.
   */
  invalidate(): void {
    if (this.#loadedAt !== null) this.#loadedAt = 0
  }

  /**
   * Força a releitura e ESPERA ela terminar.
   *
   * Usado depois de uma escrita, quando queremos responder ao painel somente
   * com o índice já atualizado. Custa o tempo de uma varredura (cerca de um
   * segundo num blog pequeno), mas elimina a corrida em que a interface
   * recarrega a lista e ainda vê o estado antigo.
   *
   * Se já houver uma varredura em andamento, aproveita a mesma.
   */
  async refreshNow(): Promise<void> {
    await this.#refresh()
  }
}

/**
 * Converte um post cru do Blogger no formato do nosso contrato.
 *
 * Devolve `null` em vez de lançar quando o post é inválido. Motivo: se um único
 * post vier com formato estranho, o certo é pular esse post e manter o blog no
 * ar, não derrubar o índice inteiro. O erro é registrado para aparecer no log.
 */
function normalizePost(raw: RawPost, usedSlugs: Set<string>): Post | null {
  const slug = slugFromUrl(raw.url)
  if (!slug) {
    console.warn(`[post-index] Post ${raw.id} sem slug utilizável em "${raw.url}". Ignorado.`)
    return null
  }

  // Slugs vêm da URL, então dois posts podem colidir (títulos iguais em meses
  // diferentes). O sufixo resolve sem depender de decisão humana.
  let uniqueSlug = slug
  if (usedSlugs.has(slugKey(uniqueSlug))) {
    uniqueSlug = `${slug}-${raw.id}`
  }
  usedSlugs.add(slugKey(uniqueSlug))

  const content = raw.content ?? ''
  const cover = pickCoverImage((raw.images ?? []).map((image) => image.url))

  try {
    return PostSchema.parse({
      id: raw.id,
      slug: uniqueSlug,
      title: raw.title,
      excerpt: excerptFrom(content),
      publishedAt: raw.published,
      updatedAt: raw.updated,
      /**
       * A padronização dos rótulos acontece AQUI, e não na interface, de
       * propósito.
       *
       * O nome do rótulo aparece em quatro lugares: nas abas, nos chips de cada
       * card, no título da página de assunto e no `<title>`. Se cada um
       * formatasse por conta própria, bastaria um esquecimento para o site
       * mostrar "purple" numa aba e "Purple" no card.
       *
       * Padronizando na entrada, tudo que vem depois herda a correção. Inclusive
       * `/api/labels`, que é agregado a partir daqui.
       */
      labels: normalizeLabels(raw.labels ?? []),
      coverUrl: cover ? resizeBloggerImage(cover, IMAGE_WIDTH.cover) : null,
      sourceUrl: raw.url,
      html: sanitizePostHtml(content, {
        blogOrigin,
        siteOrigin: env.SITE_ORIGIN,
      }),
    })
  } catch (error) {
    console.warn(
      `[post-index] Post ${raw.id} não passou na validação e foi ignorado:`,
      error instanceof Error ? error.message : error,
    )
    return null
  }
}

/** Monta a lista de rótulos com contagem, do mais usado para o menos usado. */
function buildLabels(posts: readonly Post[]): LabelSummary[] {
  const counts = new Map<string, { name: string; count: number }>()

  for (const post of posts) {
    for (const label of post.labels) {
      const key = fold(label)
      const current = counts.get(key)
      if (current) {
        current.count += 1
      } else {
        counts.set(key, { name: label, count: 1 })
      }
    }
  }

  return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'pt-BR'))
}

/**
 * Fatia a lista em uma página.
 *
 * O `pageSize` já chega limitado pela rota, então aqui não há surpresa de
 * memória. `totalPages` usa `Math.max(1, ...)` para que um blog vazio tenha
 * uma página em vez de zero, o que evita divisão por zero na interface.
 */
function paginate<T>(
  source: readonly T[],
  page: number,
  pageSize: number,
  map: (item: T) => PostSummary,
): Paginated<PostSummary> {
  const totalItems = source.length
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  const safePage = Math.min(page, totalPages)
  const start = (safePage - 1) * pageSize
  const slice = source.slice(start, start + pageSize)

  return {
    items: slice.map(map),
    page: safePage,
    pageSize,
    totalItems,
    totalPages,
    hasMore: safePage < totalPages,
  }
}

/**
 * Instância única do índice para o processo todo.
 *
 * Em serverless, isso significa uma instância por contêiner. É o comportamento
 * desejado: cada contêiner mantém o próprio índice quente e o cache de borda do
 * provedor absorve o resto do tráfego antes de chegar aqui.
 */
export const postIndex = new PostIndex()
