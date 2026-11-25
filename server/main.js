import { startMatchServer } from './match-server.js';

const server = await startMatchServer({
  port: Number(process.env.PORT || 4310),
  host: process.env.HOST || '127.0.0.1',
  trustProxy: process.env.TRUST_PROXY === '1',
});
console.log(`OpenGames match server on port ${server.port}`);
