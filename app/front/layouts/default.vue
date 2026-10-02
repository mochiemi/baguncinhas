<script setup lang="ts">
const { siteName, siteTagline } = useRuntimeConfig().public
</script>

<template>
  <div class="site">
    <a class="skip-link" href="#conteudo">Pular para o conteúdo</a>

    <header class="site__header">
      <div class="container">
        <div class="site__header-inner">
          <NuxtLink to="/" class="brand">
            <span class="brand__name">{{ siteName }}</span>
            <span class="brand__tagline">{{ siteTagline }}</span>
          </NuxtLink>

          <nav class="site__nav" aria-label="Navegação principal">
            <NuxtLink to="/">Início</NuxtLink>
            <NuxtLink to="/busca">Busca</NuxtLink>
          </nav>
        </div>

        <!--
          As abas ficam DENTRO do header, que é sticky, para continuarem
          acessíveis enquanto o leitor rola. Ficam fora do header-inner porque
          são uma segunda linha, e não parte da fileira de marca e menu.
        -->
        <LabelTabs />
      </div>
    </header>

    <main id="conteudo" class="site__main">
      <div class="container">
        <slot />
      </div>
    </main>

    <footer class="site__footer">
      <div class="container">
        <p>{{ siteName }} · feito com carinho (e um pouco de código)</p>
      </div>
    </footer>
  </div>
</template>
