import Operation

/-- Every result accounts for exactly one reserved unit or rejects empty stock. -/
theorem UnitInventory.conserves (stock : UnitInventory.Stock) :
    UnitInventory.Conserves stock (UnitInventory.POST_units stock) := by
  cases stock <;> rfl
