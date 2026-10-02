<script setup lang="ts">
import type { NuxtError } from '#app'

/**
 * Página de erro do Nuxt.
 *
 * Ela vive fora do layout, então precisa trazer o próprio `container`. Esse é o
 * detalhe que costuma fazer a tela de erro aparecer colada na borda enquanto o
 * resto do site está centralizado.
 */
defineProps<{ error: NuxtError }>()

/**
 * `clearError({ redirect })` em vez de um `<a href>` puro.
 * Isso limpa o estado de erro do Nuxt antes de navegar. Sem isso, a página de
 * destino pode continuar mostrando a tela de erro.
 */
function goHome() {
  void clearError({ redirect: '/' })
}
</script>

<template>
  <div class="container error-page">
    <p class="error-page__code">{{ error.statusCode }}</p>
    <h1>
      {{ error.statusCode === 404 ? 'Página não encontrada' : 'Algo deu errado' }}
    </h1>

    <!--
      Mostramos `message`, e não `statusMessage`.

      `statusMessage` vai para a linha de status do HTTP, que só aceita ASCII,
      então ele é curto e em inglês ("Not Found", "Bad Gateway"). O texto em
      português, escrito para o leitor, chega em `message`.
    -->
    <p class="page-head__lead">
      {{ error.message || 'Tente novamente em alguns instantes.' }}
    </p>

    <p style="margin-top: 2rem">
      <a class="btn" href="/" @click.prevent="goHome">Voltar para o início</a>
    </p>
  </div>
</template>
