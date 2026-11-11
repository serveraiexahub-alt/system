
getfenv = nil; _ENV = nil
getgenv = function() return _G end
local real = loadstring
local cap = {}
loadstring = function(s, c) cap[#cap + 1] = s; return real(s, c) end
_G.loadstring = loadstring
local f = assert(real(io.open(arg[1], 'r'):read('*a'), 'o'))
pcall(f)
local h = io.open(arg[2], 'w'); h:write(cap[#cap]); h:close()
