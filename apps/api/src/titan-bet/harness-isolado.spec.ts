import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * O harness de validação com o WCL real (`test/wcl-real/`, titan-bet-test-design
 * §40) injeta fontes abaixo da descoberta do Auditar. Isto garante que ele fica
 * fora do produto: nenhum código de produção o conhece, nenhuma suíte padrão o
 * roda e ele não entra na imagem Docker. A regra do Auditar é o T-A21.
 */

const API = path.resolve(__dirname, '../..');
const RAIZ = path.resolve(API, '../..');
const HARNESS = 'test/wcl-real/pipeline.wcl-real.ts';

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = path.join(dir, nome);
    return statSync(caminho).isDirectory() ? arquivos(caminho) : [caminho];
  });
}

describe('harness do WCL real — isolado do produto (§40)', () => {
  it('nenhum arquivo de src/ o referencia, nem a um flag dele', () => {
    const esteArquivo = path.resolve(__filename);
    const suspeitos = arquivos(path.join(API, 'src'))
      .filter((a) => a !== esteArquivo && /\.(t|j)s$/.test(a))
      .filter((a) => /wcl-real|WCL_REAL/.test(readFileSync(a, 'utf8')));
    expect(suspeitos).toEqual([]);
  });

  it('nem o `pnpm test` nem o `pnpm test:db` o executam', () => {
    const unit = (
      JSON.parse(readFileSync(path.join(API, 'package.json'), 'utf8')) as {
        jest: { testRegex: string; rootDir: string };
      }
    ).jest;
    const db = JSON.parse(readFileSync(path.join(API, 'test/jest-db.json'), 'utf8')) as {
      testRegex: string;
    };
    // O unitário só olha dentro de src/; o de banco, só db/**/*.db-spec.ts.
    expect(unit.rootDir).toBe('src');
    expect(new RegExp(unit.testRegex).test(HARNESS)).toBe(false);
    expect(new RegExp(db.testRegex).test(HARNESS)).toBe(false);
  });

  it('fica fora do contexto de build da imagem Docker', () => {
    const ignorado = readFileSync(path.join(RAIZ, '.dockerignore'), 'utf8')
      .split('\n')
      .map((l) => l.trim());
    expect(ignorado).toContain('/apps/api/test/wcl-real');
  });
});
