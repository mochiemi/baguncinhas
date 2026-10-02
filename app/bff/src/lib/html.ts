import sanitizeHtml from 'sanitize-html'

import { IMAGE_WIDTH, resizeBloggerImage } from './images.js'

/**
 * Este arquivo é o porteiro do conteúdo.
 *
 * O Blogger devolve o post como HTML cru, escrito por quem escreveu o post.
 * Renderizar isso direto no site com `v-html` é aceitar qualquer coisa que
 * esteja lá dentro. Mesmo num blog de confiança, o HTML pode vir de um
 * comentário copiado, de um embed de terceiro ou de um widget do template.
 * Sanitizar aqui, uma vez, no servidor, é mais seguro e mais barato do que
 * tentar limpar depois em cada cliente.
 *
 * ATENÇÃO à versão do sanitize-html (está cravada em `package.json`).
 * Ele é CommonJS e faz `require()` da biblioteca `htmlparser2` por dentro.
 * Só que a partir do sanitize-html 2.17.2 a dependência passou a ser o
 * htmlparser2 10+, que é ESM puro ("type": "module"). Carregar ESM de dentro
 * de CommonJS por `require()` só é possível em Node 22.12 ou mais novo — e o
 * ambiente de produção do Vercel NÃO estava com essa versão, então o servidor
 * morria no boot com "require() of ES Module ... not supported".
 *
 * Por isso fixamos `sanitize-html` em 2.17.1, a última versão que usa o
 * htmlparser2 8 (CommonJS) e funciona em qualquer Node. NÃO troque para `^`
 * nem faça upgrade sem antes checar essa dependência.
 */

/**
 * Tags que um post de blog legitimamente usa.
 * Fora desta lista, o sanitize-html remove a tag e mantém o texto de dentro.
 */
const ALLOWED_TAGS = [
  'p', 'br', 'hr', 'div', 'span',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup', 'mark', 'small',
  'blockquote', 'pre', 'code',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'a', 'img', 'figure', 'figcaption',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
  'iframe', 'video', 'source',
]

const ALLOWED_ATTRIBUTES: sanitizeHtml.IOptions['allowedAttributes'] = {
  a: ['href', 'title', 'target', 'rel', 'name'],
  img: ['src', 'srcset', 'alt', 'width', 'height', 'loading', 'decoding', 'fetchpriority'],
  iframe: ['src', 'width', 'height', 'title', 'allow', 'allowfullscreen', 'frameborder', 'loading'],
  video: ['src', 'controls', 'poster', 'width', 'height'],
  source: ['src', 'type'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan', 'scope'],
  // `class` é necessário: o Blogger marca imagens e blocos com classes próprias
  // (ex.: "separator"), e sem elas o layout do post perde estrutura.
  '*': ['class', 'id', 'dir', 'lang'],
}

/**
 * `style` fica de fora de propósito.
 *
 * Não existe lista de "atributos proibidos" aqui, e nem precisa: como
 * `allowedAttributes` é uma lista de PERMISSÃO, tudo que não está nela já é
 * removido — inclusive `style` e os manipuladores `onerror` / `onclick`.
 *
 * Permitir estilo inline abriria a porta para CSS que escapa do layout
 * (`position: fixed`, `z-index` alto, elemento cobrindo a página inteira). Se
 * um dia for necessário, o caminho é permitir uma lista fechada de
 * propriedades, nunca `style` genérico.
 */

/** Só estes domínios podem aparecer em iframe. Sem isso, um embed vira XSS. */
const ALLOWED_IFRAME_HOSTNAMES = [
  'www.youtube.com',
  'youtube.com',
  'www.youtube-nocookie.com',
  'player.vimeo.com',
  'open.spotify.com',
  'www.google.com',
]

/**
 * Nome de entidade HTML -> caractere.
 * Só as que aparecem em texto corrido de verdade.
 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
}

/**
 * Desfaz a codificação de entidades HTML.
 *
 * Por que isso é necessário: o `sanitize-html` RE-CODIFICA o texto na saída,
 * por segurança. Então um post que fala de "pão & queijo" sai como
 * "pão &amp; queijo". Dentro de uma tag isso é o comportamento correto. Mas o
 * resumo é exibido como TEXTO na tela, e ali o leitor veria a sigla `&amp;`
 * escrita na cara.
 *
 * Aceita entidade nomeada (`&amp;`) e numérica, decimal (`&#39;`) ou
 * hexadecimal (`&#x27;`), que é como o Blogger às vezes escreve acentos.
 */
function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#')) {
      const isHex = entity[1] === 'x' || entity[1] === 'X'
      const digits = isHex ? entity.slice(2) : entity.slice(1)
      const code = Number.parseInt(digits, isHex ? 16 : 10)

      // Fora da faixa válida de code point, devolve o texto original em vez de
      // inventar um caractere.
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match
      return String.fromCodePoint(code)
    }

    return NAMED_ENTITIES[entity.toLowerCase()] ?? match
  })
}

/** Converte o HTML em texto puro. Usado para montar o resumo. */
export function toPlainText(html: string): string {
  const stripped = sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
  return decodeEntities(stripped).replace(/\s+/g, ' ').trim()
}

/**
 * Resume o post para a listagem.
 *
 * O Blogger não tem campo de resumo, então o resumo é derivado. Cortamos no
 * último espaço antes do limite para não partir palavra no meio.
 */
export function excerptFrom(html: string, maxLength = 180): string {
  const text = toPlainText(html)
  if (text.length <= maxLength) return text

  const cut = text.slice(0, maxLength)
  const lastSpace = cut.lastIndexOf(' ')
  const safe = lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut
  return `${safe.trimEnd()}…`
}

export interface SanitizePostOptions {
  /** Origem do blog no Blogger, ex.: "https://mochiblog.blogspot.com". */
  blogOrigin: string
  /** Origem do site, para onde os links internos são reescritos. */
  siteOrigin: string
}

/**
 * Limpa o HTML do post e faz duas correções de rota:
 *
 * 1. Links que apontam para o próprio Blogger são reescritos para o site.
 *    Sem isso, quem clica em "veja também" no meio do texto sai do site sem
 *    perceber e vai parar no blogspot.com.
 *
 * 2. Imagens são pedidas no tamanho que o site realmente exibe.
 *
 * Também marca a primeira imagem como prioritária e o resto como lazy. O
 * `sanitize-html` chama a função de transformação por tag, então usamos um
 * contador por chamada para saber qual é a primeira.
 */
export function sanitizePostHtml(html: string, options: SanitizePostOptions): string {
  let imageCount = 0

  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,

    /**
     * `data:` fica liberado SÓ para imagem.
     *
     * A diferença importa: `data:` num `<img>` é uma imagem embutida, inofensiva
     * (o Blogger usa isso para espaçadores). `data:` num `<a href>` pode ser
     * `data:text/html,<script>...</script>`, que é uma página inteira escrita
     * dentro do link. Permitir o esquema globalmente abriria essa porta.
     */
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['http', 'https', 'data'] },

    allowedIframeHostnames: ALLOWED_IFRAME_HOSTNAMES,

    /**
     * Remove o iframe inteiro quando o domínio não é autorizado.
     *
     * `allowedIframeHostnames` sozinho só apaga o atributo `src`, e o resultado
     * é um `<iframe></iframe>` vazio ocupando espaço no layout. Aqui a tag toda
     * vai embora.
     *
     * ATENÇÃO à semântica invertida: `exclusiveFilter` decide o que fica DE
     * FORA. Retornar `true` significa EXCLUIR o elemento. O nome engana, e foi
     * exatamente o que me pegou na primeira versão deste código.
     */
    exclusiveFilter: (frame) => {
      if (frame.tag !== 'iframe') return false

      const src = frame.attribs.src
      if (!src) return true

      try {
        return !ALLOWED_IFRAME_HOSTNAMES.includes(new URL(src).hostname)
      } catch {
        return true
      }
    },

    // Remove o conteúdo interno de tags perigosas em vez de só a tag.
    nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript'],

    transformTags: {
      a: (tagName, attribs) => {
        const href = attribs.href
        const next = { ...attribs }

        if (href) {
          const internal = rewriteToSiteIfInternal(href, options)
          if (internal) {
            next.href = internal
            // Link interno não deve abrir em nova aba nem levar noopener:
            // ele é parte da navegação do próprio site.
            delete next.target
            next.rel = 'internal'
          } else {
            next.target = '_blank'
            next.rel = 'noopener noreferrer nofollow'
          }
        }

        return { tagName, attribs: next }
      },

      img: (tagName, attribs) => {
        const next = { ...attribs }
        imageCount += 1

        if (next.src) {
          next.src = resizeBloggerImage(next.src, IMAGE_WIDTH.content)
        }

        // Limpa srcset: ele traz as URLs originais em tamanhos variados e
        // anularia a nossa escolha de largura. Melhor perder a densidade do
        // que servir 1600px para um espaço de 700px.
        delete next.srcset

        if (imageCount === 1) {
          // A primeira imagem costuma ser a que aparece na dobra. Ela não deve
          // ser lazy, senão o navegador a descobre tarde e o post "pula".
          next.loading = 'eager'
          next.fetchpriority = 'high'
        } else {
          next.loading = 'lazy'
        }
        next.decoding = 'async'

        return { tagName, attribs: next }
      },
    },
  })
}

/**
 * Se o link aponta para o blog no Blogger, devolve o mesmo caminho no site.
 * Caso contrário, devolve `null` e o link fica como está.
 */
function rewriteToSiteIfInternal(href: string, options: SanitizePostOptions): string | null {
  let parsed: URL
  try {
    parsed = new URL(href, options.blogOrigin)
  } catch {
    return null
  }

  if (parsed.origin !== options.blogOrigin) return null

  // /2024/01/meu-post.html -> /post/meu-post
  const match = /^\/(\d{4})\/(\d{2})\/(.+?)\.html?$/.exec(parsed.pathname)
  if (!match?.[3]) {
    // Link interno que não é post (ex.: /p/sobre.html, /search?q=...).
    // Deixamos quieto: a página pode não existir no site novo.
    return null
  }

  const site = new URL(options.siteOrigin)
  site.pathname = `/post/${match[3]}`
  return site.toString()
}
