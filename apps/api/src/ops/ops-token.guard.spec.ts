import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { OpsTokenGuard } from './ops-token.guard';

describe('OpsTokenGuard', () => {
  let guard: OpsTokenGuard;
  const originalToken = process.env.OPS_TRIGGER_TOKEN;

  function contexto(header?: string): ExecutionContext {
    const req = { header: (nome: string) => (nome === 'x-ops-token' ? header : undefined) };
    return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    guard = new OpsTokenGuard();
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env.OPS_TRIGGER_TOKEN;
    else process.env.OPS_TRIGGER_TOKEN = originalToken;
  });

  it('recusa quando OPS_TRIGGER_TOKEN não está configurado — travado por padrão', () => {
    delete process.env.OPS_TRIGGER_TOKEN;
    expect(() => guard.canActivate(contexto('qualquer-coisa'))).toThrow(UnauthorizedException);
  });

  it('recusa token ausente', () => {
    process.env.OPS_TRIGGER_TOKEN = 'segredo';
    expect(() => guard.canActivate(contexto(undefined))).toThrow(UnauthorizedException);
  });

  it('recusa token errado do mesmo tamanho', () => {
    process.env.OPS_TRIGGER_TOKEN = 'segredo-certo';
    expect(() => guard.canActivate(contexto('segredo-outro'))).toThrow(UnauthorizedException);
  });

  it('recusa token de tamanho diferente sem estourar no timingSafeEqual', () => {
    process.env.OPS_TRIGGER_TOKEN = 'segredo-bem-grande';
    expect(() => guard.canActivate(contexto('curto'))).toThrow(UnauthorizedException);
  });

  it('aceita o token certo', () => {
    process.env.OPS_TRIGGER_TOKEN = 'segredo-certo';
    expect(guard.canActivate(contexto('segredo-certo'))).toBe(true);
  });
});
