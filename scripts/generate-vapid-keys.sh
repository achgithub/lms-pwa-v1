#!/bin/bash
# Generate VAPID keys for Web Push.
# Run once, then paste the output into the Cloudflare Pages dashboard as encrypted secrets.
# Usage: ./scripts/generate-vapid-keys.sh

docker run --rm node:20-alpine node -e "
(async () => {
  const { subtle } = globalThis.crypto;

  function b64url(bytes) {
    const binary = String.fromCharCode(...bytes);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  const pair = await subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );

  const pubRaw  = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));
  const privJwk = await subtle.exportKey('jwk', pair.privateKey);

  console.log('');
  console.log('VAPID_PUBLIC_KEY=' + b64url(pubRaw));
  console.log('VAPID_PRIVATE_KEY_JWK=' + JSON.stringify(privJwk));
  console.log('');
  console.log('Paste both as encrypted secrets in the Cloudflare Pages dashboard.');
})();
"
