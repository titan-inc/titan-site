import {
  ConflictException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { UserWithCharacters } from '../auth/auth.repository';
import { ApostaRecusada, ContaNaoElegivel } from './apostas.service';
import { AuditoriaRecusada } from './auditoria.service';
import { DepositoRecusado } from './deposito.service';
import { LedgerRecusado } from './settlement.service';
import { PreparacaoInvalida, PreparacaoRecusada } from './preparacao.service';
import { ReadyRecusado } from './ready.service';

/**
 * A conta da sessão, populada pelo guard — id e battletag, nunca do corpo.
 *
 * Dono é o **id da conta**: battletag a pessoa troca. O battletag vai junto só
 * para o registro de quem fez (D-11).
 */
export function contaDe(req: Request): { userId: string; battletag: string } {
  const conta = (req as Request & { account: UserWithCharacters }).account;
  return { userId: conta.id, battletag: conta.battletag };
}

/**
 * Recusa de domínio vira status HTTP, com o motivo; o resto sobe como está.
 *
 * - conta fora do snapshot de bettors → 403: é permissão, não forma (D-38);
 * - aposta recusada e preparação inválida → 422: o pedido é bem formado, a
 *   regra não deixa;
 * - Ready, depósito, Auditar, preparação e ledger recusados → 409: o estado
 *   da rodada, do slip, da auditoria ou do saldo não permite.
 */
export async function comoHttp<T>(operacao: () => Promise<T>): Promise<T> {
  try {
    return await operacao();
  } catch (erro: unknown) {
    if (erro instanceof ContaNaoElegivel) throw new ForbiddenException(erro.message);
    if (erro instanceof ApostaRecusada || erro instanceof PreparacaoInvalida) {
      throw new UnprocessableEntityException(erro.message);
    }
    if (
      erro instanceof ReadyRecusado ||
      erro instanceof DepositoRecusado ||
      erro instanceof AuditoriaRecusada ||
      erro instanceof PreparacaoRecusada ||
      erro instanceof LedgerRecusado
    ) {
      throw new ConflictException(erro.message);
    }
    throw erro;
  }
}
