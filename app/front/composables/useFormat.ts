/**
 * Formatação de datas.
 *
 * Detalhe que evita um bug chato: o fuso é FIXO em São Paulo.
 *
 * Se usássemos o fuso do visitante, a data renderizada no servidor (que roda em
 * UTC ou no fuso do datacenter) seria diferente da data renderizada no
 * navegador (no fuso de quem lê). O Vue detecta essa diferença e reclama de
 * "hydration mismatch", além de o texto piscar trocando de valor.
 *
 * Como o blog é brasileiro, fixar o fuso resolve os dois problemas e ainda
 * garante que todo mundo veja a mesma data.
 */
const TIME_ZONE = 'America/Sao_Paulo'

const longFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'long',
  year: 'numeric',
  timeZone: TIME_ZONE,
})

const shortFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: TIME_ZONE,
})

/** "15 de janeiro de 2024" */
export function formatDateLong(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return longFormatter.format(date)
}

/** "15/01/2024" — mais compacto, para listagens e atributos de máquina. */
export function formatDateShort(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return shortFormatter.format(date)
}

/** Formato que o `<time datetime="">` espera. */
export function toMachineDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString()
}
