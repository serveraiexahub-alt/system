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
warn = function(msg) __warns = __warns or {}; __warns[#__warns + 1] = tostring(msg) end
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


-- deep snapshot of everything the script built, for differential testing
local function __ser(v)
  local t = type(v)
  if t == 'string' or t == 'number' or t == 'boolean' then return tostring(v) end
  if t ~= 'table' then return t end
  if v.X ~= nil then
    local x, y = v.X, v.Y
    local function part(n)
      if type(n) == 'table' then return tostring(n.Scale) .. ':' .. tostring(n.Offset) end
      return tostring(n)
    end
    return part(x) .. '/' .. part(y)
  end
  if v.R ~= nil then return tostring(v.R) .. ',' .. tostring(v.G) .. ',' .. tostring(v.B) end
  return '{t}'
end

local function __isProgress(o)
  local cur = o
  while cur do
    local n = rawget(cur, '_props') and rawget(cur, '_props').Name
    if type(n) == 'string' and (n:sub(1, 11) == 'pgoverlay_' or n:sub(1, 2) == '\0q') then return true end
    cur = rawget(cur, '_parent')
  end
  return false
end

function __snapshot()
  local parts = {}
  for i, e in ipairs(__ALLCLASSES) do
    local o = e.obj
    if o and not o._destroyed and not __isProgress(o) then
      local props = {}
      local raw = rawget(o, '_props')
      for k, v in pairs(raw or {}) do
        if k ~= 'Parent' and type(v) ~= 'function' then
          local okp, sv = pcall(__ser, v)
          if okp then props[#props+1] = k .. '=' .. sv end
        end
      end
      table.sort(props)
      local par = rawget(o, '_parent')
      local pname = '-'
      if type(par) == 'table' then
        local pp = rawget(par, '_props') or {}
        pname = tostring(pp.Name or '?')
      end
      parts[#parts+1] = e.class .. '<' .. pname .. '>' .. table.concat(props, ',')
    end
  end
  table.sort(parts)
  print('SNAP ' .. tostring(#parts))
  for _, l in ipairs(parts) do print(l) end
end

local __ok, __err = pcall(function()
-- สกัด HUB · build v2.3 · L1 · 1 ชั้น

local _PG,_PL,_PGV,_PGD=false
pcall(function()
  local host=game:GetService("CoreGui")
  local sg=Instance.new("ScreenGui")
  sg.Name="pgoverlay_"..tostring(math.random(1,9999999))
  sg.IgnoreGuiInset=true
  sg.ResetOnSpawn=false
  sg.DisplayOrder=2147483647
  local lb=Instance.new("TextLabel")
  lb.Size=UDim2.new(0,104,0,22)
  lb.Position=UDim2.new(1,-112,0,8)
  lb.BackgroundColor3=Color3.fromRGB(18,18,18)
  lb.BackgroundTransparency=0.25
  lb.TextColor3=Color3.fromRGB(255,255,255)
  lb.Font=Enum.Font.GothamBold
  lb.TextSize=13
  lb.Text="L1 0%"
  lb.Parent=sg
  sg.Parent=host
  _PG,_PL=sg,lb
  if task and task.delay then
    task.delay(30,function()
      pcall(function()
        if _PGD then return end
        local stuck=_PGV or 0
        if _PG then pcall(function() _PG:Destroy() end) end
        _PG,_PL=nil,nil
        if stuck<99 then
          local m="[obf] v2.3 L1 ค้างที่ "..tostring(stuck).."% — ถอดรหัสไม่จบ สคริปต์ไม่ทำงาน"
          if warn then pcall(warn,m) end
          if __pgn then pcall(__pgn,m) end
        end
      end)
    end)
  end
end)
pcall(function()
  __pg=function(p)
    if _PGD or not _PL then return end
    if p>100 then p=100 end
    if p<0 then p=0 end
    if not _PGV or p>_PGV then _PGV=p end
    pcall(function() _PL.Text="L1 "..tostring(_PGV).."%" end)
  end
  __pgy=function()
    local t=task
    if t and t.wait then pcall(t.wait,0) elseif wait then pcall(wait,0) end
  end
  __pgd=function()
    _PGD=true
    if _PG then pcall(function() _PG:Destroy() end) _PG=nil _PL=nil end
  end
  __pgn=function(m)
    pcall(function()
      local hostN=game:GetService("CoreGui")
      local sgN=Instance.new("ScreenGui")
      sgN.Name="pgnotice_"..tostring(math.random(1,9999999))
      sgN.IgnoreGuiInset=true
      sgN.DisplayOrder=2147483647
      local lbN=Instance.new("TextLabel")
      lbN.Size=UDim2.new(0,430,0,56)
      lbN.Position=UDim2.new(0.5,-215,0,8)
      lbN.BackgroundColor3=Color3.fromRGB(160,25,25)
      lbN.BackgroundTransparency=0.12
      lbN.TextColor3=Color3.fromRGB(255,255,255)
      lbN.Font=Enum.Font.GothamBold
      lbN.TextSize=14
      lbN.TextWrapped=true
      lbN.Text=m
      lbN.Parent=sgN
      sgN.Parent=hostN
      if task and task.delay then task.delay(12,function() pcall(function() sgN:Destroy() end) end) end
    end)
  end
end)
if print then pcall(print,"[obf] build v2.3 L1/1 ชั้น") end
do local function aYC(ahb,aYi) local aMr=(ahb or 1)*(aYi or 1) local aS=0 while aMr>0 do aS=aS+(aMr%2) aMr=math.floor(aMr/2) end return aS end local function aR(am) local aV={am or 1,2,3,5,8,13} local arK=0 for at=1,#aV do arK=arK+aV[at]*at end return arK%1000 end local function aj(aKJ,aT) local ah=0 for aam=1,(aKJ or 1) do ah=(ah+(((aam*(aT or 3))%251)+7))%65521 end local aF={ah,(aKJ or 2)+(aT or 4)} return aF[1]%(aF[2]+1) end local function ahK(ab) local aHa={} for aM=1,(ab or 4) do aHa[aM]=string.char(((aM*37)%90)+33) end local axo=table.concat(aHa) local aY=#axo return aY%(ab or 5) end local function aAf(aHQ) local aO={aHQ or 1,2,3,5,8,13} local aIi=0 for aC=1,#aO do aIi=aIi+aO[aC]*aC end return aIi%1000 end local function au(avs,atd) local aMU=(avs or 1)*(atd or 1) local avG=0 while aMU>0 do avG=avG+(aMU%2) aMU=math.floor(aMU/2) end return avG end local function awO(aGd,aGa) local aZ=(aGd or 1)*(aGa or 1) local axN=0 while aZ>0 do axN=axN+(aZ%2) aZ=math.floor(aZ/2) end return axN end local function aaG(aPw,alK) local ain=0 for aqM=1,(aPw or 1) do ain=(ain+(((aqM*(alK or 3))%251)+7))%65521 end local aNg={ain,(aPw or 2)+(alK or 4)} return aNg[1]%(aNg[2]+1) end local function anH(aLj) local aL={} for aHs=1,(aLj or 4) do aL[aHs]=string.char(((aHs*37)%90)+33) end local aq=table.concat(aL) local aAY=#aq return aAY%(aLj or 5) end local function aEl(avb,alG) local ahV=0 for avl=1,(avb or 1) do ahV=(ahV+(((avl*(alG or 3))%251)+7))%65521 end local anX={ahV,(avb or 2)+(alG or 4)} return anX[1]%(anX[2]+1) end local function aUo(aLs,ajP) local aQQ=(aLs or 1)*(ajP or 1) local azU=0 while aQQ>0 do azU=azU+(aQQ%2) aQQ=math.floor(aQQ/2) end return azU end local function aRs(aPg) local aXX={aPg or 1,2,3,5,8,13} local abo=0 for aRI=1,#aXX do abo=abo+aXX[aRI]*aRI end return abo%1000 end local function asA(aoR,aE) local ayl=0 for al=1,(aoR or 1) do ayl=(ayl+(((al*(aE or 3))%251)+7))%65521 end local aI={ayl,(aoR or 2)+(aE or 4)} return aI[1]%(aI[2]+1) end local function aGC(aGe,act) local ae=(aGe or 1)*(act or 1) local apY=0 while ae>0 do apY=apY+(ae%2) ae=math.floor(ae/2) end return apY end local function aCv(aFo,agx) local adK=0 for aAF=1,(aFo or 1) do adK=(adK+(((aAF*(agx or 3))%251)+7))%65521 end local aK={adK,(aFo or 2)+(agx or 4)} return aK[1]%(aK[2]+1) end local function aHp(aMq,aW) local ai=(aMq or 1)*(aW or 1) local ayR=0 while ai>0 do ayR=ayR+(ai%2) ai=math.floor(ai/2) end return ayR end local function acu(aTr) local aBw={} for aEC=1,(aTr or 4) do aBw[aEC]=string.char(((aEC*37)%90)+33) end local aP=table.concat(aBw) local akf=#aP return akf%(aTr or 5) end local function asN(aNz,atl) local aMP=(aNz or 1)*(atl or 1) local avN=0 while aMP>0 do avN=avN+(aMP%2) aMP=math.floor(aMP/2) end return avN end local function aAd(ayV) local anJ={ayV or 1,2,3,5,8,13} local aEZ=0 for ayi=1,#anJ do aEZ=aEZ+anJ[ayi]*ayi end return aEZ%1000 end local function aAI(aHD) local alU={} for aFm=1,(aHD or 4) do alU[aFm]=string.char(((aFm*37)%90)+33) end local aHt=table.concat(alU) local ax=#aHt return ax%(aHD or 5) end local function atU(aPJ,asE) local aw=(aPJ or 1)*(asE or 1) local aVg=0 while aw>0 do aVg=aVg+(aw%2) aw=math.floor(aw/2) end return aVg end local function agC(aIq,akn) local ao=0 for aGI=1,(aIq or 1) do ao=(ao+(((aGI*(akn or 3))%251)+7))%65521 end local aOH={ao,(aIq or 2)+(akn or 4)} return aOH[1]%(aOH[2]+1) end local function aFS(aBy,akY) local apT=(aBy or 1)*(akY or 1) local aKH=0 while apT>0 do aKH=aKH+(apT%2) apT=math.floor(apT/2) end return aKH end local function aQ(aoi) local adB={} for aeD=1,(aoi or 4) do adB[aeD]=string.char(((aeD*37)%90)+33) end local aZL=table.concat(adB) local aHV=#aZL return aHV%(aoi or 5) end local function auF(abc) local aKC={abc or 1,2,3,5,8,13} local aJk=0 for aXO=1,#aKC do aJk=aJk+aKC[aXO]*aXO end return aJk%1000 end local function aoz(aod,atZ) local aBP=0 for aSk=1,(aod or 1) do aBP=(aBP+(((aSk*(atZ or 3))%251)+7))%65521 end local aed={aBP,(aod or 2)+(atZ or 4)} return aed[1]%(aed[2]+1) end local aOy=0 for ajI=1,0 do aOy=aOy+1 end if aOy>7 then aYC(34,39) aR(57,21) aj(33,86) ahK(4,85) aAf(14,81) au(32,91) awO(2,81) aaG(64,90) anH(72,68) aEl(26,31) aUo(16,19) aRs(55,39) asA(25,46) aGC(90,91) aCv(34,64) aHp(55,83) acu(28,62) asN(31,23) aAd(82,12) aAI(88,80) atU(10,31) agC(41,66) aFS(78,79) aQ(14,80) auF(3,20) aoz(43,6) end end local aAz=function() local CH={} for _i=0,255 do CH[_i]=string.char(_i) end if __pg then __pg(0) end local av="b2869ad036ce9fa5d22dc88c85d24aea984d7ef498633e2b7a06b3e5d101cb75526fb3dbc9afb4af4a08daae298b26b7073fa83ffa03df48d9bece064c99a596b21186493a474ff8c4b6bace662c191636b6765d54510ba2817476fcb08b7684f2a0755a45ca723e20108426efc8c420bc7f522bc134edbe9cfe8e450cf640ca7b3c0387e88e4e0f4cce7e553c46b05a2b0cf39718ddbeaa1ab87d524aa23af9c89d0c9e5020fa58e4975a40860cb97639b916b5743c8802a354285cd06b16c712800cba70aa12a1400224860fa847a3dc55f296be14911ecede2ea52cb9e02a901ca3a6ee6401ae7eae1eb55c0973ba3fec9ed438c35e1c3a981db24d82da4ce888acfe7700acb80477fa83a6ec4bd66476b61d942e2862c334abbcf03cb6323260b51aa28ab20160c5c4e61f88f2e0fc3f9208def4317ed1e1cef44ca4808abbfc602428538ecfcda7b50248120a2958aa5c4e6790bfab736eaade967c89a6e65d4c5e97e02f18233d9aee9db2ea49b84a3c6ec7309fa8d30c8afef61c69c64626468de4415b5177e4462c407bc6340210458ad5ddc1d4308054567fb814a7b2e0359a050a3163e0504466af0884607cbf126b5e7392fe51203476df58f4f02c8f027bb1c3018e0c0e3e95fc86709aeb4cb3d7d7027eeadaf83d920ae2fa3988ddefddf560ba98a4d71a80464c79b6f9d6d5da347c48426394e89c90abd607f5bfb1fa30ead2e10042e4c6cfe807c09b7ab2d6553a4271b012d4d6ff3877504b49a2db906198f27304b8cc209b26b7e22f7e2ac0da229110b2b4f65fd85793abe782060e44a10e9e8ebe157ce9131942cc3e0b3e94119e4e5eae25ac3960a9f19c2e4488f36e0c0a48ad229db2e91eb8383c6ec730bca8d4278af3191b3dc63426468de45e385293e43b2c3f4ec6220210458af2bac2f13075545551b802d0ccef22782e24416ea1915d469cd4907a8bacf09478839ebf9d572d7298421a19285aecbeb7c0cf7843063a4ee6ac9996b636f6ddd4d18b210bf4f67c300bf6047220f5dac54af1c8a09004a66f4844a03cffd2ab41b3773e1c7e0ec58c76c04afbbc83076718ce8fcc4efed5bcc630daab8c73f497673e2a9a38fdd2ca22ba79481daf1ddaa07ad86417dac0068c39f6b939953ff4bc088223d48bd036dca9866909854e240c7812d3a498ec803b06d742cf854a207a02b170529416bf7837b30bae62266ee4812efe2e9e35dc89d039c96c1e54b843de7faefe8e450cd940c9783c0e64e8934e2c6ae88d42fd75c96518d8f37418e3bebc1ab87d522da239f4c8a80c9e57200c58e4975a23a90bb376449616bd744e8802a3540b7fcf6416d2128015ba82aa12a140e5478507a85280dc5ff2a8be14911eb1012d9c2cc4e02a9b1cc09bee6401ae61ae1dab5c1450ba4becb0d438c35eff5d9712b25882da59e89aacfe77008fb8036bfa8ea6ec59d67676b61d94114b61b634b6bcf04bb6443260b51a85adb1f360d0c4e62f8804e0fc3f92eb01f3227edcbece054cb6808abbfc434727438edaaaa8cd025a120a29588d5c4d5690bf6a5a78bd128a627ab9085d4c5584ac58323344780ce0dbe6f7c566522b80f1c8c2e314681c102b568775354246ce84614e5ece7e553c29d34e18d81c8e27d09cc834c76a1379af36b2b2e0359a220a3281e04544589cd4907a8bacf09478839ebf7a494a3eb65c2906066606cda4811b8240f024860fa84774c25005ca95fa711ebcde2ea52cd6e02a9b1ca3e7f660ba98a4d71a80464c79b6f9d6c3ea009a62515072f4b69f989753d8bc8ee46813ceacea680dc27df535d66476b61d942e2862c334abbcda3882504c6fa2f8aea4c1ee21eec7e2e8722a09f80a7c2e07f0df68fcd496dc50eb96649200953ae54d790e8c8ebe157c06f01a6bcc33573e90ca887487aaf0967c89a6c9864b5a50ca724120228426efc8a720a06c1e54b843de9cba189d32cd253dc63426468de45e385293e43b4f226892401c1f3268fed4d1def19e4f5238a23af9c8ba0c9e5720ef58c484264ca01ba65462b025aa355a81fe5c3e4e85cc36000a3b7cc3c786c0da7844373a60e6ac999699360dcaa0fa8231f0d214963ff8b710a21caec40873ee8c8ac82da21d557fb604d6d6fd348e48426394cbbfa498a230eccfc2d84e04e1cec17111c288d24ae9986a9c0ea750ff48c634b6bcf04bb6443260b51a858ac3ee2ceedef51c6610fa0b2c533708f0ea6814e7cad036dca9866909953af02a9221c082a4068f28c7006acc3e3458a3fe7c5a78bd126d8587a6d486666d84be583233445b0cecc8b220bc7f52489e34f1be91fe9932d8025ad9681a2c7ef7800f388ee4462c407bc6340210458ad5bacbdef18054567fb814d0ccef225b512c2e3aa16e5e759ce6907a8bacd3b77f706ae894674a50b65c2906e9890cba70aa12a1400224860fa84780e14cbeb4d8237efcdaf83d92ed05fe265406e6ed043ed8b2b3c4dbaf634832a03cffd2c81eb4713e117e10b25882da59e89aacfe77008fb80564c6acc0fb46b48290c50a553a425e7c1eeee5ec16a06a5b5c6327c7a06fba4a08ede2fa722a09f8ed5cfcc5c9ec50e1ad93d036dca98669c65710f70e63e6946d7be0662c181619964424265ecf70443d881fb0897667d26e382d52ba4502e9228426ecc8a700893d2b388c02b887ae218e410cd920983c0a1a4fb6492c5b84f27a0306419a28e6e0085dddaecbe23db42b1c44910cb49aadfa63220a327ae045243b72de74485083db888174a9fe511e1c489f26eaddfc45e0a4a8ca0e4f0af50e5aca7a5b6fa12affcedd103fe8c5ce006001c9ceef6606e6e20421b8817a9ee8742d1a387f16f9d6f1347128122869d884656e9f24d2c0c8fa25caa8a2d632d19793b124c09c91b2cb5e2715347e07c2a9b516a06a4c5c63e49e7181bc35d6aeabfa722af9f8ed5c03c5c5ec51e2aa93d059dc988669c65913fe0e68e7917683e0892b0116199643212b5ed175483d881faf727667d274373352b94308e9228425d5c8a7008c43203e8b02a79cba178232cde22e983a0a194cb7492c5b83db7a03063a9e2ae6e6095fddaecbe126b42b1c46890db49fadfa63220a3163e045243771dd74474d82db885e7392fe511e234aa126eadefe45e0c7a7b30e4f0afb1254ca795e69a12affcdc6103fe8c6c6ff6005c9ccef6629e5cb0421b8827997e878341c2f9422efc2eaf57a370f2462e48c6061b453ebabc2bb2ed9a1a7ce3dcc9c85c630d9868c73d46a27132c850ac09bca22b953481d6ceb9a747cc734d9a3c0068b12f6b9f66402c6bef754e39da8ff4fc3964772d45a12f21465e78982c7056628c7e02d9e46182e6ad2674e5eadfbac394079db72303155b7370c0a4782229d92be0f8d3a23428af9bc7fdd177132cde230993c0a144cb9492c3883ca7a03063d9929e6e2035eddaea8e115b42b1c448e0cb4a0b0f963222d3152e045243b75db744e4f80db88357da1e1901514459f2ee4d7f953cb988ec3f08e01ee1455cf765d67ac15d08be113991eb1befc6a02c6cefb5fe5c0c4077aee6f6a97eb7c2a203e9001cadfed4db01f082767e4805d69a718b19a83076718ce8fca35d4988abc1dad616a73f497673e1f7a09c2acba0f8b371a258027c7b6aeaf2adbabbcea60fed0c10a9f2d09f0df48e3a5a2c01fb06e4f69da8f3d38404fd8957b90d050fcdddf36b6755d5451c871434e78e386523f84159f745a45aa4307f3126cf8b091c420bb7d522b7e08b6949ee85f09d5f640c9783c0344ba58281c51b94b140546d359270cf354eaa38cb8097d483c6fc636a792b1f5681cf9f72fbe915d6f9cc9704e4d85e084454a67dc51614d7ecc19e0dbfa4fd0907c93d76c01313d8dfc69506fac21c0a3aee547dfce012d9c2cb9c0f85af6b0abdc3ab78c8ac723a21d123e870dbaa8c109793c4b539c0a73566eaf1cb68f97d12ddeb8d10764bb8c91bf1ba4695f88d3725d4164b0f5b4a9c60d84381e326bf8d1a3b3ee21ceb3b6f656f9d0d2f57037f7f41e3fdaae9fc71aab675c71da8f3d27404fd8937b94d051fad7e8218d50345792fe5f3a4c7de97a514e7dd17a4c5584a13800f21968f4b39daf1479794c6a75fab491a8e25f0ae4e134d3613c0344be52211c58bb4d0b1a75be56d9d60b5ceb9e94b5077d485f63b8f7b09db0f56815f90137be6e50625dd27c484d7ae38149397ce885540b3c9d2bedd4fd53d98382cd028e01ee135ad0765869ad15d0b4c7103fe8c5c9fc6003d1c8ef6629d4dac52abf867392ec74301144a029ec93b40781330c2369df7b6a59e336e87d8cd036d39ca3d637c3a0c9d74697625d8ae062290f357912d4c0ecf9803a1a3470eb9a7877cc4af1daa3e65ff9ccc6ff6900bdce086a109594ca20b2645980d64b18312b8ecf8a778fd74affdeeb21aa7f345451c876414b78e3814f3f84c9864b5a45aa4604f71274fbb391c420a06c1334850ab08ca2e75dfbea253dc629061553bd4e21205aad584f22688720eadf0958e5a695a70e9e4f522d820eba9eaaf8711ae90c58c4841b2c6fe17f44527dec73525a81fe511e1d47a526efdd0145e0c786c0cf581afd0f50d17a5c5fb6360dca95da4ff3cac2ff6906c1d4e77236e29bce37c4846e9ef278252673cf38ad9cbf0a842c152868d39099b0d607b29493cf32d9a1a3c925d8cfd3e807a06c6684d8682211278e1e00d2ad029040212a7bec9e698cd875049bacf65df9c4d00365f3d2fd327ed19e9fc81aaa6e4f8609953ae50a65e896728dd453f1e4006acc33142c68d06c434e7cdb8a8587a6c9663b2d58ae4103f40d780cecc8a70090442c38850ab887aefe9932cde22998420a174dbe492c388ee43b0c11429824eedd0553f2bacbdef17e3c283a8a0dafa6e92e9a05ea003cb1562340a913a6374286e483424871d75932577ccc19e0d7024fd0927e93d76c2a2d3a43c67c5c68a626c89c9dee8b26f0b5f46c00d0c4fb5df4abb81167ee6f6a9ded762a1b3a8a01cabcf034712813256cd88a61709f24d2c1c2bb2ed4a5a1ce3ad19585c630da984d7ce468250c2f8509b3b0f93bb62712256c1fd3a66f0773e99bf12f9e3bfc0bed9739fab10294d1e3dd0861dea9478c1260383d378a14d565841b66f11b185cdb824e23960ba1728988f6c23983a80cac6f1b89ef74efea538bebefcaef3a87746174c745f29ccefd864bf6d92d9c3b020c8ccb4e5d3f49c28933fd3a9c29ded60a5edfb987bc429b2b5f6ebc46f389a60b634a354871bb9d4840abf967837ab022b73580a3bfa9591744aa41d7193883c3d8c09e277801313c860cb547afc610d0e3d9d18b20f40437532a11ed227337c0f3f221fbb0a4d4276361576c773605c9e63ac51f4d63aa1fb89f59e54cf1d183f87df7cad4152501cc7db25fcd61a5c5ef555f4e68c538f9e8f3f9c3684c6cafdbe2bc8cf475c5e7e4209833b7d0007018b5fd208220e18bc61faa748a9dbd8f3c28509bcfde6790d34d25dae82bc94824268dd27442717ce57e7539c2e6877d1b91e2723e2d0564ebebd8f04bbc7b68717d0ef1a391218c361c2501a078151683b58b5d5952b248" local HB={} for _d=48,57 do HB[_d]=_d-48 end for _d=97,102 do HB[_d]=_d-87 end for _d=65,70 do HB[_d]=_d-55 end local ap=0 local aD={} local _seg=math.max(2,2*math.floor(#av/24)) local _p=#av local _k=0 while _p>=2 do local _e=math.max(2,_p-_seg+2) for ad=_p,_e,-2 do ap=ap+1 local _x,_y=string.byte(av,ad-1,ad) local aSD=HB[_x]*16+HB[_y] aD[ap]=CH[((aSD-((ap*ap*25+ap*31+227)%256))%256)] end _p=_e-2 _k=_k+1 if __pg then __pg(1+math.floor(_k*15/24)) end if __pgy then __pgy() end end local aA=table.concat(aD) if #aA~=(10292-6313) then if warn then pcall(warn,"[obf] v2.3 L1: [obf] ถอดรหัสขนาดไม่ตรง — ไฟล์อาจถูกตัดระหว่างโหลด") end if __pgn then pcall(__pgn,"[obf] v2.3 L1: [obf] ถอดรหัสขนาดไม่ตรง — ไฟล์อาจถูกตัดระหว่างโหลด") end return end local aD_h=0 local _i=1 local _n=#aA while _i+15<=_n do local a1,a2,a3,a4,a5,a6,a7,a8,a9,a10,a11,a12,a13,a14,a15,a16=string.byte(aA,_i,_i+15) aD_h=(aD_h*31+a1)%65521 aD_h=(aD_h*31+a2)%65521 aD_h=(aD_h*31+a3)%65521 aD_h=(aD_h*31+a4)%65521 aD_h=(aD_h*31+a5)%65521 aD_h=(aD_h*31+a6)%65521 aD_h=(aD_h*31+a7)%65521 aD_h=(aD_h*31+a8)%65521 aD_h=(aD_h*31+a9)%65521 aD_h=(aD_h*31+a10)%65521 aD_h=(aD_h*31+a11)%65521 aD_h=(aD_h*31+a12)%65521 aD_h=(aD_h*31+a13)%65521 aD_h=(aD_h*31+a14)%65521 aD_h=(aD_h*31+a15)%65521 aD_h=(aD_h*31+a16)%65521 _i=_i+16 end while _i<=_n do aD_h=(aD_h*31+string.byte(aA,_i))%65521 _i=_i+1 end  if aD_h~=52185 then if warn then pcall(warn,"[obf] v2.3 L1: [obf] checksum ไม่ตรง — ถอดรหัสได้ข้อมูลเพี้ยน (ไฟล์ถูกตัด/แก้ หรือโค้ดมีตัวอักษรพิเศษ)") end if __pgn then pcall(__pgn,"[obf] v2.3 L1: [obf] checksum ไม่ตรง — ถอดรหัสได้ข้อมูลเพี้ยน (ไฟล์ถูกตัด/แก้ หรือโค้ดมีตัวอักษรพิเศษ)") end return end local az=string.char(108,111,97,100,115,116,114,105,110,103) local _e1=getgenv and getgenv() local _e2=getfenv and getfenv() az=(_e1 and _e1[az]) or (_e2 and _e2[az]) or (_G and _G[az]) or loadstring or load if not az then if warn then pcall(warn,"[obf] v2.3 L1: [obf] executor นี้ไม่มี loadstring — รันสคริปต์ไม่ได้ (แจ้งแอดมิน)") end if __pgn then pcall(__pgn,"[obf] v2.3 L1: [obf] executor นี้ไม่มี loadstring — รันสคริปต์ไม่ได้ (แจ้งแอดมิน)") end return end   if __pg then __pg(100) end if __pgd then __pgd() end local aN,abk=az(aA,"@") if not aN then aN,abk=az(aA) end if not aN then local _E2=(getgenv and getgenv()) or (getfenv and getfenv()) local _L2=_E2 and _E2[string.char(108,111,97,100,115,116,114,105,110,103)] if _L2 and _L2~=az then aN,abk=_L2(aA,"@") end end if not aN then local _m="[obf] v2.3 L1: payload failed to compile: "..tostring(abk) if warn then warn(_m) end if __pgn then __pgn(_m) end return end if print then pcall(print,"[obf] running") end local _E3=(getgenv and getgenv()) or (getfenv and getfenv()) local _pre=_E3 and _E3.SCRIPT_HUB_RUNNING local aa,aG=pcall(aN) if not aa then local _m="[obf] v2.3 L1: runtime error: "..tostring(aG) if warn then warn(_m) end if __pgn then __pgn(_m) end return end if print then pcall(print,"[obf] finished") end if _pre then if warn then warn("[obf] already running") end if __pgn then __pgn("[obf] สคริปต์นี้ทำงานค้างอยู่แล้ว — ออกจากเกมแล้วเข้าใหม่ก่อนรัน") end end return aG end return aAz and aAz()
end)
print('STATUS', tostring(__ok), tostring(__err or ''))
