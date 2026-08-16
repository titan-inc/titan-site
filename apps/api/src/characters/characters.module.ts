import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CharactersRepository } from './characters.repository';

/**
 * A identidade de personagem, usada por quase todo domínio.
 *
 * Módulo sem controller: identidade não é recurso que alguém consulta pela API,
 * é o que loot, presença, snapshot e roster referenciam por dentro. Quem expõe
 * personagem para a tela é o endpoint do domínio, com o gate dele.
 */
@Module({
  imports: [PrismaModule],
  providers: [CharactersRepository],
  exports: [CharactersRepository],
})
export class CharactersModule {}
