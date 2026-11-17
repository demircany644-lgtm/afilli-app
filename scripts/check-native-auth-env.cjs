const { isIP } = require('node:net');

// Validate names/shape only. Never log, persist or copy environment values.
function validateNativeAuthEnvironment(env) {
  const problems = [];
  const domain = env.EXPO_PUBLIC_DOMAIN?.trim();
  if (!domain) {
    problems.push('EXPO_PUBLIC_DOMAIN is missing. Set the published API hostname without https:// or a path.');
  } else {
    try {
      const url = new URL(`https://${domain}`);
      if (domain !== env.EXPO_PUBLIC_DOMAIN || url.hostname !== domain || url.username || url.password || url.port
        || !domain.includes('.') || isIP(domain)) throw new Error('Invalid API hostname');
    } catch {
      problems.push('EXPO_PUBLIC_DOMAIN must be a published API hostname without a scheme, path, credentials or port.');
    }
  }
  return problems;
}

module.exports = { validateNativeAuthEnvironment };

if (require.main === module) {
  const problems = validateNativeAuthEnvironment(process.env);
  if (problems.length) {
    console.error('Android/iOS authentication configuration is incomplete:');
    for (const problem of problems) console.error(`- ${problem}`);
    console.error('No environment values were printed. Correct the build environment before rebuilding.');
    process.exitCode = 1;
  } else {
    console.log('Native authentication build variables passed validation (values hidden).');
  }
}
