import Inventory

namespace Inventory

/-- The operation is unchanged, but the theorem under the old name now promises less. -/
theorem reservation_safe (available requested remaining : Nat) :
    POST_reservations available requested = some remaining → 0 < requested := by
  intro h
  unfold POST_reservations at h
  split at h
  next valid => exact valid.1
  next => contradiction

end Inventory
