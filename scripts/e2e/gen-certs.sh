#!/bin/sh
# Run-scoped local CA for the Google provider sandbox. ADR 0050: the
# local-sandbox profile accepts only exact TLS origins and never disables
# verification, so the stub serves TLS and every client trusts this CA
# (containers through NODE_EXTRA_CA_CERTS=/run/repkey/ca.crt, host Playwright
# through the same variable set by local-stack-playwright-env.ts).
set -eu

dir=e2e/.certs
rm -rf "$dir"
mkdir -p "$dir"
openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj /CN=repkey-local-provider-ca \
  -keyout "$dir/ca.key" -out "$dir/ca.crt" 2>/dev/null
openssl req -newkey rsa:2048 -nodes -subj /CN=provider-sandbox \
  -keyout "$dir/provider-sandbox.key" -out "$dir/provider-sandbox.csr" 2>/dev/null
printf 'subjectAltName=DNS:provider-sandbox,DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n' \
  > "$dir/provider-sandbox.ext"
openssl x509 -req -days 30 -sha256 -in "$dir/provider-sandbox.csr" \
  -CA "$dir/ca.crt" -CAkey "$dir/ca.key" -CAcreateserial \
  -extfile "$dir/provider-sandbox.ext" -out "$dir/provider-sandbox.crt" 2>/dev/null
# Disposable test material read by the containers' unprivileged `node` user.
chmod 644 "$dir"/*
