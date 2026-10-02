import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { requireSession } from '../auth/guard.js'
import { describeAuthorizedAccount, writeTokenStatus } from '../blogger/oauth.js'
import { googleConnectConfig, googleRedirectUri } from '../env.js'
import {
  bloggerEditUrl,
  createPost,
  deletePost,
  patchPost,
  setPublished,
} from '../blogger/write.js'
import { postIndex } from '../services/post-index.js'

/**
 * Rotas de escrita.
 *
 * Duas coisas valem atenção neste arquivo.
 *
 * 1) TODAS as rotas passam por `requireSession`. É este `preHandler` que
 *    responde à sua preocupação: esconder o botão na interface não impede
 *    ninguém de escrever; o servidor recusando requisição sem sessão, impede.
 *    E como o Fastify interrompe a corrente quando um `preHandler` responde, não
 *    existe caminho em que o handler rode sem passar por aqui.
 *
 * 2) O conteúdo NÃO é sanitizado aqui, de propósito. A sanitização existe para
 *    proteger quem LÊ o nosso site, e ela acontece na leitura, no `postIndex`.
 *    Sanitizar na escrita teria dois efeitos ruins: guardaria no Blogger um
 *    conteúdo já alterado (lembrando que os links internos são reescritos), e
 *    tiraria da autora recursos que o editor do próprio Blogger permite. O que
 *    fica gravado é o que ela escreveu; o que o nosso site exibe é o que passou
 *    pelo filtro.
 */

const postBodySchema = z.object({
  title: z.string().trim().min(1, 'O título não pode ficar vazio.').max(200, 'Título muito longo.'),
  content: z.string().max(400_000, 'Conteúdo muito longo.'),
  /**
   * Passa pela mesma padronização da leitura, para o rótulo não entrar
   * minúsculo e só aparecer corrigido depois de uma varredura.
   */
  labels: z.array(z.string().trim().min(1).max(60)).max(20, 'Muitos rótulos.').default([]),
  /** Rascunho por padrão: publicar deve ser um ato deliberado. */
  draft: z.boolean().default(true),
})

const patchBodySchema = postBodySchema.omit({ draft: true }).partial()

const postIdSchema = z
  .string()
  .regex(/^\d+$/, 'O identificador do post deve ser numérico.')

const publishBodySchema = z.object({ published: z.boolean() })

/**
 * Atualiza o índice depois de uma escrita.
 *
 * O `try/catch` importa: se a escrita deu certo e a releitura falhar, o pedido
 * não pode terminar em erro. Um erro aqui faria a autora achar que o post não
 * foi salvo, quando foi. Registramos e seguimos — o índice se recupera sozinho
 * na próxima consulta.
 */
async function syncIndex(request: FastifyRequest): Promise<void> {
  try {
    await postIndex.refreshNow()
  } catch (error) {
    request.log.warn(
      { err: error },
      'A escrita deu certo, mas a atualização do índice falhou. O conteúdo está salvo.',
    )
  }
}

export function adminRoutes(app: FastifyInstance, _options: unknown, done: () => void): void {
  app.addHook('preHandler', requireSession)

  /**
   * Estado do serviço para o painel.
   *
   * Fica aqui, e não no `/api/health`, por um motivo simples: o health é
   * público. Dizer publicamente quais variáveis de ambiente faltam revela a
   * configuração interna para quem não tem nada a ver com isso. O painel já
   * exige sessão, então a informação fica onde só quem entra vê.
   */
  app.get('/admin/status', async () => {
    const write = writeTokenStatus()

    /**
     * Quem está autorizado de verdade. Só pergunta quando há token configurado,
     * e engole falha: é diagnóstico, não requisito do painel.
     */
    const authorizedAs = write.configured ? await describeAuthorizedAccount() : null

    return {
      write: { ...write, authorizedAs },
      /**
       * O endereço de redirecionamento vai junto porque ele precisa ser
       * cadastrado no Google Cloud com exatidão. Mostrar o valor aqui evita a
       * pessoa ter que descobrir qual é — e um caractere errado faz o Google
       * recusar a autorização com uma mensagem pouco clara.
       */
      connect: {
        ready: googleConnectConfig.ready,
        missing: googleConnectConfig.ready ? [] : googleConnectConfig.missing,
        redirectUri: googleRedirectUri(),
      },
      index: postIndex.status(),
    }
  })

  app.post('/admin/posts', async (request, reply) => {
    const input = postBodySchema.parse(request.body)

    const created = await createPost(
      { title: input.title, content: input.content, labels: input.labels },
      { draft: input.draft },
    )

    // Rascunho não entra na listagem pública, então não há o que atualizar.
    if (!input.draft) await syncIndex(request)

    request.log.info({ postId: created.id, draft: input.draft }, 'Post criado')

    return reply.status(201).send({
      id: created.id,
      title: created.title,
      draft: input.draft,
      url: created.url,
      /** Para adicionar imagens, que a API não permite enviar. */
      editUrl: await bloggerEditUrl(created.id),
    })
  })

  app.patch<{ Params: { id: string } }>('/admin/posts/:id', async (request) => {
    const postId = postIdSchema.parse(request.params.id)
    const input = patchBodySchema.parse(request.body)

    const updated = await patchPost(postId, input)

    // PATCH num rascunho não muda a listagem pública, mas não vale a pena
    // tentar adivinhar: atualizar sempre é mais simples de raciocinar.
    await syncIndex(request)

    request.log.info({ postId }, 'Post alterado')

    return {
      id: updated.id,
      title: updated.title,
      url: updated.url,
      updatedAt: updated.updated,
      editUrl: await bloggerEditUrl(updated.id),
    }
  })

  app.post<{ Params: { id: string } }>('/admin/posts/:id/publish', async (request) => {
    const postId = postIdSchema.parse(request.params.id)
    const { published } = publishBodySchema.parse(request.body)

    const post = await setPublished(postId, published)
    await syncIndex(request)

    request.log.info({ postId, published }, published ? 'Post publicado' : 'Post voltou a rascunho')

    return {
      id: post.id,
      title: post.title,
      published,
      url: post.url,
      editUrl: await bloggerEditUrl(post.id),
    }
  })

  app.delete<{ Params: { id: string } }>('/admin/posts/:id', async (request, reply) => {
    const postId = postIdSchema.parse(request.params.id)

    await deletePost(postId)
    await syncIndex(request)

    request.log.info({ postId }, 'Post excluído')

    return reply.status(204).send()
  })

  done()
}
