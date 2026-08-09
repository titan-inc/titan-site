import { z } from 'zod';
import conteudoBruto from '../../content/roster.json';
import { imagensRoster } from './imagens-geradas';

export const membroRosterSchema = z.object({
  nome: z.string().min(1).max(24),
  imagem: z
    .string()
    .min(1)
    .regex(/^[^/\\]+$/)
    .optional(),
  classe: z.string().min(1).optional(),
});

export const conteudoRosterSchema = z.object({
  titulo: z.string().min(1),
  descricao: z.string().min(1),
  membros: z.array(membroRosterSchema),
});

export type MembroRoster = z.infer<typeof membroRosterSchema> & { imagemDisponivel?: boolean };

export function validarConteudoRoster(valor: unknown) {
  return conteudoRosterSchema.parse(valor);
}

export function lerConteudoRoster() {
  const conteudo = validarConteudoRoster(conteudoBruto);
  return {
    ...conteudo,
    membros: conteudo.membros.map((membro) => ({
      ...membro,
      imagemDisponivel: membro.imagem ? imagensRoster.includes(membro.imagem) : false,
    })),
  };
}
