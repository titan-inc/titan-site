import { prepararAmbienteDeTeste } from './ambiente';

// `setupFiles` do jest-db.json: roda em cada arquivo de teste antes dos imports
// dele, então todo `PrismaService` construído num `*.db-spec.ts` nasce
// apontando para o `titan_test`.
prepararAmbienteDeTeste();
