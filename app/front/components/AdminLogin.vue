<script setup lang="ts">
const { login } = useAuth()

const user = ref('')
const password = ref('')
const errorMessage = ref('')
const submitting = ref(false)

async function onSubmit() {
  errorMessage.value = ''
  submitting.value = true

  try {
    await login(user.value, password.value)
    // Deu certo: a sessão muda e a página troca o formulário pelo painel.
  } catch (error) {
    errorMessage.value = describeAuthError(error)
  } finally {
    submitting.value = false
    // A senha nunca fica no campo depois de uma tentativa, mesmo bem-sucedida.
    // Campo de senha preenchido em tela compartilhada é vazamento bobo.
    password.value = ''
  }
}
</script>

<template>
  <section class="login">
    <header class="page-head">
      <span class="page-head__eyebrow">Painel</span>
      <h1>Entrar</h1>
      <p class="page-head__lead">
        Área restrita. Entre para escrever e gerenciar os posts.
      </p>
    </header>

    <form class="card login__form" @submit.prevent="onSubmit">
      <!--
        `type="text"` e não `type="email"`: o campo não é um endereço. Com
        `type="email"` o próprio navegador recusaria um nome sem `@` antes de
        enviar, e a validação dele apareceria no lugar da nossa mensagem.
        `autocomplete="username"` continua certo: é um nome de usuário.
      -->
      <div class="field">
        <label for="campo-usuario">Usuário</label>
        <input
          id="campo-usuario"
          v-model="user"
          type="text"
          name="user"
          autocomplete="username"
          required
          autofocus
        />
      </div>

      <div class="field">
        <label for="campo-senha">Senha</label>
        <input
          id="campo-senha"
          v-model="password"
          type="password"
          name="password"
          autocomplete="current-password"
          required
          :aria-describedby="errorMessage ? 'erro-login' : undefined"
        />
      </div>

      <!--
        `role="alert"` faz o leitor de tela anunciar a mensagem na hora em que ela
        aparece. Sem isso, quem não vê a tela não saberia que a tentativa falhou:
        o texto apareceria em silêncio, longe do foco.
      -->
      <p v-if="errorMessage" id="erro-login" class="form-error" role="alert">
        {{ errorMessage }}
      </p>

      <button class="btn" type="submit" :disabled="submitting">
        {{ submitting ? 'Entrando…' : 'Entrar' }}
      </button>
    </form>
  </section>
</template>
