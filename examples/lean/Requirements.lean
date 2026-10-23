import Inventory

/-- A checkout client requires accepted quantities to be fully backed by stock. -/
axiom Client.stock_conserved (available requested remaining : Nat) :
    Inventory.POST_reservations available requested = some remaining →
      remaining + requested = available
