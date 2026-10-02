interface Entry<T> {
  value: T
  expiresAt: number
}

/**
 * Cache em memória com TTL e proteção contra "estampede".
 *
 * O problema que ele resolve:
 * Quando o cache esfria, várias requisições chegam ao mesmo tempo. Sem cuidado,
 * todas disparam a mesma chamada ao Blogger em paralelo, gastando 10x a quota
 * para buscar exatamente o mesmo dado. Isso se chama cache stampede e é bem
 * comum em produção.
 *
 * A solução aqui é guardar a Promise em andamento (não o resultado). Quem
 * chegar depois enquanto a primeira busca está no ar recebe a MESMA Promise.
 *
 * Limitação consciente: é cache de processo. Em serverless, cada instância tem
 * o seu, e instâncias nascem e morrem. Serve para absorver rajada de tráfego e
 * proteger a quota; não substitui Redis se um dia a escala exigir.
 */
export class TtlCache {
  readonly #entries = new Map<string, Entry<unknown>>()
  readonly #inflight = new Map<string, Promise<unknown>>()

  get<T>(key: string): T | undefined {
    const entry = this.#entries.get(key)
    if (!entry) return undefined
    if (entry.expiresAt <= Date.now()) return undefined
    return entry.value as T
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    this.#entries.set(key, { value, expiresAt: Date.now() + ttlMs })
  }

  delete(key: string): void {
    this.#entries.delete(key)
  }

  /** Executa `producer` uma única vez por chave enquanto estiver em andamento. */
  async wrap<T>(key: string, ttlMs: number, producer: () => Promise<T>): Promise<T> {
    const hit = this.get<T>(key)
    if (hit !== undefined) return hit

    const running = this.#inflight.get(key) as Promise<T> | undefined
    if (running) return running

    const promise = producer()
      .then((value) => {
        this.set(key, value, ttlMs)
        return value
      })
      .finally(() => {
        this.#inflight.delete(key)
      })

    this.#inflight.set(key, promise)
    return promise
  }

  stats(): { entries: number; inflight: number } {
    return { entries: this.#entries.size, inflight: this.#inflight.size }
  }
}
