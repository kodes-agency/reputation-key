export const ACQUIRE_QUOTA_SCRIPT = `-- google-quota-v2
local nowMs = tonumber(ARGV[1])
local cost = tonumber(ARGV[2])
local states = {}
local allowed = 1
local advice = 0
for index = 1, #KEYS do
  local offset = 2 + ((index - 1) * 5)
  local binding = ARGV[offset + 1]
  local capacity = tonumber(ARGV[offset + 2])
  local refillPerMs = tonumber(ARGV[offset + 3])
  local ttlMs = tonumber(ARGV[offset + 4])
  local bucketCost = tonumber(ARGV[offset + 5])
  local storedBinding = redis.call('HGET', KEYS[index], 'binding')
  if storedBinding and storedBinding ~= binding then return {-2, 0} end
  local tokens = tonumber(redis.call('HGET', KEYS[index], 'tokens')) or capacity
  local updatedAtMs = tonumber(redis.call('HGET', KEYS[index], 'updatedAtMs')) or nowMs
  if nowMs > updatedAtMs then
    tokens = math.min(capacity, tokens + ((nowMs - updatedAtMs) * refillPerMs))
  end
  if tokens < bucketCost then
    allowed = 0
    advice = math.max(advice, math.ceil((bucketCost - tokens) / refillPerMs))
  end
  states[index] = {binding, tokens, ttlMs, bucketCost}
end
local remaining = nil
for index = 1, #KEYS do
  local state = states[index]
  local tokens = state[2]
  if allowed == 1 then tokens = tokens - state[4] end
  redis.call(
    'HSET',
    KEYS[index],
    'binding', state[1],
    'tokens', tokens,
    'updatedAtMs', nowMs
  )
  redis.call('PEXPIRE', KEYS[index], state[3])
  if remaining == nil or tokens < remaining then remaining = tokens end
end
if allowed == 1 then return {1, math.floor(remaining or 0)} end
return {0, advice}
`

export const REFUND_QUOTA_SCRIPT = `-- google-quota-refund-v1
local nowMs = tonumber(ARGV[1])
local states = {}
for index = 1, #KEYS do
  local offset = 1 + ((index - 1) * 5)
  local binding = ARGV[offset + 1]
  local capacity = tonumber(ARGV[offset + 2])
  local refillPerMs = tonumber(ARGV[offset + 3])
  local storedBinding = redis.call('HGET', KEYS[index], 'binding')
  if storedBinding and storedBinding ~= binding then return 0 end
  local tokens = tonumber(redis.call('HGET', KEYS[index], 'tokens')) or capacity
  local updatedAtMs = tonumber(redis.call('HGET', KEYS[index], 'updatedAtMs')) or nowMs
  tokens = math.min(capacity, tokens + (math.max(0, nowMs - updatedAtMs) * refillPerMs)
    + tonumber(ARGV[offset + 5]))
  states[index] = {binding, tokens, ARGV[offset + 4]}
end
for index = 1, #KEYS do
  local state = states[index]
  redis.call('HSET', KEYS[index], 'binding', state[1], 'tokens', state[2], 'updatedAtMs', nowMs)
  redis.call('PEXPIRE', KEYS[index], state[3])
end
return 1
`

export const ACQUIRE_IN_FLIGHT_SCRIPT = `-- google-inflight-acquire-v1
local binding = redis.call('GET', KEYS[1])
if binding and binding ~= ARGV[1] then return {-2, 0} end
local nowMs = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local leaseMs = tonumber(ARGV[4])
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', nowMs)
local count = redis.call('ZCARD', KEYS[2])
if count >= limit then
  local oldest = redis.call('ZRANGE', KEYS[2], 0, 0, 'WITHSCORES')
  local retryAfterMs = 1
  if oldest[2] then retryAfterMs = math.max(1, tonumber(oldest[2]) - nowMs) end
  return {0, retryAfterMs}
end
redis.call('SET', KEYS[1], ARGV[1], 'PX', leaseMs * 2)
redis.call('ZADD', KEYS[2], nowMs + leaseMs, ARGV[5])
redis.call('PEXPIRE', KEYS[2], leaseMs * 2)
return {1, nowMs + leaseMs}
`

export const RELEASE_IN_FLIGHT_SCRIPT = `-- google-inflight-release-v1
local binding = redis.call('GET', KEYS[1])
if not binding then return 0 end
if binding ~= ARGV[1] then return -2 end
return redis.call('ZREM', KEYS[2], ARGV[2])
`
