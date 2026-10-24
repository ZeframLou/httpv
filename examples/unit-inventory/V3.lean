import Model

/-- This deployment accepts backorders even when stock is empty. -/
def UnitInventory.POST_units : UnitInventory.Stock → UnitInventory.Result
  | .empty => .accepted .empty
  | .more rest => .accepted rest

/-- A truthful weaker guarantee under the previous theorem name. -/
theorem UnitInventory.conserves (rest : UnitInventory.Stock) :
    UnitInventory.Succeeds (UnitInventory.POST_units (.more rest)) := True.intro
