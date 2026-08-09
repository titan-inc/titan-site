import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe';

const schema = z.object({ note: z.string().max(10) });

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(schema);

  it('deixa passar corpo válido, já tipado', () => {
    expect(pipe.transform({ note: 'ok' })).toEqual({ note: 'ok' });
  });

  it('corpo inválido vira 400, não 500', () => {
    // 500 diria que o servidor quebrou, mandaria o cliente tentar de novo e
    // acionaria alarme de produção por causa de um corpo malformado.
    expect(() => pipe.transform({ note: 123 })).toThrow(BadRequestException);
  });

  it('diz QUAL campo recusou', () => {
    try {
      pipe.transform({ note: 'texto longo demais para o limite' });
      fail('deveria ter lançado');
    } catch (err) {
      const resposta = (err as BadRequestException).getResponse() as {
        issues: Array<{ path: string }>;
      };
      expect(resposta.issues[0]?.path).toBe('note');
    }
  });

  it('campo ausente também é 400', () => {
    expect(() => pipe.transform({})).toThrow(BadRequestException);
  });

  it('corpo que não é objeto é 400', () => {
    expect(() => pipe.transform('nada disso')).toThrow(BadRequestException);
  });
});
