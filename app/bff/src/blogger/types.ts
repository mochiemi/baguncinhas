/**
 * Formatos crus da API do Blogger (v3).
 *
 * Só declaramos os campos que realmente usamos. A API devolve muito mais coisa
 * (`selfLink`, `author`, `replies`, `etag`...), e declarar tudo daria a falsa
 * impressão de que dependemos daquilo.
 *
 * Estes tipos são um palpite documentado, não uma garantia: eles só descrevem o
 * que ESPERAMOS receber. Quem garante de verdade é a validação com Zod mais
 * adiante, no índice.
 */

export interface RawBlog {
  id: string
  name: string
  description?: string
  url: string
  published?: string
  updated?: string
  posts?: {
    totalItems?: number
  }
}

export interface RawPostImage {
  url: string
}

export interface RawPost {
  id: string
  published: string
  updated: string
  /** URL pública do post no Blogger. Ex.: http://mochiblog.blogspot.com/2024/01/x.html */
  url: string
  title: string
  /** HTML do post. Presente só quando a requisição pede `fetchBodies=true`. */
  content?: string
  labels?: string[]
  /** Presente só quando a requisição pede `fetchImages=true`. */
  images?: RawPostImage[]
}

export interface RawPostList {
  items?: RawPost[]
  nextPageToken?: string
  totalItems?: number
}
