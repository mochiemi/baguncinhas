/**
 * O Blogger guarda as imagens dele e serve todas as versões a partir da mesma
 * URL. O tamanho é um parâmetro embutido no caminho ou no sufixo:
 *
 *   .../img/b/R29vZ.../s1600/foto.jpg      <- 1600px no maior lado
 *   .../img/a/AVvXs...=s1600               <- mesma ideia, formato novo
 *   .../img/b/R29vZ.../w640-h480-p-k-no-nu/foto.jpg
 *
 * Isso é ouro: dá para pedir 800px para o card da listagem em vez de baixar
 * 1600px e jogar fora metade. Foi exatamente essa disciplina que você aplicou
 * no pipeline de imagens do `bio`.
 *
 * Isto é uma heurística, não uma garantia. Os formatos mudaram pelo menos uma
 * vez, e por isso a função sempre devolve uma URL utilizável: se não reconhecer
 * o padrão, devolve a original intacta em vez de quebrar a imagem.
 */

const BLOGGER_IMAGE_HOST_PATTERN =
  /(^|\.)(blogger\.googleusercontent\.com|googleusercontent\.com|bp\.blogspot\.com)$/i

/** Segmento de tamanho no caminho: /s1600/ ou /w640-h480-p-k-no-nu/ */
const PATH_SIZE_TOKEN = /\/(?:s\d+(?:-c)?|w\d+(?:-h\d+)?(?:-[a-z-]+)*)\//

/** Sufixo de tamanho: =s1600 ou =w640-h480-c */
const SUFFIX_SIZE_TOKEN = /[=](?:s\d+(?:-c)?|w\d+(?:-h\d+)?(?:-[a-z-]+)*)$/

/** Tamanhos usados pelo BFF. Ficam aqui para não haver número mágico espalhado. */
export const IMAGE_WIDTH = {
  /** Capa de card em listagem. Exibida por volta de 400px, com folga para telas densas. */
  cover: 800,
  /** Imagem dentro do corpo do post. */
  content: 1200,
} as const

export function isBloggerImageHost(hostname: string): boolean {
  return BLOGGER_IMAGE_HOST_PATTERN.test(hostname)
}

export function isBloggerImageUrl(rawUrl: string): boolean {
  try {
    return isBloggerImageHost(new URL(rawUrl).hostname)
  } catch {
    return false
  }
}

/**
 * Reescreve a URL para servir a largura pedida.
 * Devolve a original se não reconhecer nenhum dos dois padrões de tamanho.
 */
export function resizeBloggerImage(rawUrl: string, width: number): string {
  const size = `w${width}`

  if (PATH_SIZE_TOKEN.test(rawUrl)) {
    return rawUrl.replace(PATH_SIZE_TOKEN, `/${size}/`)
  }

  const suffix = SUFFIX_SIZE_TOKEN
  if (suffix.test(rawUrl)) {
    return rawUrl.replace(suffix, `=${size}`)
  }

  return rawUrl
}

/**
 * Descobre o tamanho declarado numa URL do Blogger.
 * Devolve `null` quando não há token reconhecível.
 */
export function declaredImageSize(rawUrl: string): number | null {
  const match = /\/(?:s|w)(\d+)(?:-|[/=])/.exec(rawUrl) ?? /[=/]s(\d+)(?:-|$)/.exec(rawUrl)
  if (!match?.[1]) return null
  const value = Number(match[1])
  return Number.isFinite(value) ? value : null
}

/**
 * Escolhe a melhor capa entre as imagens que o Blogger informa.
 *
 * O campo `images` do post é uma lista crua e às vezes traz ícone, avatar de
 * comentário ou sprite do template. Um filtro por tamanho declarado resolve a
 * maioria dos casos: capa de verdade costuma ter 400px ou mais.
 *
 * Se nenhuma imagem passar no filtro, cai para a primeira da lista. É melhor
 * uma capa feia do que nenhuma capa.
 */
export function pickCoverImage(urls: readonly string[]): string | null {
  const valid = urls.filter((url) => {
    try {
      return isBloggerImageUrl(url)
    } catch {
      return false
    }
  })

  if (valid.length === 0) return null

  const large = valid.find((url) => {
    const size = declaredImageSize(url)
    return size !== null && size >= 400
  })

  return large ?? valid[0] ?? null
}
