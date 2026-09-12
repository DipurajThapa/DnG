// Local acceptance launcher only. It intentionally uses the seeded Phase 5 fixture.
// Production deployment must replace acceptance identity/secrets with enterprise bindings.
import { phase5Fixture } from '../dist/tests/phase5-fixture.js';

const env = phase5Fixture();
const port = Number(process.env.PORT || 3000);
const runtime = await env.server.listen(port, process.env.HOST || '127.0.0.1');
console.log(`GOLIATH Phase 5 acceptance runtime: ${runtime.url}`);
console.log('Demo users: f5-pm / pm-pass | f5-sponsor / sponsor-pass | admin1 / admin-pass');

const shutdown = async () => {
  await env.server.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
