import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ClosingRepository } from './closing.repository';
import { ClosingService } from './closing.service';

/**
 * T-C03 — o Closing Report é gerado sem ler apostas (§16.7). **Guarda de
 * regressão** (test-design §5.4): o service só conhece o repository do
 * closing, e esse repository não toca `Bet`, `BetWeeklySelection`, stake,
 * `expectedTotal`, a conta do membro (BattleTag, id) ou o depositante. O
 * officer que publica é gravado (§16.7) — isso não é dado de membro. Se um join conveniente aparecer,
 * esta guarda quebra antes de o documento vazar.
 */
describe('T-C03 — closing sem ler apostas', () => {
  it('o ClosingService depende só do ClosingRepository', () => {
    const deps = Reflect.getMetadata('design:paramtypes', ClosingService) as unknown[];
    expect(deps).toEqual([ClosingRepository]);
  });

  it('o ClosingRepository não lê aposta, escolha, stake nem a conta do membro', () => {
    const fonte = readFileSync(join(__dirname, 'closing.repository.ts'), 'utf8')
      // Comentários explicam o que não se lê; só o código conta.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    for (const proibido of [
      /\.bet\b/,
      /\bbets\b/,
      /betWeeklySelection|weeklySelections/,
      /stake/i,
      /expectedTotal/,
      /ownerBattletag/,
      /ownerUserId/,
      /depositCharacter/,
    ]) {
      expect(fonte).not.toMatch(proibido);
    }
  });
});
