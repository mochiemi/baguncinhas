<script setup lang="ts">
/**
 * Espelha o `AuthorizationState` do BFF (`src/blogger/oauth.ts`).
 *
 * Duplicado aqui porque o front não importa código do BFF, e criar um pacote para
 * um tipo de diagnóstico seria cerimônia demais. Se isto crescer, o lugar certo
 * passa a ser `packages/shared`.
 *
 * São três casos porque existem dois problemas diferentes, com soluções
 * diferentes: `no-write-scope` é o token sem o escopo de escrita (refazer a autorização
 * aceitando a permissão do Blogger) e `verified` com `hasAdminAccess: false` é a
 * conta errada (autorizar com outra conta).
 */
type AuthorizationState =
  | { state: 'verified'; email: string | null; hasAdminAccess: boolean }
  | { state: 'no-write-scope'; email: string | null; grantedScopes: string[] }
  | { state: 'unknown'; email: string | null }

interface AdminStatus {
  write: {
    configured: boolean
    missing: string[]
    /** `null` só quando nem foi possível perguntar ao Google. */
    authorizedAs: AuthorizationState | null
  }
  connect: {
    ready: boolean
    missing: string[]
    redirectUri: string
  }
  index: {
    loaded: boolean
    postCount: number
    labelCount: number
    ageMs: number | null
  }
}

const { session, logout } = useAuth()
const { siteName, siteUrl } = useRuntimeConfig().public
const request = useRequestFetch()

/**
 * Estado do serviço. Só é buscado quando o painel aparece, ou seja, quando já
 * existe sessão — então esta rota nunca responde 401 aqui.
 */
const { data: status } = await useAsyncData('admin:status', () =>
  request<AdminStatus>('/api/admin/status'),
)

/**
 * O que dizer sobre o token, já traduzido para ação.
 *
 * Existe porque "existe token" e "o token escreve" não são a mesma coisa, e o
 * painel dizia "Configurada" nos dois casos. Foi assim que um token sem o escopo
 * de escrita passou como se estivesse tudo bem, e a escrita começou a falhar sem
 * nenhuma pista na tela.
 *
 * `ok` também é true no caso incerto: sem resposta do Google, o certo é não
 * afirmar nem que está tudo bem nem que está quebrado.
 */
const writeCheck = computed<{
  ok: boolean
  message: string
  hint: string | null
  action: string
}>(() => {
  const auth = status.value?.write.authorizedAs

  if (!auth || auth.state === 'unknown') {
    return {
      ok: true,
      message: 'Configurada. O painel consegue publicar e alterar posts no Blogger.',
      hint: 'Não consegui confirmar no Google se este token consegue escrever no blog.',
      action: 'Trocar a conta autorizada',
    }
  }

  if (auth.state === 'no-write-scope') {
    return {
      ok: false,
      message:
        'O token não tem a permissão de escrita no Blogger, então publicar vai ser recusado.',
      hint: 'Ao autorizar de novo, aceite a permissão do Blogger na tela do Google. É ela que dá o direito de escrever.',
      action: 'Autorizar de novo',
    }
  }

  if (!auth.hasAdminAccess) {
    return {
      ok: false,
      message: `A conta ${auth.email ?? '(não identificada)'} não administra este blog, então publicar vai ser recusado.`,
      hint: 'Autorize com a conta dona do blog.',
      action: 'Autorizar de novo',
    }
  }

  return {
    ok: true,
    message: `Configurada. Os posts saem como ${auth.email ?? 'a conta autorizada'}.`,
    hint: null,
    action: 'Trocar a conta autorizada',
  }
})

const leaving = ref(false)

/**
 * Seleciona o endereço inteiro ao clicar na caixa.
 *
 * Detalhe pequeno que evita erro bobo: quem vai colar no Google Cloud precisa
 * copiar a URL INTEIRA, e um caractere a menos faz o Google recusar a
autorização com uma mensagem que não ajuda.
 */
function selectOnFocus(event: FocusEvent) {
  const target = event.target as HTMLTextAreaElement | null
  target?.select()
}

async function onLogout() {
  leaving.value = true
  try {
    await logout()
  } finally {
    leaving.value = false
  }
}
</script>

<template>
  <section class="admin">
    <header class="page-head">
      <span class="page-head__eyebrow">Painel</span>
      <h1>{{ siteName }}</h1>
      <p class="page-head__lead">
        Conectado como <strong>{{ session.user }}</strong>.
      </p>
    </header>

    <!--
      Permissão de escrita
      Este bloco é o que dá sentido ao painel enquanto a escrita não está ligada:
      em vez de um botão que falha, ele diz exatamente o que falta e onde.
      São três estados possíveis, e cada um pede uma ação diferente.
    -->
    <div class="card">
      <h2 class="card__title">Permissão de escrita</h2>

      <!-- 1. Existe token. Nem sempre ele funciona, então este estado tem subtons. -->
      <template v-if="status?.write.configured">
        <p class="card__text">{{ writeCheck.message }}</p>

        <p v-if="writeCheck.hint" class="card__text card__text--muted">
          {{ writeCheck.hint }}
        </p>

        <!--
          O link de autorizar precisa existir TAMBÉM quando já existe token.

          Antes ele só aparecia quando não havia token nenhum, e o resultado era o
          pior caso possível: o painel mandava "autorize de novo com a conta dona do
          blog" e não oferecia como. Quem tem token errado é justamente quem mais
          precisa deste link.
        -->
        <p>
          <a
            :class="writeCheck.ok ? 'btn btn--ghost' : 'btn'"
            href="/api/auth/google/connect"
          >{{ writeCheck.action }}</a>
        </p>
      </template>

      <!-- 2. Já dá para autorizar: falta só clicar e aceitar. -->
      <template v-else-if="status?.connect.ready">
        <p class="card__text">
          Falta autorizar. O login funciona, mas publicar depende de uma
          autorização do Google, dada uma única vez.
        </p>

        <!--
          Link comum, e não um `fetch`: o servidor responde com um redirecionamento
          para a tela de consentimento do Google, e isso precisa ser uma navegação
          do navegador. Uma chamada de API receberia o redirecionamento como dado.
        -->
        <p>
          <a class="btn" href="/api/auth/google/connect">Conectar com o Google</a>
        </p>

        <p class="card__text card__text--muted">
          Autorize com a conta que administra o blog. É essa conta que o Google
          exige para permitir a escrita.
        </p>
      </template>

      <!-- 3. Falta criar o cliente OAuth no Google Cloud. -->
      <template v-else>
        <p class="card__text">
          Falta criar as credenciais do Google. Preencha no ambiente do BFF:
        </p>

        <ul class="missing-list">
          <li v-for="item in status?.connect.missing ?? []" :key="item">
            <code>{{ item }}</code>
          </li>
        </ul>

        <p class="card__text card__text--muted">
          No Google Cloud, crie um cliente OAuth do tipo “Aplicativo da Web” e
          cadastre este endereço exato como redirecionamento autorizado:
        </p>

        <textarea class="copy-box" readonly rows="2" @focus="selectOnFocus">{{ status?.connect.redirectUri }}</textarea>

        <p class="card__text card__text--muted">
          O passo a passo completo está no README, seção “Permissão de escrita”.
        </p>
      </template>
    </div>

    <div class="card">
      <h2 class="card__title">Conteúdo</h2>
      <p class="card__text">
        {{ status?.index.postCount ?? 0 }}
        {{ (status?.index.postCount ?? 0) === 1 ? 'post publicado' : 'posts publicados' }}
        no índice, com {{ status?.index.labelCount ?? 0 }}
        {{ (status?.index.labelCount ?? 0) === 1 ? 'rótulo' : 'rótulos' }}.
        Rascunhos não aparecem aqui.
      </p>
    </div>

    <div class="admin__actions">
      <a class="btn" :href="siteUrl" target="_blank" rel="noopener">Ver o site</a>
      <a class="btn btn--ghost" href="https://www.blogger.com" target="_blank" rel="noopener">
        Abrir o Blogger
      </a>
      <button class="btn btn--ghost" type="button" :disabled="leaving" @click="onLogout">
        {{ leaving ? 'Saindo…' : 'Sair' }}
      </button>
    </div>
  </section>
</template>
