// Runs before each test file is imported. Provides the one required env var
// that has no default (API_AUTH_TOKEN), so importing modules that eagerly load
// config at import time (via logger -> env.loadEnv) don't process.exit under test.
process.env.API_AUTH_TOKEN ||= "test-auth-token-0000";
