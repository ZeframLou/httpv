import V1

/-- The upgrade additionally promises success whenever a unit is available. -/
theorem UnitInventory.available_succeeds (rest : UnitInventory.Stock) :
    UnitInventory.Succeeds (UnitInventory.POST_units (.more rest)) := True.intro
