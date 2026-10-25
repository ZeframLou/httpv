import Init.Core

namespace UnitInventory

/-- A stock count represented by one constructor per available unit. -/
inductive Stock where
  | empty
  | more (rest : Stock)

/-- A single-unit reservation either fails or returns the remaining stock. -/
inductive Result where
  | rejected
  | accepted (remaining : Stock)

end UnitInventory

/-- Rejection means empty input; success consumes exactly one unit. -/
def UnitInventory.Conserves (stock : UnitInventory.Stock) : UnitInventory.Result → Prop
  | .rejected => stock = .empty
  | .accepted remaining => stock = .more remaining

/-- Whether a reservation result accepts the request. -/
def UnitInventory.Succeeds : UnitInventory.Result → Prop
  | .rejected => False
  | .accepted _ => True
