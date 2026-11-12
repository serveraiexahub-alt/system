-- Roblox-like mock that records what the script builds
local CREATED = {}
local createdCount = 0

local function num(v) if type(v) == 'number' then return v end if type(v)=='table' then return v.X or v.Scale or 0 end return 0 end

local V2 = {}
V2.__index = V2
V2.__add = function(a,b) return setmetatable({X=num(a)+num(b), Y=num(a)+num(b)}, V2) end
V2.__sub = function(a,b) return setmetatable({X=num(a)-num(b), Y=num(a)-num(b)}, V2) end
V2.__mul = function(a,b) return setmetatable({X=num(a)*num(b), Y=num(a)*num(b)}, V2) end
V2.__eq = function() return false end

local U2 = {}
U2.__index = U2
U2.__add = function(a,b) return setmetatable({X={Scale=0,Offset=0}, Y={Scale=0,Offset=0}}, U2) end
U2.__sub = function(a,b) return setmetatable({X={Scale=0,Offset=0}, Y={Scale=0,Offset=0}}, U2) end

local function newV2(x,y) return setmetatable({X=x or 0, Y=y or 0}, V2) end
local function newU2(sx,ox,sy,oy)
  return setmetatable({X={Scale=sx or 0, Offset=ox or 0}, Y={Scale=sy or 0, Offset=oy or 0}}, U2)
end

local SIGNAL = {}
SIGNAL.__index = SIGNAL
SIGNAL.Connect = function(self, f)
  self.handlers[#self.handlers+1] = f
  return {Disconnect = function() end, disconnect = function() end}
end
SIGNAL.connect = SIGNAL.Connect
local function newSignal() return setmetatable({handlers={}}, SIGNAL) end

local ALLCLASSES = {}
__ALLCLASSES = ALLCLASSES
local INST = {}
INST.__index = function(t, k)
  local own = rawget(t, k)
  if own ~= nil then return own end
  local raw = rawget(t, '_props')
  if raw and raw[k] ~= nil then return raw[k] end
  local m = INST.methods[k]
  if m then return m end
  if INST.eventNames[k] then
    local sig = newSignal()
    rawget(t, '_props')[k] = sig
    return sig
  end
  -- default property values
  if k == 'Name' then return 'Obj' end
  if k == 'ClassName' then return 'Frame' end
  if k == 'AbsoluteSize' or k == 'AbsolutePosition' then return newV2(0,0) end
  if k == 'Position' then return newU2(0,0,0,0) end
  if k == 'Size' then return newU2(0,0,0,0) end
  return nil
end
INST.__newindex = function(t, k, v)
  rawset(t, '_props', rawget(t, '_props') or {})
  rawget(t, '_props')[k] = v
  if k == 'Parent' then rawset(t, '_parent', v) end
end
INST.eventNames = {
  ['Activated']=true,
  ['Changed']=true,
  ['CharacterAdded']=true,
  ['Chatted']=true,
  ['ChildAdded']=true,
  ['Destroying']=true,
  ['Heartbeat']=true,
  ['InputBegan']=true,
  ['InputChanged']=true,
  ['InputEnded']=true,
  ['JumpRequest']=true,
  ['MessageReceived']=true,
  ['MouseButton1Click']=true,
  ['MouseEnter']=true,
  ['MouseLeave']=true,
  ['PlayerAdded']=true,
  ['PlayerRemoving']=true,
  ['RenderStepped']=true,
  ['Stepped']=true,
  ['MouseButton1Down']=true,
  ['MouseButton1Up']=true,
  ['MouseEnter']=true,
  ['FocusLost']=true,
  ['FocusGained']=true,
  ['AncestryChanged']=true,
  ['DescendantAdded']=true,
  ['Touched']=true,
  ['TouchEnded']=true,
  ['Died']=true,
  ['TextChanged']=true,
  ['GetPropertyChangedSignal']=true,
  ['Completed']=true,
  ['MouseMoved']=true,
}
INST.methods = {
  Destroy = function(self)
    -- Roblox Destroy removes descendants too
    for _, e in ipairs(ALLCLASSES) do
      local o = e.obj
      local p2 = o and rawget(o, '_parent')
      while p2 do
        if p2 == self then o._destroyed = true break end
        p2 = rawget(p2, '_parent')
      end
    end
    rawset(self, '_destroyed', true)
  end,
  Remove = function(self) rawset(self, '_destroyed', true) end,
  FindFirstChild = function(self, name) return nil end,
  FindFirstChildOfClass = function(self, cls) return nil end,
  GetChildren = function(self) return {} end,
  GetDescendants = function(self) return {} end,
  IsA = function(self, cls) return cls == 'Frame' or cls == 'Instance' end,
  Clone = function(self) return newInstance('Frame') end,
  TweenSize = function(self) return nil end,
  TweenPosition = function(self) return nil end,
  GetPropertyChangedSignal = function(self) return newSignal() end,
  WaitForChild = function(self, name) return newInstance('Frame') end,
  SetAttribute = function(self) end,
  GetAttribute = function(self) return nil end,
  ClearAllChildren = function(self) end,
  GetPlayers = function(self) return {} end,
  GetPlayerFromCharacter = function(self) return nil end,
  GetRankInGroup = function(self) return 0 end,
  IsInGroup = function(self) return false end,
  Kick = function(self) end,
  GetMouse = function(self) return newInstance('Mouse') end,
  GetBoundingBox = function(self) return newV2(0,0), newV2(0,0) end,
  PivotTo = function(self) end,
  GetPivot = function(self) return {} end,
  MoveTo = function(self) end,
  BreakJoints = function(self) end,
  TakeDamage = function(self) end,
}
INST.__tostring = function() return 'Instance' end
local function newInstance(class)
  createdCount = createdCount + 1
  ALLCLASSES[#ALLCLASSES+1] = { class = tostring(class), obj = nil }
  local o = setmetatable({_props = {}, ClassName = class}, INST)
  ALLCLASSES[#ALLCLASSES].obj = o
  if class == 'ScreenGui' or class == 'TextLabel' or class == 'Frame' or class == 'ImageLabel' then
    CREATED[#CREATED+1] = class
  end
  return o
end

__CREATED = CREATED
__createdCount = function() return createdCount end

-- Services
local SERVICE_CACHE = {}
local function service(name)
  if SERVICE_CACHE[name] then return SERVICE_CACHE[name] end
  local svc
  svc = (function()
  if name == 'Players' then
    local lp = newInstance('Player')
    lp._props.Name = 'Tester'
    lp._props.UserId = 1
    lp._props.DisplayName = 'Tester'
    lp._props.AccountAge = 100
    lp._props.Character = newInstance('Model')
    lp._props.PlayerGui = newInstance('PlayerGui')
    return setmetatable({_props={LocalPlayer=lp}, ClassName='Players'}, INST)
  end
  if name == 'RunService' then
    return {RenderStepped=newSignal(), Heartbeat=newSignal(), Stepped=newSignal(),
            IsStudio=function() return false end, IsClient=function() return true end}
  end
  if name == 'UserInputService' then
    return {InputBegan=newSignal(), InputEnded=newSignal(), InputChanged=newSignal(),
            JumpRequest=newSignal(), TouchStarted=newSignal(), TouchEnded=newSignal(),
            GetFocusedTextBox=function() return nil end,
            GetMouseLocation=function() return newV2(0,0) end,
            IsKeyDown=function() return false end,
            GetKeysPressed=function() return {} end}
  end
  if name == 'TweenService' then
    return {Create=function(self,obj,info,props) return {Play=function() end, Cancel=function() end, Completed=newSignal()} end}
  end
  if name == 'MarketplaceService' then return {GetProductInfo=function() return {} end} end
  if name == 'CoreGui' then return newInstance('CoreGui') end
  if name == 'HttpService' then return {JSONEncode=function(self,v) return '{}' end, JSONDecode=function(self,s) return {} end, GenerateGUID=function() return 'x' end} end
  if name == 'Lighting' then return newInstance('Lighting') end
  if name == 'ContentProvider' then return {PreloadAsync=function() end} end
  return newInstance(name)
  end)()
  SERVICE_CACHE[name] = svc
  return svc
end

-- Executor-style environment: getgenv() returns a writable table whose reads
-- fall through to the real environment (getfenv()), because in Luau _G is a
-- sandbox table rather than the globals.
local REALENV = getfenv()
local ENV = setmetatable({}, { __index = REALENV })
G = ENV
getgenv = function() return ENV end
game = setmetatable({GetService=function(self, n) return service(n) end, HttpGet=function() return '' end,
        Players=newInstance('Players'), PlaceId=0, JobId='x'},
        {__index=function(t,k) if k=='Name' then return 'Murder Mystery 2' end return nil end})
workspace = newInstance('Workspace')
Instance = {new=function(cls) return newInstance(cls) end}
Color3 = {fromRGB=function(r,g,b) return {R=r,G=g,B=b} end, new=function(r,g,b) return {R=r,G=g,B=b} end,
          fromHSV=function() return {} end}
Vector2 = {new=newV2, zero=newV2(0,0)}
Vector3 = {new=function(x,y,z) return {X=x or 0,Y=y or 0,Z=z or 0} end, zero={X=0,Y=0,Z=0}}
UDim = {new=function(s,o) return {Scale=s or 0, Offset=o or 0} end}
UDim2 = {new=newU2, fromScale=function(sx,sy) return newU2(sx,0,sy,0) end, fromOffset=function(ox,oy) return newU2(0,ox,0,oy) end}
CFrame = {new=function() return {} end}
Enum = setmetatable({}, {__index=function(t,k)
  return setmetatable({}, {__index=function(_,kk) return {Name=kk, Value=0} end})
end})
TweenInfo = {new=function() return {} end}
task = {spawn=function(f, ...) __spawned = (__spawned or 0) + 1 end,
        wait=function() return 0 end, delay=function() end, defer=function(f) end,
        cancel=function() end}
warn = function(msg) __warns = (__warns or {}); table.insert(_G.__warns, tostring(msg)) end
readfile = function() return nil end
writefile = function() end
isfile = function() return false end
gethui = function() return newInstance('CoreGui') end
request = function() return {Success=false, StatusCode=0, Body=''} end
syn = nil
setclipboard = function() end
typeof = type
tick = os.time
time = os.time

wait = function() return 0 end
spawn = function(f) __spawned = (__spawned or 0) + 1 end
delay = function(_, f) end
