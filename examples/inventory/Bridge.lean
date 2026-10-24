import Operation

axiom UnitInventory.conserves (stock : UnitInventory.Stock) :
    UnitInventory.Conserves stock (UnitInventory.POST_units stock)

private theorem weaken (stock : UnitInventory.Stock) (result : UnitInventory.Result) :
    UnitInventory.Conserves stock result → UnitInventory.NonemptyOnSuccess stock result := by
  cases result with
  | rejected => intro _; exact True.intro
  | accepted remaining =>
    intro conserved
    change stock = UnitInventory.Stock.more remaining at conserved
    cases conserved
    exact True.intro

/-- Derive the client's weaker requirement from the remote conservation claim. -/
theorem UnitClient.nonempty (stock : UnitInventory.Stock) :
    UnitInventory.NonemptyOnSuccess stock (UnitInventory.POST_units stock) :=
  weaken stock (UnitInventory.POST_units stock) (UnitInventory.conserves stock)
