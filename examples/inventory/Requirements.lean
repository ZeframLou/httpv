import Operation

/-- What the client's proof assumes about POST /units, stated without a proof.
An axiom has the same identity as a theorem with the same statement. -/
axiom UnitInventory.conserves (stock : UnitInventory.Stock) :
    UnitInventory.Conserves stock (UnitInventory.POST_units stock)
