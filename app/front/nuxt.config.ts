/**
 * URL do BFF.
 *
 * Atenção ao detalhe: esta variável é lida em TEMPO DE BUILD, não em tempo de
 * execução. O motivo é que ela alimenta o `routeRules.proxy` abaixo, e o
 * routeRules vira configuração do servidor Nitro compilado.
 *
 * Consequência prática no Vercel: `BFF_URL` precisa existir nas variáveis de
 * ambiente ANTES do build, senão o site sobe apontando para localhost. Se um
 * dia isso virar um problema, a alternativa é trocar o proxy por um middleware
 * de servidor que leia `useRuntimeConfig()`, que aí passa a ser dinâmico.
 */
const bffUrl = (process.env.BFF_URL ?? 'http://localhost:3001').replace(/\/+$/, '')

export default defineNuxtConfig({
  compatibilityDate: '2024-11-01',

  devtools: { enabled: true },

  css: ['~/assets/css/main.css'],

  /**
   * `runtimeConfig.public` é a forma correta de expor configuração para o
   * navegador. O prefixo `NUXT_PUBLIC_` no ambiente sobrescreve automaticamente:
   * `NUXT_PUBLIC_SITE_URL` vira `public.siteUrl`. Sem espalhar `process.env`
   * pelo código, o que também deixa tudo testável.
   */
  runtimeConfig: {
    public: {
      siteName: 'Mochi Blog',
      siteTagline: 'Culinária, gatos e coisas do dia a dia',
      siteDescription:
        'Um blog sobre receitas, vida em casa e as pequenas coisas. Escrito e mantido por mim.',
      siteUrl: 'http://localhost:3000',
      authorName: 'Mochi',
    },
  },

  /**
   * O proxy que faz a mágica acontecer.
   *
   * O navegador pede `/api/posts` NO PRÓPRIO DOMÍNIO DO SITE. O Nitro recebe,
   * repassa para o BFF e devolve a resposta. Do ponto de vista do navegador, é
   * uma chamada same-origin: não existe preflight, não existe CORS, e a URL do
   * BFF não aparece em lugar nenhum do HTML.
   *
   * Isso funciona igual no servidor (durante a renderização SSR) e no
   * navegador, o que significa que uma página pode ser montada no servidor com
   * dados reais e depois continuar atualizando no cliente pelo mesmo caminho.
   */
  routeRules: {
    '/api/**': {
      proxy: {
        to: `${bffUrl}/api/**`,

        /**
         * `redirect: 'manual'` — a opção mais importante deste arquivo.
         *
         * O `fetch` do Node segue redirecionamento por padrão, e o proxy herdava
         * isso. Na prática: o BFF respondia 302 para a tela de consentimento do
         * Google, o proxy ia buscar essa página sozinho e devolvia 200 com o HTML
         * do Google no lugar do redirecionamento. O navegador nunca era mandado
         * para lugar nenhum, e a autorização travava sem mensagem de erro.
         *
         * Medido, antes de corrigir: porta 3001 (BFF direto) devolvia 302 com a
         * URL certa; porta 3000 (pelo proxy) devolvia 200.
         *
         * Com `manual`, o 302 chega inteiro ao navegador, que é quem deve
         * seguir o redirecionamento.
         */
        fetchOptions: { redirect: 'manual' },
      },
    },

    /**
     * O painel é renderizado só no navegador. Isso não é preguiça, é a única
     * opção correta aqui.
     *
     * O cookie de sessão tem `Path=/api` (ver `app/bff/src/auth/session.ts`),
     * então o navegador NÃO o envia quando pede a página `/admin` — de propósito,
     * para ele não viajar em navegação nem em arquivo estático. A consequência é
     * que o servidor, ao renderizar `/admin`, não tem como saber se há sessão, e
     * renderizaria o formulário de login para quem já está logado.
     *
     * Medido: com cookie válido, o HTML do servidor vinha com o formulário. A
     * pessoa veria "Entre" por um instante e depois o painel, o que parece bug.
     *
     * Desligando o SSR nesta rota, nada de errado é renderizado: a tela espera a
     * resposta de `/api/auth/me` (que aí sim leva o cookie) e desenha o estado
     * certo de primeira. O painel é uma ferramenta privada que já nasce fora do
     * índice dos buscadores, então não perdemos nada de SEO.
     */
    '/admin/**': { ssr: false },
  },

  app: {
    head: {
      htmlAttrs: { lang: 'pt-BR' },
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'theme-color', content: '#e2738d' },
      ],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    },
  },

  typescript: {
    // O typecheck completo roda no `pnpm typecheck`, não a cada build. Rodar
    // junto do build deixa o deploy lento sem ganho real, já que o CI cobre.
    typeCheck: false,
    strict: true,
  },
})
