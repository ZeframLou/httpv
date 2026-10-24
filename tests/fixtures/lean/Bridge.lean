import Inventory

namespace Inventory

/-- The independently verified remote guarantee is an assumption for this proof. -/
axiom reservation_safe (available requested remaining : Nat) :
    POST_reservations available requested = some remaining →
      0 < requested ∧ requested ≤ available ∧ remaining + requested = available

end Inventory

/-- Derive the checkout client's requirement from the authenticated guarantee. -/
theorem Client.stock_conserved (available requested remaining : Nat) :
    Inventory.POST_reservations available requested = some remaining →
      remaining + requested = available := by
  intro accepted
  exact (Inventory.reservation_safe available requested remaining accepted).2.2
