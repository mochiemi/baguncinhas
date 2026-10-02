/**
 * Política de cache em duas camadas.
 *
 * `max-age` diz respeito ao NAVEGADOR do leitor. Mantemos curto para que, se
 * alguém corrigir um post no Blogger, a correção apareça rápido na tela de quem
 * já visitou.
 *
 * `s-maxage` diz respeito a CACHE COMPARTILHADO (a CDN do provedor). Aqui pode
 * ser longo, porque uma cópia na borda é servida a milhares de pessoas.
 *
 * `stale-while-revalidate` é a parte elegante: depois de vencer, a CDN ainda
 * pode servir a versão antiga por um tempo enquanto busca a nova em segundo
 * plano. Ninguém espera, e o conteúdo nunca fica velho de verdade.
 */
export const CACHE_LIST = 'public, max-age=60, s-maxage=600, stale-while-revalidate=86400'

/** Post individual muda pouco. Vale cachear mais tempo em todas as camadas. */
export const CACHE_POST = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=604800'

/**
 * A lista de rótulos praticamente não muda e é barata de recalcular.
 * Cache mais longo reduz a pressão sobre o índice.
 */
export const CACHE_LABELS = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400'

/** Saúde do serviço nunca deve ser cacheada: serve para medir agora. */
export const CACHE_NONE = 'no-store'
