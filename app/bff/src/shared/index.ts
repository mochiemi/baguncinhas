/**
 * Contrato da API, compartilhado entre o BFF e o front.
 *
 * Regra do projeto: o front importa daqui SOMENTE com `import type`. Isso
 * garante que nada deste código (nem o Zod, nem os schemas) entre no bundle do
 * navegador. O front não precisa validar: ele confia no BFF, que é quem conversa
 * com o mundo lá fora.
 *
 * ⚠️ Este código morava em `packages/shared/`, como pacote à parte do monorepo.
 * Passou a viver aqui porque o Vercel não empacota arquivos que ficam fora da
 * Root Directory do projeto (`app/bff`): a função subia sem o pacote e morria na
 * inicialização com "Cannot find module". Dentro de `src/`, ele é um arquivo
 * comum da árvore, que o Vercel transpila e inclui como todos os outros.
 *
 * A consequência é que o front importa daqui por caminho relativo, apontando
 * para dentro do BFF. Soa estranho, mas descreve a relação real: quem define o
 * contrato é o BFF; o front o consome.
 */
export * from './post.js'
export * from './api.js'
