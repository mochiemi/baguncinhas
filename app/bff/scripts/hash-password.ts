import { createInterface } from 'node:readline/promises'

import { hashPassword } from '../src/auth/password.js'

/**
 * Gera o valor que vai em `ADMIN_PASSWORD_HASH`.
 *
 * Uso:
 *   pnpm --filter @mochiblog/bff hash:password
 *   pnpm --filter @mochiblog/bff hash:password -- "minha senha"
 *
 * A saída é a linha inteira, no formato `scrypt$sal$hash`. Copie e cole no .env.
 */

const MIN_LENGTH = 8

async function readFromStdin(): Promise<string> {
  // Entrada canalizada (`"senha" | pnpm ...`): lê tudo que chegar.
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = []
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.from(chunk as Buffer))
    }
    return Buffer.concat(chunks).toString('utf8').trim()
  }

  // Terminal interativo: lê uma linha.
  //
  // A senha aparece na tela enquanto é digitada. Não é ideal, mas mascarar
  // exigiria manipular o terminal byte a byte, e o ganho aqui é pequeno: é uma
  // ferramenta local, rodada uma vez, na máquina de quem já tem acesso a tudo.
  // Se preferir que não apareça, use a forma canalizada, que também não deixa
  // rastro no histórico do shell.
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question('Senha do painel (aparece na tela): ')
  rl.close()
  return answer.trim()
}

const fromArgument = process.argv[2]
const password = fromArgument ?? (await readFromStdin())

if (password.length === 0) {
  console.error('Nenhuma senha recebida.\n')
  console.error('Uso:')
  console.error('  pnpm --filter @mochiblog/bff hash:password')
  console.error('  pnpm --filter @mochiblog/bff hash:password -- "minha senha"')
  process.exit(1)
}

if (password.length < MIN_LENGTH) {
  console.error(`A senha precisa ter pelo menos ${MIN_LENGTH} caracteres.`)
  process.exit(1)
}

if (fromArgument) {
  console.error(
    'Aviso: a senha veio como argumento e pode ter ficado no histórico do terminal.\n',
  )
}

console.log(await hashPassword(password))
