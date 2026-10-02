import { randomBytes } from 'node:crypto'

import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'

import { requireSession } from '../auth/guard.js'
import { sealValue, unsealValue } from '../auth/session.js'
import { inspectAuthorization, listAdministeredBlogs } from '../blogger/oauth.js'
import { env, googleConnectConfig, googleRedirectUri } from '../env.js'
import { asHttpResponse } from '../lib/http.js'

const OAUTH_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token'

/**
 * Escopos pedidos na autorização.
 *
 * - `blogger`: o que permite escrever. É o único indispensável.
 * - `openid` e `email`: não escrevem nada, servem para SABER DE QUEM é o token.
 *
 * Os dois últimos entraram depois de uma confusão cara. Sem eles, a única
 * identificação disponível era o "nome de exibição" do perfil do Blogger, que é
 * apelido e não identifica ninguém — e foi assim que a gente ficou sem saber
 * qual conta estava autorizada, com um erro genérico de "sem permissão".
 *
 * Os três são considerados não sensíveis pelo Google, então não mudam nada no
 * processo de verificação do app.
 */
const AUTH_SCOPES = ['https://www.googleapis.com/auth/blogger', 'openid', 'email']

const STATE_COOKIE = 'mb_oauth_state'

/** Dez minutos é tempo de sobra para autorizar, e curto o bastante para não sobrar. */
const STATE_TTL_MS = 10 * 60 * 1000

/**
 * ============================================================================
 * AUTORIZAÇÃO DE ESCRITA NO BLOGGER
 * ============================================================================
 *
 * Este arquivo existe para resolver um problema específico: obter, UMA vez, o
 * `refresh_token` que permite ao serviço escrever no Blogger.
 *
 * Não confundir com o login do painel. Aquele é nosso, com senha nossa, e
 * acontece toda vez que a autora entra. Este aqui acontece uma vez na instalação,
 * é feito pelo dono do blog, e o resultado vai para a variável de ambiente.
 *
 * Depois que o token está no ambiente, ninguém mais passa por aqui.
 *
 * ---------------------------------------------------------------------------
 * POR QUE OS DOIS ENDPOINTS EXIGEM SESSÃO
 * ---------------------------------------------------------------------------
 * Poderiam ser públicos: o `state` já protege o fluxo. Mas sendo públicos,
 * qualquer pessoa poderia usar o nosso endereço para completar uma autorização
 * com a conta dela. Não sairia nada de útil para ela, e nada de ruim para nós,
 * mas é aquele tipo de porta que não precisa ficar aberta. Quem instala já está
 * logado no painel; exigir sessão não custa nada.
 *
 * ---------------------------------------------------------------------------
 * POR QUE O `state` PRECISA SER SELADO, E NÃO SÓ ALEATÓRIO
 * ---------------------------------------------------------------------------
 * Um valor aleatório no cookie basta contra CSRF. Selado (criptografado e
 * autenticado), ele também não pode ser LIDO nem ADULTERADO pelo navegador, o
 * que significa que o servidor pode confiar no que está ali sem guardar estado
 * nenhum. Reaproveita exatamente o mesmo mecanismo da sessão.
 */

const StateSchema = z.object({
  nonce: z.string(),
  expiresAt: z.number(),
})

const callbackQuerySchema = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
})

interface TokenPayload {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  error?: string
  error_description?: string
}

function escapeHtml(value: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }
  return value.replace(/[&<>"']/g, (char) => map[char] ?? char)
}

/**
 * Página simples para o passo de instalação.
 *
 * É HTML gerado no BFF, e não uma tela do Nuxt, porque este passo é uma coisa
 * que acontece UMA vez, entre o Google e o servidor. Criar uma rota no front,
 * com componente e tipo, para uma página que se vê uma vez na vida seria
 * cerimônia sem retorno. O CSS vai inline pelo mesmo motivo.
 */
function setupPage(title: string, body: string): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body {
    font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
    line-height: 1.6; max-width: 44rem; margin: 3rem auto; padding: 0 1.25rem;
  }
  h1 { font-size: 1.5rem; margin-bottom: .5rem; }
  h2 { font-size: 1.05rem; margin-top: 2rem; }
  code, textarea { font-family: ui-monospace, 'Cascadia Code', monospace; }
  code { background: rgba(127,127,127,.15); padding: .1em .35em; border-radius: 4px; }
  textarea {
    width: 100%; min-height: 5rem; padding: .75rem; font-size: .82rem;
    border: 1px solid rgba(127,127,127,.5); border-radius: .5rem; resize: vertical;
    background: transparent; color: inherit; word-break: break-all;
  }
  button {
    font: inherit; padding: .45rem 1rem; border-radius: .5rem; cursor: pointer;
    border: 1px solid rgba(127,127,127,.5); background: rgba(127,127,127,.12); color: inherit;
  }
  .ok { color: #1a7f4b; }
  .erro { color: #c0392b; }
  .aviso { border-left: 3px solid rgba(127,127,127,.5); padding-left: 1rem; color: rgba(127,127,127,1); }
</style>
</head>
<body>
${body}
</body>
</html>`
}

function sendPage(reply: FastifyReply, status: number, title: string, body: string): FastifyReply {
  return reply.status(status).type('text/html; charset=utf-8').send(setupPage(title, body))
}

function missingConfigPage(missing: string[]): string {
  const items = missing.map((name) => `<li><code>${escapeHtml(name)}</code></li>`).join('')

  return `
<h1 class="erro">Falta configurar as credenciais do Google</h1>
<p>Para iniciar a autorização, o ambiente do BFF precisa destas variáveis:</p>
<ul>${items}</ul>
<p>
  São o <strong>ID de cliente</strong> e o <strong>secret</strong> de um cliente
  OAuth do tipo "Aplicativo da Web", criados no mesmo projeto do Google Cloud onde
  já existe a API key. O passo a passo está no README, na seção
  "Permissão de escrita".
</p>
<p class="aviso">
  Endereço de redirecionamento que precisa estar cadastrado no Google Cloud:<br>
  <code>${escapeHtml(googleRedirectUri())}</code>
</p>
<p><a href="/admin">Voltar ao painel</a></p>`
}

async function exchangeCode(params: {
  code: string
  clientId: string
  clientSecret: string
}): Promise<TokenPayload> {
  const body = new URLSearchParams({
    code: params.code,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    redirect_uri: googleRedirectUri(),
    grant_type: 'authorization_code',
  })

  const response = asHttpResponse(
    await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(8000),
    }),
  )

  return (await response.json()) as TokenPayload
}

export function googleConnectRoutes(
  app: FastifyInstance,
  _options: unknown,
  done: () => void,
): void {
  /**
   * Passo 1: manda o navegador para a tela de consentimento do Google.
   *
   * Precisa ser uma NAVEGAÇÃO do navegador, e não um `fetch`. Por isso, no
   * painel, o botão é um link comum: uma chamada de API receberia um redireciona-
   * mento como resposta em vez de sair da página.
   */
  app.get('/auth/google/connect', { preHandler: requireSession }, async (_request, reply) => {
    if (!googleConnectConfig.ready) {
      return sendPage(reply, 503, 'Falta configurar', missingConfigPage(googleConnectConfig.missing))
    }

    const nonce = randomBytes(24).toString('base64url')

    reply.setCookie(STATE_COOKIE, sealValue({ nonce, expiresAt: Date.now() + STATE_TTL_MS }), {
      path: '/api',
      httpOnly: true,
      sameSite: 'lax',
      secure: env.NODE_ENV === 'production',
      maxAge: Math.floor(STATE_TTL_MS / 1000),
    })

    const url = new URL(OAUTH_AUTHORIZE_URL)
    url.searchParams.set('client_id', googleConnectConfig.clientId)
    url.searchParams.set('redirect_uri', googleRedirectUri())
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', AUTH_SCOPES.join(' '))
    /**
     * `access_type=offline` é o que faz o Google devolver o `refresh_token`.
     * Sem isso vem só um token de uma hora, inútil para uma variável de
     * ambiente.
     */
    url.searchParams.set('access_type', 'offline')
    /**
     * `prompt` com dois valores, separados por espaço:
     *
     * - `consent` força a tela de consentimento mesmo quando a autorização já
     *   existia. É isso que garante o `refresh_token` sempre — sem ele, refazer
     *   este passo depois de perder o token devolveria nada.
     * - `select_account` obriga o Google a MOSTRAR O SELETOR DE CONTAS em vez de
     *   entrar direto com a conta que já está no navegador. Sem isso, não havia
     *   como autorizar com uma conta diferente da anterior — e foi exatamente o
     *   que impediu de corrigir quando a conta errada foi usada.
     */
    url.searchParams.set('prompt', 'consent select_account')
    url.searchParams.set('state', nonce)

    return reply.redirect(url.toString())
  })

  /** Passo 2: recebe o código do Google, troca por tokens e mostra o resultado. */
  app.get('/auth/google/callback', { preHandler: requireSession }, async (request, reply) => {
    const query = callbackQuerySchema.parse(request.query)

    /**
     * O `state` é de uso único. Limpamos o cookie agora, antes de validar:
     * assim um código interceptado não pode ser reapresentado.
     */
    const storedState = request.cookies?.[STATE_COOKIE]
    reply.clearCookie(STATE_COOKIE, { path: '/api' })

    const state = storedState ? unsealValue(storedState, StateSchema) : null
    const stateIsValid =
      state !== null && state.expiresAt > Date.now() && state.nonce === query.state

    if (!stateIsValid) {
      return sendPage(
        reply,
        400,
        'Verificação falhou',
        `<h1 class="erro">A verificação de segurança não confere</h1>
         <p>O cookie que guarda o <code>state</code> não bate com o valor que o Google devolveu,
         ou ele venceu (a validade é de 10 minutos).</p>
         <p>Isso costuma acontecer quando a autorização foi iniciada em outra aba, ou quando
         o passo demorou demais. Não é problema nenhum: é só começar de novo.</p>
         <p><a href="/api/auth/google/connect">Tentar de novo</a> · <a href="/admin">Voltar ao painel</a></p>`,
      )
    }

    if (query.error) {
      const detail = query.error_description ?? query.error
      return sendPage(
        reply,
        400,
        'Autorização recusada',
        `<h1 class="erro">O Google não autorizou</h1>
         <p><code>${escapeHtml(detail)}</code></p>
         <p>Se você recusou a permissão, é só tentar de novo e aceitar.</p>
         <p><a href="/api/auth/google/connect">Tentar de novo</a> · <a href="/admin">Voltar ao painel</a></p>`,
      )
    }

    if (!query.code) {
      return sendPage(
        reply,
        400,
        'Resposta inesperada',
        `<h1 class="erro">O Google não devolveu o código de autorização</h1>
         <p><a href="/api/auth/google/connect">Tentar de novo</a> · <a href="/admin">Voltar ao painel</a></p>`,
      )
    }

    let tokens: TokenPayload
    try {
      tokens = await exchangeCode({
        code: query.code,
        clientId: googleConnectConfig.ready ? googleConnectConfig.clientId : '',
        clientSecret: googleConnectConfig.ready ? googleConnectConfig.clientSecret : '',
      })
    } catch (cause) {
      return sendPage(
        reply,
        502,
        'Falha na troca',
        `<h1 class="erro">Não foi possível falar com o Google</h1>
         <p><code>${escapeHtml((cause as Error).message)}</code></p>
         <p><a href="/api/auth/google/connect">Tentar de novo</a> · <a href="/admin">Voltar ao painel</a></p>`,
      )
    }

    if (tokens.error || !tokens.access_token) {
      const detail = tokens.error_description ?? tokens.error ?? 'resposta sem token de acesso'
      return sendPage(
        reply,
        502,
        'Troca recusada',
        `<h1 class="erro">O Google recusou a troca do código</h1>
         <p><code>${escapeHtml(detail)}</code></p>
         <p class="aviso">
           O motivo mais comum é o endereço de redirecionamento não bater exatamente com o
           cadastrado no Google Cloud. O valor esperado é:<br>
           <code>${escapeHtml(googleRedirectUri())}</code>
         </p>
         <p><a href="/api/auth/google/connect">Tentar de novo</a> · <a href="/admin">Voltar ao painel</a></p>`,
      )
    }

    /**
     * Sem refresh token não serve para nada aqui: um token de acesso vale cerca
     * de uma hora. Acontece quando o Google entende que a permissão já existia.
     * Com `prompt=consent` isso não deveria ocorrer, mas se ocorrer é melhor
     * dizer o que fazer do que mostrar uma tela de sucesso com um valor inútil.
     */
    if (!tokens.refresh_token) {
      return sendPage(
        reply,
        502,
        'Faltou o token permanente',
        `<h1 class="erro">O Google autorizou, mas não devolveu o token permanente</h1>
         <p>Sem ele não dá para escrever: o token de acesso comum vence em cerca de uma hora.</p>
         <p><strong>Como resolver:</strong> remova o acesso desta aplicação em
         <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener">myaccount.google.com/permissions</a>
         e repita este passo.</p>
         <p><a href="/api/auth/google/connect">Tentar de novo</a> · <a href="/admin">Voltar ao painel</a></p>`,
      )
    }

    // Nunca registramos o token. Ele aparece nesta página uma vez e mais nada.
    request.log.info({ scope: tokens.scope }, 'Autorização do Google concluída')

    /**
     * Antes de mostrar o token, perguntamos ao Google se esta conta MANDA nesse
     * blog.
     *
     * Sem esta checagem, o token seria copiado, colado, e só na hora de escrever
     * apareceria "sem permissão" — sem dizer de quem. Foi exatamente o que
     * aconteceu. Aqui o problema aparece no momento em que ele é criado, com o
     * nome da conta.
     */
    const inspection = await inspectAuthorization(tokens.access_token)
    const who = inspection?.email ?? 'não foi possível identificar a conta'

    /**
     * Antes de entregar o token, duas checagens, na ordem em que importam.
     *
     * (1) ESCOPO. Sem o escopo de escrita o token não escreve em blog nenhum, nem
     *     nos que a conta administra. Acontece quando a permissão do Blogger é
     *     desmarcada na tela de consentimento, ou quando o token veio de outro
     *     lugar que pediu só `email` e `openid`. Descobrir isso depois de colar o
     *     token custa uma caçada inteira, então aqui é o momento mais barato.
     * (2) PERMISSÃO. A conta pode não administrar este blog.
     */
    if (inspection?.state === 'no-write-scope') {
      const scopes =
        inspection.grantedScopes.length > 0
          ? `<p>Estes foram os escopos concedidos:</p><ul>${inspection.grantedScopes
              .map((scope) => `<li><code>${escapeHtml(scope)}</code></li>`)
              .join('')}</ul>`
          : `<p>O Google não informou quais escopos foram concedidos.</p>`

      return sendPage(
        reply,
        409,
        'Falta a permissão de escrita',
        `<h1 class="erro">O token não tem a permissão de escrita no Blogger</h1>
         <p>A autorização funcionou, e a conta é <strong>${escapeHtml(who)}</strong>. Mas o
         token veio sem o escopo que permite publicar.</p>
         ${scopes}
         <p><strong>O token desta autorização não serve para escrever.</strong> Por isso ele não
         aparece aqui: seria só um valor para você colar e se decepcionar depois.</p>
         <h2>O que fazer</h2>
         <p>Refaça a autorização e, na tela do Google, <strong>aceite a permissão do
         Blogger</strong> — a que fala em gerenciar as postagens. Sem ela não há escrita,
         por mais certa que seja a conta.</p>
         <p>Se essa permissão nem apareceu na tela, é sinal de que a API do Blogger não
         está ativada neste projeto do Google Cloud. Ative em <em>APIs e serviços</em> e
         tente de novo.</p>
         <p><a href="/api/auth/google/connect">Tentar de novo</a> · <a href="/admin">Voltar ao painel</a></p>`,
      )
    }

    if (inspection?.state === 'verified' && !inspection.hasAdminAccess) {
      /**
       * Em quais blogs esta conta manda.
       *
       * Sem esta lista, a página diz "conta errada" e deixa a pessoa tentando
       * conta por conta no escuro. Com ela, quem autorizou reconhece na hora se
       * pegou a conta trocada: os blogs dele estão ali, e o do projeto não.
       */
      const administered = await listAdministeredBlogs(tokens.access_token)
      const administeredList =
        administered.length === 0
          ? `<p>O Google não informou nenhum blog administrado por esta conta.</p>`
          : `<p>Esta conta administra ${administered.length} blog(s):</p>
             <ul>${administered
               .map(
                 (blog) =>
                   `<li>${escapeHtml(blog.name)} — <a href="${escapeHtml(blog.url)}" target="_blank" rel="noopener">${escapeHtml(blog.url)}</a></li>`,
               )
               .join('')}</ul>
             <p>O blog configurado neste servidor não está na lista, e é por isso que a
             escrita seria recusada.</p>`

      return sendPage(
        reply,
        409,
        'Conta sem acesso ao blog',
        `<h1 class="erro">Esta conta não administra o blog</h1>
         <p>A autorização funcionou, mas o Google informa que a conta
         <strong>${escapeHtml(who)}</strong> não tem acesso de administrador a este blog.</p>
         <p><strong>O token desta autorização não serve para escrever.</strong> Por isso ele não
         aparece aqui: seria só um valor para você colar e se decepcionar depois.</p>
         <h2>O que fazer</h2>
         <p>Repita a autorização, mas escolha a conta que <strong>administra</strong> o blog.
         No seletor de contas, use “Usar outra conta” se ela não estiver na lista.</p>
         <p>Para conferir qual conta administra: abra uma janela anónima em
         <a href="https://www.blogger.com" target="_blank" rel="noopener">blogger.com</a>,
         entre com a conta candidata, e veja se o blog aparece na lista.</p>
         ${administeredList}
         <p><a href="/api/auth/google/connect">Tentar de novo</a> · <a href="/admin">Voltar ao painel</a></p>`,
      )
    }

    /**
     * Chegando aqui, o token tem o escopo de escrita e a conta administra o blog —
     * ou não deu para verificar. Os dois casos ruins já saíram acima com 409, então
     * esta frase descreve o que se sabe, sem prometer mais do que isso.
     */
    const verdict =
      inspection?.state === 'verified' && inspection.hasAdminAccess
        ? ' · com acesso de administrador ao blog.'
        : ''

    const avisoConta =
      inspection === null || inspection.state === 'unknown'
        ? `<p class="aviso">Não consegui confirmar o acesso desta conta ao blog. Se a escrita
           falhar depois, confira se a conta e o escopo estão certos.</p>`
        : ''

    return sendPage(
      reply,
      200,
      'Autorização concluída',
      `<h1 class="ok">Autorização concluída</h1>
       <p>Conta autorizada: <strong>${escapeHtml(who)}</strong>${verdict}</p>

       ${avisoConta}

       <p>Copie o valor abaixo e cole em <code>GOOGLE_REFRESH_TOKEN</code>, no arquivo
       <code>app/bff/.env</code>:</p>

       <textarea readonly id="token" onclick="this.select()">${escapeHtml(tokens.refresh_token)}</textarea>
       <p>
         <button type="button" onclick="navigator.clipboard.writeText(document.getElementById('token').value).then(function () { document.getElementById('copiar').textContent = 'Copiado' })" id="copiar">Copiar</button>
       </p>

       <h2>Depois de colar</h2>
       <ol>
         <li>Reinicie o BFF. O <code>.env</code> só é lido na inicialização.</li>
         <li>Volte ao <a href="/admin">painel</a> e confira que o aviso de permissão sumiu.</li>
       </ol>

       <p class="aviso">
         Este valor não é mostrado de novo. Ele não fica guardado em lugar nenhum:
         aparece nesta página uma única vez. Se perder, é só repetir este passo —
         a autorização pode ser feita quantas vezes for preciso.
       </p>`,
    )
  })

  done()
}
