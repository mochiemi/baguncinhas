/**
 * Ponto de entrada do pacote compartilhado.
 *
 * Regra do projeto: o front importa daqui SOMENTE com `import type`.
 * Isso garante que nada deste pacote (nem o Zod, nem os schemas) entre no
 * bundle do navegador. O front não precisa validar: ele confia no BFF, que é
 * quem conversa com o mundo lá fora.
 */
export * from './post.js'
export * from './api.js'
