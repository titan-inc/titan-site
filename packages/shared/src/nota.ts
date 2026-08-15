import { z } from 'zod';

/**
 * Nota escrita por uma pessoa, para outras pessoas lerem.
 *
 * Existe em dois lugares da sessão de loot, e são campos diferentes de
 * propósito: a nota do **jogador** na resposta (TIT-125, "quero pra offspec
 * porque tanko o segundo boss") e a nota do **loot master** na entrega (TIT-127,
 * "foi pro banco, ninguém quis"). As duas podem existir na mesma peça e para a
 * mesma pessoa. O tratamento do texto é o mesmo, e mora aqui.
 */

/**
 * 500 caracteres.
 *
 * É justificativa, não texto de apoio: cabe o motivo de uma decisão e não cabe
 * uma discussão, que é o que o Discord resolve melhor. O limite existe porque o
 * campo vai para uma tela que outras pessoas leem, e texto sem teto vira o
 * problema de quem renderiza.
 */
export const LIMITE_DA_NOTA = 500;

/**
 * Caractere que não deve chegar à tela.
 *
 * Duas famílias, pelo código e não por regex — escrever a classe com os
 * caracteres literais colocaria no arquivo exatamente os invisíveis que a função
 * existe para tirar, e ninguém enxergaria isso numa revisão.
 *
 * - **controle**: C0, DEL e C1. A quebra de linha sobrevive, e é a única.
 * - **invisível**: largura zero e marcas de direção de escrita. Estas embaralham
 *   a ordem do que aparece na tela sem deixar rastro no texto.
 */
function ehDescartavel(caractere: string): boolean {
  if (caractere === '\n') return false;

  const codigo = caractere.codePointAt(0) ?? 0;

  const controle = codigo < 32 || codigo === 127 || (codigo >= 128 && codigo <= 159);
  const invisivel =
    (codigo >= 0x200b && codigo <= 0x200f) ||
    (codigo >= 0x202a && codigo <= 0x202e) ||
    (codigo >= 0x2060 && codigo <= 0x206f) ||
    codigo === 0xfeff;

  return controle || invisivel;
}

/**
 * Tira o que não é texto de verdade.
 *
 * **Não escapa markdown**, ao contrário do `sanitizeDiscordText` da
 * candidatura: aquele prepara texto para a sintaxe de embed do Discord, e aqui o
 * destino é o React, que já escapa HTML sozinho. Escapar de novo faria a pessoa
 * ver contrabarras que ela não escreveu.
 */
export function limparNota(valor: string): string {
  const limpo = [...valor.replace(/\r\n?/g, '\n')]
    .filter((caractere) => !ehDescartavel(caractere))
    .join('');

  return limpo.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * A nota, já limpa, ou nula.
 *
 * Limpa **no schema**, e não no serviço, para que os dois lados da Regra 2
 * apliquem a mesma regra: o Nest valida com ele, e o form do Next usa o mesmo no
 * resolver. Um serviço que limpasse por fora deixaria o front achar que aceitou
 * um texto que o banco guardou diferente.
 *
 * String vazia — ou que só tinha invisível — vira **nulo**: nota em branco não é
 * nota, e guardar `''` criaria dois jeitos de dizer "não escreveu nada".
 */
export const notaSchema = z
  .string()
  .transform(limparNota)
  .refine((nota) => nota.length <= LIMITE_DA_NOTA, {
    message: `A nota não pode passar de ${LIMITE_DA_NOTA} caracteres`,
  })
  .transform((nota) => (nota === '' ? null : nota));
