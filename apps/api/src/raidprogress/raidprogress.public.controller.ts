import { Controller, Get } from '@nestjs/common';
import type { RaidProgressReport } from '@titan/shared';
import { RaidProgressService } from './raidprogress.service';

/**
 * Progressão do tier corrente, **sem guard**, para a landing pública.
 *
 * A ausência de guard é deliberada e tem justificativa, não é esquecimento:
 *
 * - o relatório é da **guilda**, não de pessoas. Que boss morreu, quando e em
 *   quantas pulls. O próprio `RaidProgressController` registra isso ao explicar
 *   por que usa `MemberGuard` e não o gate de oficial. A Regra 7 restringe
 *   histórico individual, que não passa por aqui;
 * - a fonte já é pública. Os logs da guilda estão abertos no warcraftlogs.com
 *   para qualquer pessoa — exibi-los no site da própria guilda não revela nada
 *   que já não estivesse acessível;
 * - a landing existe para isso. "Aferição pública" é a premissa dela desde o
 *   doc 04; até agora a régua da navbar mostrava mock porque não havia por onde
 *   buscar o dado real.
 *
 * O endpoint interno **não muda**: continua com `MemberGuard`, continua aceitando
 * `?season=`. Este aqui é uma superfície nova e mais estreita, não um
 * afrouxamento da existente — sempre o tier corrente, sem parâmetro.
 *
 * Menos parâmetro é menos superfície: sem `season`, ninguém varre o histórico
 * de seasons por uma rota aberta.
 */
@Controller('public/raid-progress')
export class RaidProgressPublicController {
  constructor(private readonly raid: RaidProgressService) {}

  @Get()
  getReport(): Promise<RaidProgressReport | null> {
    return this.raid.getReport();
  }
}
