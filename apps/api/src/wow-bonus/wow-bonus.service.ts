import { Injectable } from '@nestjs/common';
import {
  BONUS_KINDS,
  type BonusDictionaryEntry,
  type BonusDictionaryFile,
  type DecodedBonuses,
} from '@titan/shared';
import { decodeBonuses } from './wow-bonus-decoder';
import { WowBonusRepository, type WowBonusRow } from './wow-bonus.repository';

/** O que a carga fez, para a rota de ops relatar. */
export interface ResultadoDaCargaDeBonus {
  lidos: number;
  porKind: Record<string, number>;
}

const saidaVazia: DecodedBonuses = { track: null, sockets: 0, terciarios: [], desconhecidos: [] };

@Injectable()
export class WowBonusService {
  constructor(private readonly repo: WowBonusRepository) {}

  /** Aplica um arquivo de dicionário ao banco — chamado pela rota de ops. */
  async carregarArquivo(arquivo: BonusDictionaryFile): Promise<ResultadoDaCargaDeBonus> {
    await this.repo.upsertMany(arquivo.bonuses);

    const porKind: Record<string, number> = {};
    for (const entrada of arquivo.bonuses) {
      porKind[entrada.kind] = (porKind[entrada.kind] ?? 0) + 1;
    }

    return { lidos: arquivo.bonuses.length, porKind };
  }

  /**
   * `bonusIds` → estrutura legível.
   *
   * Busca só as entradas destes ids (nunca o dicionário inteiro — a sessão
   * pode chamar isto por item, e o dicionário cresce sem limite conhecido) e
   * delega a decodificação em si para a função pura `decodeBonuses`.
   */
  async decodificar(bonusIds: number[]): Promise<DecodedBonuses> {
    if (bonusIds.length === 0) return saidaVazia;

    const linhas = await this.repo.findByIds(bonusIds);
    const dicionario = new Map(linhas.map((linha) => [linha.bonusId, toBonusEntry(linha)]));

    return decodeBonuses(bonusIds, dicionario);
  }
}

/**
 * A linha do Prisma (colunas nuláveis) vira a union discriminada do shared.
 *
 * Mesmo papel do `toWowItem` em `loot-catalog.service.ts`: é aqui que um dado
 * gravado errado (kind=track sem trackName, por exemplo) vira erro no
 * carregamento, em vez de um `null` estranho escapando para o decodificador.
 * Não deveria acontecer — `WowBonusRepository.upsertMany` sempre grava o
 * conjunto certo de colunas por `kind` — mas se acontecer, é bug de gravação,
 * não dado que a decodificação deveria tentar adivinhar.
 */
function toBonusEntry(linha: WowBonusRow): BonusDictionaryEntry {
  switch (linha.kind) {
    case BONUS_KINDS.TRACK:
      if (linha.trackName === null || linha.trackRank === null || linha.trackMaxRank === null) {
        throw new Error(`bonus ${linha.bonusId}: kind=track sem trackName/trackRank/trackMaxRank`);
      }
      return {
        bonusId: linha.bonusId,
        kind: BONUS_KINDS.TRACK,
        trackName: linha.trackName,
        trackRank: linha.trackRank,
        trackMaxRank: linha.trackMaxRank,
      };
    case BONUS_KINDS.TERTIARY:
      if (linha.tertiary === null) {
        throw new Error(`bonus ${linha.bonusId}: kind=tertiary sem tertiary`);
      }
      return { bonusId: linha.bonusId, kind: BONUS_KINDS.TERTIARY, tertiary: linha.tertiary };
    case BONUS_KINDS.SOCKET:
      return { bonusId: linha.bonusId, kind: BONUS_KINDS.SOCKET };
  }
}
