-- runs an obfuscated file under a Luau-like environment:
-- no getfenv, no _ENV, getgenv present (executor style)
getfenv = nil
_ENV = nil
getgenv = function() return _G end
local f = assert(loadstring(io.open(arg[1], 'r'):read('*a'), 'o'))
local ok, e = pcall(f)
if not ok then io.stderr:write('ERR:', tostring(e):sub(1, 160), '\n') end
