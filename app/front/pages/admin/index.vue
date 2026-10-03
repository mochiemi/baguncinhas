<script setup lang="ts">
const { session, refresh } = useAuth()

/**
 * Conferimos a sessão ANTES de desenhar a tela.
 *
 * O `await` aqui faz parte da renderização no servidor. Se a sessão estiver
 * válida, o HTML já sai com o painel; se não, já sai com o formulário. Sem isso,
 * quem está logado veria o formulário por um instante antes de a tela trocar.
 *
 * O `try/catch` cobre o caso de o BFF estar fora do ar: nessa hora não dá para
 * saber se há sessão, então mostramos o formulário e deixamos o erro real
 * aparecer quando a pessoa tentar entrar. Errar para o lado de "peça a senha" é
 * mais seguro do que errar para o lado de "entre sem senha".
 */
try {
  await refresh()
} catch {
  // Sem resposta do servidor. O formulário cuida do resto.
}

useSeoMeta({
  title: 'Painel',
  /**
   * Fora do índice dos buscadores. Não é segredo (a tela pede senha), mas página
   * de login em resultado de busca só traz ruído e convite a tentativa.
   *
   * O `nofollow` acompanha para os buscadores não seguirem os links daqui.
   */
  robots: 'noindex, nofollow',
})
</script>

<template>
  <AdminPanel v-if="session.authenticated" />
  <AdminLogin v-else />
</template>
