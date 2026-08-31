#!/bin/sh
set -eu

fail() {
  printf '%s\n' "provider_redis_configuration_refused" >&2
  exit 1
}

url=${PROVIDER_EPHEMERAL_REDIS_URL:-}
ca_pem=${PROVIDER_REDIS_TLS_CA_PEM:-}
cert_pem=${PROVIDER_REDIS_TLS_CERT_PEM:-}
key_pem=${PROVIDER_REDIS_TLS_KEY_PEM:-}
release_sha=${RELEASE_SHA:-}
image_sha=${IMAGE_SOURCE_REVISION:-}
manifest_sha=${RELEASE_MANIFEST_SHA256:-}

case "$release_sha" in ''|*[!a-f0-9]*) fail ;; esac
case "$image_sha" in ''|*[!a-f0-9]*) fail ;; esac
case "$manifest_sha" in ''|*[!a-f0-9]*) fail ;; esac
[ "${#release_sha}" -eq 40 ] && [ "$release_sha" = "$image_sha" ] || fail
[ "${#manifest_sha}" -eq 64 ] || fail

case "$url" in
  rediss://*@google-provider-redis.railway.internal:6380) ;;
  *) fail ;;
esac

authority=${url#rediss://}
credentials=${authority%%@*}
endpoint=${authority#*@}
username=${credentials%%:*}
password=${credentials#*:}

[ "$credentials" != "$authority" ] || fail
[ "$username" != "$credentials" ] || fail
[ "$endpoint" = 'google-provider-redis.railway.internal:6380' ] || fail
case "$username" in
  ''|*[!A-Za-z0-9_-]*) fail ;;
esac
case "$password" in
  ''|*[!A-Za-z0-9_-]*) fail ;;
esac
[ "${#password}" -ge 32 ] || fail
[ -n "$ca_pem" ] && [ -n "$cert_pem" ] && [ -n "$key_pem" ] || fail

runtime_dir=/tmp/repkey-provider-redis
rm -rf "$runtime_dir"
mkdir -m 0700 "$runtime_dir"
umask 077
printf '%s' "$ca_pem" > "$runtime_dir/ca.pem"
printf '%s' "$cert_pem" > "$runtime_dir/server.pem"
printf '%s' "$key_pem" > "$runtime_dir/server-key.pem"

password_sha256=$(printf '%s' "$password" | sha256sum | cut -d ' ' -f 1)
{
  printf '%s\n' 'user default off'
  printf 'user %s on #%s ~provider-ephemeral:* ~google-provider:* ~oauth-callback:* ~google-admission:* ' "$username" "$password_sha256"
  printf '%s\n' '+@read +@write +@scripting +auth +hello +ping +echo +quit +select +info -@dangerous +config|get +acl|whoami +acl|dryrun -client -save -bgsave -bgrewriteaof -config|set -module|load -function|load -migrate -dump -restore -replicaof -slaveof -sync -psync -shutdown -flushall -flushdb -keys'
} > "$runtime_dir/users.acl"

chown -R redis:redis "$runtime_dir"
unset PROVIDER_EPHEMERAL_REDIS_URL PROVIDER_REDIS_TLS_CA_PEM
unset PROVIDER_REDIS_TLS_CERT_PEM PROVIDER_REDIS_TLS_KEY_PEM
unset RELEASE_SHA RELEASE_MANIFEST_SHA256 IMAGE_SOURCE_REVISION

exec /usr/local/bin/docker-entrypoint.sh redis-server \
  --port 0 \
  --tls-port 6380 \
  --bind 0.0.0.0 :: \
  --protected-mode yes \
  --tls-cert-file "$runtime_dir/server.pem" \
  --tls-key-file "$runtime_dir/server-key.pem" \
  --tls-ca-cert-file "$runtime_dir/ca.pem" \
  --tls-auth-clients no \
  --aclfile "$runtime_dir/users.acl" \
  --appendonly no \
  --save '' \
  --maxmemory 268435456 \
  --maxmemory-policy noeviction \
  --dir "$runtime_dir"
