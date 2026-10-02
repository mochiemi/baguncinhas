import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

import { z } from 'zod'

import { authConfig, env } from '../env.js'

/**
 * Sessão do painel, guardada em cookie.
 *
 * ---------------------------------------------------------------------------
 * POR QUE COOKIE E NÃO localStorage
 * ---------------------------------------------------------------------------
 * O cookie é marcado como `HttpOnly`, então nenhum JavaScript da página
 * consegue lê-lo. Como este site renderiza HTML vindo do Blogger com `v-html`,
 * essa diferença importa: se algum HTML escapasse do sanitizador, com
 * localStorage a sessão seria roubada, e com HttpOnly não.
 *
 * ---------------------------------------------------------------------------
 * POR QUE CRIPTOGRAFADO (AES-GCM) E NÃO SÓ ASSINADO
 * ---------------------------------------------------------------------------
 * Assinar (HMAC) garante que ninguém inventa uma sessão, mas o conteúdo fica
 * legível: qualquer um que abra o cookie lê o e-mail de quem escreve. A
 * criptografia com autenticação resolve as duas coisas de uma vez — esconde o
 * conteúdo e detecta adulteração, porque a tag do GCM só confere se a chave
 * estiver certa e o texto não tiver sido tocado.
 *
 * ---------------------------------------------------------------------------
 * POR QUE NÃO TEM BANCO DE SESSÕES
 * ---------------------------------------------------------------------------
 * Como o cookie carrega a sessão inteira, o servidor não precisa guardar nada.
 * Isso funciona em serverless, onde não existe memória compartilhada entre
 * instâncias — um "Map de sessões" se perderia a cada instância nova, e o
 * usuário seria deslogado sem motivo.
 *
 * A troca: não é possível revogar uma sessão específica. Com uma única pessoa
 * escrevendo, sair (`logout`) resolve. Se houver mais de uma autora um dia, o
 * lugar certo passa a ser um armazenamento externo, e só este arquivo muda.
 */

export const SESSION_COOKIE = 'mb_session'

/** 30 dias. Sessão longa porque é uma pessoa só, no computador dela. */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

const IV_BYTES = 12
const TAG_BYTES = 16

/**
 * O que a sessão guarda: identidade e validade. Nada mais.
 *
 * O token do Google NÃO entra aqui. Ele vive na variável de ambiente do
 * servidor, então nem existe no navegador. Como o login é nosso, o Google nunca
 * precisa aparecer para quem escreve.
 */
const SessionPayloadSchema = z.object({
  user: z.string(),
  createdAt: z.number(),
  expiresAt: z.number(),
})

export type SessionPayload = z.infer<typeof SessionPayloadSchema>

/**
 * Deriva 32 bytes (o tamanho que o AES-256 exige) a partir do segredo.
 *
 * A chave é calculada uma vez e memorizada, porque isso roda a cada requisição
 * autenticada e não precisa ser recalculado.
 */
let cachedKey: Buffer | null = null

function encryptionKey(): Buffer {
  if (!authConfig.enabled) {
    throw new Error('Autenticação não configurada: não há segredo de sessão para assinar o cookie.')
  }
  cachedKey ??= createHash('sha256').update(authConfig.secret).digest()
  return cachedKey
}

/**
 * Opções do cookie.
 *
 * `path: '/api'` é o detalhe menos óbvio e mais útil: o cookie só é enviado nas
 * chamadas à API. Navegação entre páginas e download de imagem não o carregam,
 * então ele trafega o mínimo possível.
 *
 * A consequência precisa ser dita, porque já mordeu: o navegador NÃO manda este
 * cookie ao pedir a página `/admin`, então o servidor não consegue saber se há
 * sessão ao renderizar o painel. Foi por isso que a rota `/admin` passou a ser
 * renderizada só no navegador (ver `routeRules` no `nuxt.config.ts` do front).
 * Se um dia o painel precisar de SSR, é aqui que se troca o `path` para `/`, e
 * aí a decisão é consciente: o cookie passa a viajar em toda requisição.
 */
export function sessionCookieOptions() {
  return {
    path: '/api',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: env.NODE_ENV === 'production',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  }
}

export function createSession(user: string): SessionPayload {
  const now = Date.now()
  return { user, createdAt: now, expiresAt: now + SESSION_TTL_MS }
}

/**
 * Criptografa e autentica qualquer objeto JSON.
 *
 * O formato final é `iv || tag || texto cifrado`, tudo em base64url para poder
 * viajar num cookie sem escape.
 *
 * É genérico, e não específico de sessão, porque o `state` do fluxo OAuth
 * precisa exatamente do mesmo tratamento: ser opaco, não poder ser inventado, e
 * detectar adulteração. Duas implementações disso seria uma a mais do que o
 * necessário.
 */
function sealJson(value: unknown): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)

  const plaintext = Buffer.from(JSON.stringify(value), 'utf8')
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()

  return Buffer.concat([iv, tag, ciphertext]).toString('base64url')
}

/**
 * Abre um valor selado. Devolve `null` para qualquer coisa suspeita: cookie
 * cortado, chave diferente ou texto adulterado.
 *
 * Repare que tudo vira `null`, sem distinguir o motivo. Quem estiver tentando
 * adivinhar não ganha pista sobre qual parte acertou.
 */
function unsealJson(token: string): unknown | null {
  try {
    const raw = Buffer.from(token, 'base64url')
    if (raw.length <= IV_BYTES + TAG_BYTES) return null

    const iv = raw.subarray(0, IV_BYTES)
    const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES)
    const ciphertext = raw.subarray(IV_BYTES + TAG_BYTES)

    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv)
    decipher.setAuthTag(tag)

    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
    return JSON.parse(plaintext) as unknown
  } catch {
    return null
  }
}

export function sealSession(payload: SessionPayload): string {
  return sealJson(payload)
}

export function unsealSession(token: string): SessionPayload | null {
  const raw = unsealJson(token)
  if (raw === null) return null

  const parsed = SessionPayloadSchema.safeParse(raw)
  if (!parsed.success) return null

  // Sessão vencida. O `maxAge` do cookie já deveria ter descartado, mas cookie é
  // do navegador: quem controla a validade é o servidor.
  if (parsed.data.expiresAt <= Date.now()) return null

  return parsed.data
}

/** Sela um valor qualquer. Usado pelo `state` do fluxo OAuth. */
export function sealValue(value: Record<string, unknown>): string {
  return sealJson(value)
}

/** Abre um valor selado e valida com o schema informado. */
export function unsealValue<T>(token: string, schema: z.ZodType<T>): T | null {
  const raw = unsealJson(token)
  if (raw === null) return null

  const parsed = schema.safeParse(raw)
  return parsed.success ? parsed.data : null
}
