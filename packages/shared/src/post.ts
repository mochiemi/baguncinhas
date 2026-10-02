import { z } from 'zod'

/**
 * O que este arquivo é, em uma frase:
 * é a DEFINIÇÃO DO CONTRATO entre o BFF e o front.
 *
 * Por que usar Zod e não só uma `interface` do TypeScript?
 * Porque `interface` some quando o código roda. Ela protege você enquanto você
 * escreve, mas não faz nada quando chega um JSON de verdade vindo do Blogger.
 * O Zod faz as duas coisas:
 *   1. Valida em tempo de execução (o BFF descobre na hora se o Blogger mudou
 *      o formato, em vez de servir um post com título `undefined`).
 *   2. Infere o tipo TypeScript (`z.infer`), que o front importa e usa.
 *
 * Ou seja: uma única declaração produz validação E tipagem. Se as duas
 * divergirem, é impossível — elas são a mesma coisa.
 */
export const PostSummarySchema = z.object({
  /** ID numérico do Blogger, em string. É a chave estável do post. */
  id: z.string(),
  /** Pedaço final da URL original. É o que aparece em /post/:slug. */
  slug: z.string(),
  title: z.string(),
  /**
   * O Blogger não fornece resumo. O BFF extrai o começo do texto puro.
   * Guardamos para as listagens não precisarem carregar o HTML inteiro.
   */
  excerpt: z.string(),
  /** RFC 3339, como o Blogger devolve. Ex: "2024-01-15T10:00:00-03:00". */
  publishedAt: z.string(),
  updatedAt: z.string(),
  labels: z.array(z.string()),
  /**
   * Repare que NÃO guardamos largura e altura.
   * Não é esquecimento: o Blogger não informa as dimensões reais da imagem, e
   * inventar um 16:9 seria mentir para o front. Quem reserva o espaço é o CSS
   * (`aspect-ratio`), que é o lugar certo para uma decisão de layout.
   */
  coverUrl: z.string().url().nullable(),
  /** Endereço do post no Blogger. Útil para o <link rel="canonical">. */
  sourceUrl: z.string().url(),
})

export const PostSchema = PostSummarySchema.extend({
  /**
   * Conteúdo do post, já sanitizado pelo BFF.
   * ATENÇÃO: é HTML. O front renderiza com `v-html` de propósito, e isso só é
   * seguro porque TODO o HTML que sai do BFF passou pelo sanitize-html antes.
   * Nunca renderize HTML direto do Blogger.
   */
  html: z.string(),
})

export interface LabelSummary {
  name: string
  count: number
}

export type PostSummary = z.infer<typeof PostSummarySchema>
export type Post = z.infer<typeof PostSchema>
