#!/bin/sh
set -eu

image=${1:-}
[ -n "$image" ] || exit 2

container_name=repkey-provider-redis-ci
fixture_dir=$(mktemp -d)
cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
  rm -rf "$fixture_dir"
}
trap cleanup EXIT INT TERM

openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
  -subj '/CN=google-provider-redis.railway.internal' \
  -addext 'subjectAltName=DNS:google-provider-redis.railway.internal' \
  -keyout "$fixture_dir/server-key.pem" \
  -out "$fixture_dir/server.pem" >/dev/null 2>&1

username=provider_ci
password=provider_ci_password_0123456789abcdef
url="rediss://${username}:${password}@google-provider-redis.railway.internal:6380"
release_sha=$(docker image inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')
docker run -d --name "$container_name" \
  --env "PROVIDER_EPHEMERAL_REDIS_URL=$url" \
  --env "PROVIDER_REDIS_TLS_CA_PEM=$(cat "$fixture_dir/server.pem")" \
  --env "PROVIDER_REDIS_TLS_CERT_PEM=$(cat "$fixture_dir/server.pem")" \
  --env "PROVIDER_REDIS_TLS_KEY_PEM=$(cat "$fixture_dir/server-key.pem")" \
  --env "RELEASE_SHA=$release_sha" \
  --env 'RELEASE_MANIFEST_SHA256=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' \
  "$image" >/dev/null

attempt=0
until docker exec "$container_name" redis-cli --tls --insecure --user "$username" \
  --pass "$password" -p 6380 ping 2>/dev/null | grep -qx PONG; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 30 ] || {
    docker logs "$container_name"
    exit 1
  }
  sleep 1
done

server_uid=$(docker exec "$container_name" sh -c "awk '/^Uid:/ {print \$2}' /proc/1/status")
redis_uid=$(docker exec "$container_name" id -u redis)
[ "$server_uid" = "$redis_uid" ]

whoami=$(docker exec "$container_name" redis-cli --tls --insecure \
  --user "$username" --pass "$password" -p 6380 --raw ACL WHOAMI 2>/dev/null)
[ "$whoami" = "$username" ]

config=$(docker exec "$container_name" redis-cli --tls --insecure \
  --user "$username" --pass "$password" -p 6380 --raw \
  CONFIG GET appendonly save maxmemory maxmemory-policy 2>/dev/null)
printf '%s\n' "$config" | grep -qx no
printf '%s\n' "$config" | grep -qx 268435456
printf '%s\n' "$config" | grep -qx noeviction

dryrun=$(docker exec "$container_name" redis-cli --tls --insecure \
  --user "$username" --pass "$password" -p 6380 --raw \
  ACL DRYRUN "$username" SAVE 2>/dev/null)
printf '%s\n' "$dryrun" | grep -qv '^OK$'

client_kill_dryrun=$(docker exec "$container_name" redis-cli --tls --insecure \
  --user "$username" --pass "$password" -p 6380 --raw \
  ACL DRYRUN "$username" CLIENT KILL TYPE NORMAL SKIPME YES 2>/dev/null)
printf '%s\n' "$client_kill_dryrun" | grep -qv '^OK$'
