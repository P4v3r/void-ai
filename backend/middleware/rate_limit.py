"""Redis Lua scripts for atomic rate limiting."""

# Atomically increments the request counter for rate limiting within a time window.
# Returns {remaining_requests, ttl} or {-1, ttl} if rate limited.
RL_LUA = """
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[2])
end
local ttl = redis.call('TTL', KEYS[1])
local maxv = tonumber(ARGV[1])
if current > maxv then
  return {-1, ttl}
end
return {maxv - current, ttl}
"""
