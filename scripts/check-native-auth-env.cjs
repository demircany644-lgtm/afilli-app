const { isIP } = require('node:net');

// Validate names/shape only. Never log, persist or copy environment values.
function validateNativeAuthEnvironment(env) {
  const problems = [];
  const key = env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim();
  if (!key) {
    problems.push('EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY is missing. Configure the matching Clerk publishable key in the Expo build environment; Replit workspace secrets are not automatically available to an external build.');
  } else {
    const match = /^pk_(test|live)_([A-Za-z0-9_-]+={0,2})$/.exec(key);
    const decoded = match ? Buffer.from(match[2], 'base64').toString('utf8') : '';
    const host = decoded.endsWith('$') ? decoded.slice(0, -1) : '';
    if (key !== env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY || !match || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(host)) {
      problems.push('EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY is invalid. Use a Clerk publishable key, never a secret key.');
    } else if (env.EAS_BUILD_PROFILE === 'production' && match[1] !== 'live') {
      problems.push('The production build requires the matching production Clerk publishable key, not a development key.');
    }
  }
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
