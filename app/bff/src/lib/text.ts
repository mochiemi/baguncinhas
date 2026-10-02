/**
 * Utilitários de texto para rótulos.
 *
 * Ficam separados do índice porque são regras de texto, não de armazenamento.
 */

/**
 * Remove acentos e caixa, para comparar rótulos e buscar texto.
 *
 * "Ruka", "ruka" e "RÚKA" viram todos "ruka". É a mesma regra que o front
 * aplica para decidir qual aba fica acesa.
 */
export function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * Deixa a primeira letra maiúscula, mas SÓ quando o rótulo está todo em
 * minúsculas.
 *
 * A condição não é preciosismo. A regra ingênua, "sempre deixar a primeira
 * letra maiúscula", estraga nomes que começam com minúscula de propósito:
 * "iPhone" viraria "IPhone". Só mexemos quando não existe nenhuma maiúscula no
 * rótulo, que é o caso de "purple".
 *
 * O que acontece em cada caso:
 *
 *   "purple"  -> "Purple"      (corrigido)
 *   "café"    -> "Café"
 *   "PURPLE"  -> "PURPLE"      (já tem maiúscula: respeitamos quem escreveu)
 *   "iPhone"  -> "iPhone"      (idem)
 *   "Ruka"    -> "Ruka"
 */
export function capitalizeLabel(label: string): string {
  const trimmed = label.trim()
  if (trimmed.length === 0) return trimmed

  // \p{Lu} = qualquer letra maiúscula Unicode. Com a flag `u` funciona também
  // com "Ç" e "Ã".
  if (/\p{Lu}/u.test(trimmed)) return trimmed

  return trimmed.charAt(0).toLocaleUpperCase('pt-BR') + trimmed.slice(1)
}

/**
 * Padroniza a lista de rótulos de um post e remove repetidos.
 *
 * A remoção de repetidos parece exagero, mas é consequência da padronização: se
 * um post tiver "purple" e "Purple" ao mesmo tempo, os dois virariam "Purple" e
 * o rótulo apareceria duas vezes no mesmo card.
 */
export function normalizeLabels(labels: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const label of labels) {
    const clean = capitalizeLabel(label)
    const key = fold(clean)

    if (key.length === 0 || seen.has(key)) continue

    seen.add(key)
    result.push(clean)
  }

  return result
}
