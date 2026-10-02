<script setup lang="ts">
import type { PostSummary } from '@mochiblog/shared'

/**
 * Só importamos o TIPO do pacote compartilhado, com `import type`.
 * Isso é apagado na compilação, então nada do `@mochiblog/shared` (nem o Zod)
 * acaba no bundle que o navegador baixa.
 */
defineProps<{ post: PostSummary }>()
</script>

<template>
  <li class="post-card" :class="{ 'post-card--with-cover': post.coverUrl }">
    <NuxtLink
      v-if="post.coverUrl"
      :to="`/post/${encodeURIComponent(post.slug)}`"
      tabindex="-1"
      aria-hidden="true"
    >
      <img
        class="post-card__cover"
        :src="post.coverUrl"
        alt=""
        loading="lazy"
        decoding="async"
      />
    </NuxtLink>

    <div class="post-card__body">
      <h2 class="post-card__title">
        <NuxtLink :to="`/post/${encodeURIComponent(post.slug)}`">
          {{ post.title }}
        </NuxtLink>
      </h2>

      <p class="post-card__excerpt">{{ post.excerpt }}</p>

      <div class="post-card__meta">
        <time :datetime="toMachineDate(post.publishedAt)">
          {{ formatDateLong(post.publishedAt) }}
        </time>

        <ul v-if="post.labels.length" class="tag-list">
          <li v-for="label in post.labels" :key="label">
            <NuxtLink class="tag" :to="`/tag/${encodeURIComponent(label)}`">
              {{ label }}
            </NuxtLink>
          </li>
        </ul>
      </div>
    </div>
  </li>
</template>
