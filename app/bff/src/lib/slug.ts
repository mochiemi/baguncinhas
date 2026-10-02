/**
 * Extrai o "slug" de um post a partir da URL dele no Blogger.
 *
 * O Blogger gera URLs com data: /2024/01/meu-post-legal.html
 * Nós queremos só "meu-post-legal", porque o resto é ruído para o leitor e
 * engessa a URL caso o post mude de data.
 *
 * Por que o slug vem da URL e não do ID numérico?
 * Porque um endereço como /post/4523871092348 não diz nada a ninguém e não
 * ajuda no ranqueamento. A palavra-chave na URL ajuda.
 *
 * O preço dessa escolha: se o slug mudar (a autora trocar o título), o link
 * antigo passa a dar 404. O Blogger mantém redirecionamento do lado dele, mas
 * não do nosso. Se isso virar problema, a saída é guardar um mapa de slugs
 * antigos para novos.
 */
export function slugFromUrl(postUrl: string): string | null {
  let pathname: string
  try {
    pathname = new URL(postUrl).pathname
  } catch {
    return null
  }

  const segments = decodeURIComponent(pathname)
    .split('/')
    .filter(Boolean)

  const last = segments.at(-1)
  if (!last) return null

  const withoutExtension = last.replace(/\.html?$/i, '').trim()
  return withoutExtension.length > 0 ? withoutExtension : null
}

/**
 * Normaliza um slug que chegou pela URL.
 *
 * O `decodeURIComponent` é necessário porque o navegador entrega o parâmetro
 * ainda codificado: "caf%C3%A9" precisa virar "café" para casar com o índice.
 * O try/catch protege contra % incompleto na barra de endereços (alguém
 * digitando à mão), que faria a função lançar.
 */
export function normalizeSlug(raw: string): string {
  try {
    return decodeURIComponent(raw).trim().toLowerCase()
  } catch {
    return raw.trim().toLowerCase()
  }
}

/** Versão normalizada usada como chave de comparação no índice. */
export function slugKey(slug: string): string {
  return normalizeSlug(slug)
}
