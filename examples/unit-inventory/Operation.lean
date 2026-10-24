import Model

/-- POST /units reserves exactly one unit, rejecting empty stock. -/
def UnitInventory.POST_units : UnitInventory.Stock → UnitInventory.Result
  | .empty => .rejected
  | .more rest => .accepted rest
