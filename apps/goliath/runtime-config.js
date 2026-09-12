const developmentOrigins = Object.freeze([
  'http://localhost:3000',
  'http://127.0.0.1:3000'
]);

export function resolveRuntimeConfig(origin = globalThis.location?.origin ?? developmentOrigins[0]) {
  return Object.freeze({
    environment: 'development',
    deploymentMode: 'local-only',
    origin,
    originAllowed: developmentOrigins.includes(origin),
    allowedOrigins: developmentOrigins,
    authUrl: 'https://ep-ancient-night-au3h4qqm.neonauth.c-10.us-east-1.aws.neon.tech/edapos/auth',
    dataApiUrl: 'https://ep-ancient-night-au3h4qqm.apirest.c-10.us-east-1.aws.neon.tech/edapos/rest/v1',
    label: 'Local development · Neon goliath-development'
  });
}

export const runtimeConfig = resolveRuntimeConfig();
