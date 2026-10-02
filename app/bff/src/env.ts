import { z } from 'zod'

/**
 * Lê o .env além das variáveis já presentes no ambiente.
 *
 * Usamos `process.loadEnvFile`, que é nativo do Node 22. Um pacote `dotenv`
 * funcionaria também, mas é mais uma dependência para fazer algo que o runtime
 * já sabe fazer. O try/catch existe porque em produção (Vercel) o arquivo não
 * existe: as variáveis chegam pelo painel do provedor.
 */
try {
  process.loadEnvFile()
} catch {
  // Sem .env no disco. Em produção isso é o normal, não é erro.
}

/**
 * Validação do ambiente com Zod.
 *
 * Por que falhar na inicialização e não no meio de uma requisição?
 * Porque um erro de configuração é um erro de deploy, não de usuário. Se falta
 * a API key, o processo deve morrer imediatamente com uma mensagem clara, em
 * vez de subir, parecer saudável e estourar 500 no primeiro post lido.
 */
/**
 * Trata string vazia como ausente, em TODO o ambiente.
 *
 * Vazio é o jeito natural de dizer "não configurei isso ainda". Enquanto o
 * tratamento existia só nas variáveis de texto opcionais, havia um buraco: quem
 * cola as chaves do `.env.example` no painel do provedor cria `INDEX_TTL_MS=`
 * vazia, o `z.coerce.number()` converte '' em 0, o `.positive()` recusa, e o
 * processo morre na inicialização. Em serverless isso vira um 500 sem explicação
 * em toda rota, inclusive numa que não existe.
 *
 * A regra vale para qualquer variável, e principalmente para as que têm valor
 * padrão: vazio significa "não configurei", então o padrão é que deve entrar.
 */
function withoutEmptyValues(source: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(source)) {
    // `trim()` junto porque um campo de painel com espaço perdido é indistinguível
    // de um campo vazio para quem digitou, e o efeito seria o mesmo 500.
    if (value !== undefined && value.trim() !== '') result[key] = value
  }
  return result
}

/** Marca a variável de texto como opcional. O vazio já virou ausente acima. */
const optionalString = (schema: z.ZodString) => schema.optional()

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  HOST: z.string().min(1).default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  BLOGGER_API_KEY: z
    .string({
      required_error:
        'Variável ausente. Copie .env.example para .env e preencha com uma chave de API do Google Cloud.',
    })
    .min(1, 'Valor vazio. Gere uma chave de API no Google Cloud e cole aqui (veja .env.example).'),
  BLOGGER_BLOG_URL: z.string().url().default('https://mochiblog.blogspot.com'),
  BLOGGER_BLOG_ID: optionalString(
    z.string().regex(/^\d+$/, 'Deve ser numérico. Deixe vazio para descobrir automático.'),
  ),

  SITE_ORIGIN: z.string().url().default('http://localhost:3000'),

  INDEX_TTL_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  UPSTREAM_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
  DEFAULT_PAGE_SIZE: z.coerce.number().int().positive().default(10),
  MAX_PAGE_SIZE: z.coerce.number().int().positive().default(50),

  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((raw) =>
      raw
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),

  // ---------------------------------------------------------------------------
  // Autenticação do painel de escrita. As três são OPCIONAIS, e de propósito.
  //
  // Enquanto estiverem vazias, o BFF não registra nenhuma rota de escrita nem
  // de login: elas simplesmente não existem (404). É melhor que existir e
  // responder 401, porque a superfície de ataque fica menor — não há o que
  // tentar invadir.
  //
  // O site continua funcionando normalmente como leitura.
  // ---------------------------------------------------------------------------
  /**
   * Nome de usuário do painel. NÃO é um endereço de e-mail, de propósito.
   *
   * Antes isto se chamava `ADMIN_EMAIL`, e o nome cobrou o seu preço: o projeto
   * lida com três contas do Google diferentes (a dona do blog, a que autoriza a
   * escrita, e quem eventualmente administra), e um campo com nome de e-mail no
   * meio do caminho dava a entender que o login do painel tinha relação com
   * alguma delas. Não tem. Este login é nosso, não fala com o Google, e não
   * ganha nada parecendo um endereço.
   *
   * Tampouco se chama só `USER`: em Linux e macOS essa variável já existe no
   * sistema, e o `process.loadEnvFile()` a sobrescreveria dentro do processo.
   */
  ADMIN_USER: optionalString(
    z
      .string()
      .trim()
      .min(3, 'Precisa ter pelo menos 3 caracteres.')
      .regex(/^\S+$/, 'Não pode conter espaços.'),
  ),
  /** Hash scrypt, nunca a senha. Gere com `pnpm --filter @mochiblog/bff hash:password`. */
  ADMIN_PASSWORD_HASH: optionalString(z.string().trim().min(1)),
  /** Mínimo de 32 caracteres. Pode ser aleatório; ninguém digita isso. */
  SESSION_SECRET: optionalString(
    z.string().min(32, 'Precisa ter pelo menos 32 caracteres. Gere uma string aleatória longa.'),
  ),

  // ---------------------------------------------------------------------------
  // Permissão de escrita no Blogger. Também opcional, e independente do bloco
  // acima.
  //
  // O login acima diz QUEM pode entrar no painel. Estas três dizem se o serviço
  // consegue ESCREVER no Blogger. São coisas diferentes: dá para ter o login
  // pronto e ainda não ter a permissão do Google, e nesse caso as rotas de
  // escrita respondem com uma mensagem clara em vez de sumirem.
  //
  // Escrever exige OAuth 2.0; a API key que já usamos só lê. Estes valores vêm
  // de uma autorização feita UMA vez, e ficam parados no servidor.
  // ---------------------------------------------------------------------------
  GOOGLE_CLIENT_ID: optionalString(z.string().trim().min(1)),
  GOOGLE_CLIENT_SECRET: optionalString(z.string().trim().min(1)),
  GOOGLE_REFRESH_TOKEN: optionalString(z.string().trim().min(1)),
})

const parsed = EnvSchema.safeParse(withoutEmptyValues(process.env))

if (!parsed.success) {
  // Mensagem legível: campo + motivo, sem o dump gigante do ZodError.
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(raiz)'}: ${issue.message}`)
    .join('\n')
  throw new Error(`Configuração inválida do ambiente:\n${details}`)
}

export const env = parsed.data

/**
 * Origem do blog, normalizada sem barra final.
 * Usada para decidir se um link do post aponta "para dentro" do Blogger.
 */
export const blogOrigin = new URL(env.BLOGGER_BLOG_URL).origin

/**
 * O bloco de autenticação está completo?
 *
 * As três variáveis formam um conjunto: sem qualquer uma delas, o login não
 * funciona direito. Tratar como "tudo ou nada" evita um estado meio configurado,
 * onde a senha funciona mas o cookie não pode ser assinado, por exemplo.
 *
 * Quando `enabled` é falso, o BFF não registra as rotas de login nem as de
 * escrita. O site segue funcionando como leitura.
 */
export const authConfig = (() => {
  const missing: string[] = []
  if (!env.ADMIN_USER) missing.push('ADMIN_USER')
  if (!env.ADMIN_PASSWORD_HASH) missing.push('ADMIN_PASSWORD_HASH')
  if (!env.SESSION_SECRET) missing.push('SESSION_SECRET')

  if (missing.length > 0) {
    return { enabled: false as const, missing }
  }

  return {
    enabled: true as const,
    user: env.ADMIN_USER as string,
    passwordHash: env.ADMIN_PASSWORD_HASH as string,
    secret: env.SESSION_SECRET as string,
  }
})()

/**
 * Dá para INICIAR a autorização do Google?
 *
 * Precisa do par client ID/secret, mas não do refresh token — é justamente ele
 * que este fluxo produz. Por isso é uma configuração separada de
 * `googleWriteConfig`: no meio do caminho existe um estado legítimo em que já dá
 * para autorizar mas ainda não dá para escrever.
 */
export const googleConnectConfig = (() => {
  const missing: string[] = []
  if (!env.GOOGLE_CLIENT_ID) missing.push('GOOGLE_CLIENT_ID')
  if (!env.GOOGLE_CLIENT_SECRET) missing.push('GOOGLE_CLIENT_SECRET')

  if (missing.length > 0) {
    return { ready: false as const, missing }
  }

  return {
    ready: true as const,
    clientId: env.GOOGLE_CLIENT_ID as string,
    clientSecret: env.GOOGLE_CLIENT_SECRET as string,
  }
})()

/**
 * Endereço para onde o Google devolve a autorização.
 *
 * Derivado de `SITE_ORIGIN` em vez de ter variável própria: assim existe um só
 * lugar que sabe qual é o endereço público, e é o mesmo que já alimenta o
 * canonical do site. Em desenvolvimento dá `http://localhost:3000/...`, em
 * produção dá o domínio real — e é esse valor exato que precisa estar cadastrado
 * no Google Cloud, senão o Google recusa a autorização.
 *
 * O caminho passa pelo front (porta 3000) e não pelo BFF (3001) porque é assim
 * que o navegador enxerga o sistema, e é o que funciona igual nos dois ambientes.
 */
export function googleRedirectUri(): string {
  return new URL('/api/auth/google/callback', env.SITE_ORIGIN).toString()
}

/**
 * O serviço consegue ESCREVER no Blogger?
 *
 * Mesma ideia do bloco de autenticação: as três variáveis do Google formam um
 * conjunto. Sem qualquer uma delas, não há como obter um token de escrita.
 *
 * Quando `enabled` é falso, as rotas de escrita continuam existindo (o que torna
 * o estado visível) mas respondem com um erro explícito dizendo o que falta.
 */
export const googleWriteConfig = (() => {
  const missing: string[] = []
  if (!env.GOOGLE_CLIENT_ID) missing.push('GOOGLE_CLIENT_ID')
  if (!env.GOOGLE_CLIENT_SECRET) missing.push('GOOGLE_CLIENT_SECRET')
  if (!env.GOOGLE_REFRESH_TOKEN) missing.push('GOOGLE_REFRESH_TOKEN')

  if (missing.length > 0) {
    return { enabled: false as const, missing }
  }

  return {
    enabled: true as const,
    clientId: env.GOOGLE_CLIENT_ID as string,
    clientSecret: env.GOOGLE_CLIENT_SECRET as string,
    refreshToken: env.GOOGLE_REFRESH_TOKEN as string,
  }
})()
