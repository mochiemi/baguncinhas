import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

/**
 * Hash e conferência de senha.
 *
 * Por que não guardar a senha direto na variável de ambiente:
 * porque variável de ambiente não é um cofre. Ela aparece no painel do provedor,
 * em log de build, em dump de processo mal feito e no print de tela que alguém
 * manda no grupo. Guardando o HASH, o que vaza não serve para entrar no sistema
 * nem para tentar a mesma senha em outro lugar — e as pessoas reutilizam senhas.
 *
 * Por que scrypt e não SHA-256:
 * SHA-256 é rápido, e rápido é exatamente o que um atacante quer. scrypt é
 * propositalmente lento e ocupa memória, o que encarece muito a tentativa por
 * força bruta. Ele já vem no Node, sem dependência nova.
 */

const SCHEME = 'scrypt'
const SALT_BYTES = 16
const KEY_BYTES = 64

/**
 * Envolve o `scrypt` de callback em Promise.
 *
 * Escrito à mão em vez de `promisify` porque o `promisify` devolve `any` para
 * esta função, e aí perderíamos a checagem de tipos justamente onde ela importa.
 */
function derive(password: string, salt: string, keyLength: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, (error, derivedKey) => {
      if (error) reject(error)
      else resolve(derivedKey)
    })
  })
}

/**
 * Gera o valor que vai para `ADMIN_PASSWORD_HASH`.
 *
 * O formato é `scrypt$sal$hash`. Guardar o sal junto é o padrão: o sal não é
 * segredo, ele só precisa ser único, e assim o valor é autossuficiente.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES).toString('hex')
  const key = await derive(password, salt, KEY_BYTES)
  return `${SCHEME}$${salt}$${key.toString('hex')}`
}

/**
 * Confere a senha contra o hash guardado.
 *
 * Devolve `false` em vez de lançar quando o valor guardado está malformado.
 * Motivo: um `ADMIN_PASSWORD_HASH` corrompido deve significar "ninguém entra",
 * não "o servidor cai".
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split('$')
  if (parts.length !== 3) return false

  const [scheme, salt, expected] = parts
  if (scheme !== SCHEME || !salt || !expected) return false

  const expectedKey = Buffer.from(expected, 'hex')
  if (expectedKey.length !== KEY_BYTES) return false

  const key = await derive(password, salt, KEY_BYTES)

  /**
   * `timingSafeEqual` em vez de `===`.
   *
   * Comparar strings com `===` para no primeiro caractere diferente, e o tempo
   * que isso leva é informação: dá para descobrir o hash byte a byte medindo as
   * respostas. O `timingSafeEqual` sempre percorre tudo.
   *
   * Ele lança se os tamanhos forem diferentes, por isso a checagem acima.
   */
  return timingSafeEqual(key, expectedKey)
}
