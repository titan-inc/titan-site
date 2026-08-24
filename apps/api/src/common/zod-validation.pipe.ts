import { BadRequestException, type PipeTransform } from '@nestjs/common';
import { ZodError, type ZodType } from 'zod';

/**
 * Valida o corpo do request com um schema do `@titan/shared` — Regra 2.
 *
 * Sem ele, `schema.parse()` solto no controller sobe `ZodError` como erro não
 * tratado e o Nest responde **500**. Corpo malformado é erro de quem chamou,
 * não do servidor: 500 manda o cliente tentar de novo e engana o alarme de
 * produção.
 *
 * `instanceof ZodError` só funciona porque `zod` é `external` no tsup do
 * shared. Embutir criaria duas instâncias do zod, o `instanceof` passaria a ser
 * falso e todo erro de validação voltaria a virar 500 — está no CLAUDE.md, e é
 * este o código que depende disso.
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  /**
   * `rotulo` troca o "Corpo do request" da mensagem. Serve para o mesmo pipe
   * validar query string sem mentir sobre onde estava o erro — quem recebe
   * "Corpo do request inválido" depois de mandar `?difficulty=mitico` procura
   * o problema no lugar errado.
   */
  constructor(
    private readonly schema: ZodType<T>,
    private readonly rotulo = 'Corpo do request',
  ) {}

  transform(value: unknown): T {
    try {
      return this.schema.parse(value);
    } catch (err: unknown) {
      if (err instanceof ZodError) {
        // Caminho + mensagem, para o cliente saber QUAL campo recusou. Sem o
        // caminho, "Invalid input" num corpo de 10 campos não ajuda ninguém.
        throw new BadRequestException({
          message: `${this.rotulo} inválido`,
          issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        });
      }
      throw err;
    }
  }
}
